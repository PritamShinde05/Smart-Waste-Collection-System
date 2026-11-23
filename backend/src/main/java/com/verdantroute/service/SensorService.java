package com.verdantroute.service;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.entity.SensorReading;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorReadingRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class SensorService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern KEY_PREFIX = Pattern.compile("^vr_(\\d+)_");

    private final SensorRepository sensorRepository;
    private final SensorReadingRepository readingRepository;
    private final AreaRepository areaRepository;
    private final PasswordEncoder passwordEncoder;
    private final RealtimeWebSocketHandler wsHandler;

    public SensorService(
            SensorRepository sensorRepository,
            SensorReadingRepository readingRepository,
            AreaRepository areaRepository,
            PasswordEncoder passwordEncoder,
            RealtimeWebSocketHandler wsHandler) {
        this.sensorRepository = sensorRepository;
        this.readingRepository = readingRepository;
        this.areaRepository = areaRepository;
        this.passwordEncoder = passwordEncoder;
        this.wsHandler = wsHandler;
    }

    public double calculateFillPercent(double binHeightCm, double distanceCm) {
        if (binHeightCm <= 0) return 0.0;
        double raw = ((binHeightCm - distanceCm) / binHeightCm) * 100.0;
        double clamped = Math.max(0.0, Math.min(100.0, raw));
        return Math.round(clamped * 10.0) / 10.0;
    }

    public Sensor.SensorStatus computeStatus(Sensor sensor, Area area, Instant now) {
        if (!Boolean.TRUE.equals(sensor.getIsActive()) || sensor.getLastSeenAt() == null || sensor.getLastFillPercent() == null) {
            return Sensor.SensorStatus.OFFLINE;
        }
        long offlineMillis = sensor.getIntervalSeconds() * 2000L;
        if (now.toEpochMilli() - sensor.getLastSeenAt().toEpochMilli() > offlineMillis) {
            return Sensor.SensorStatus.OFFLINE;
        }
        double fill = sensor.getLastFillPercent();
        if (fill >= sensor.getFullThreshold()) return Sensor.SensorStatus.FULL;
        if (fill >= area.getMediumThreshold()) return Sensor.SensorStatus.MEDIUM;
        return Sensor.SensorStatus.NORMAL;
    }

    @Transactional
    public Map<String, Object> createSensor(
            Long areaId, String binId, String label, double lat, double lng,
            double binHeightCm, Integer intervalSeconds, Integer fullThreshold) {
        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        String cleanBinId = binId.trim().toUpperCase();
        if (sensorRepository.existsByAreaIdAndBinIdIgnoreCase(areaId, cleanBinId)) {
            throw new ApiException(HttpStatus.CONFLICT, "Bin ID already exists in your area.");
        }

        int interval = intervalSeconds != null ? intervalSeconds : area.getDefaultIntervalSeconds();
        int threshold = fullThreshold != null ? fullThreshold : area.getFullThreshold();
        if (interval < 60 || interval > 14400) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Interval must be between 60 and 14400 seconds.");
        }
        if (binHeightCm < 10 || binHeightCm > 500) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Bin height must be between 10 and 500 cm.");
        }
        if (threshold <= area.getMediumThreshold() || threshold > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Full threshold must be above medium threshold and <= 100%.");
        }

        Sensor s = new Sensor();
        s.setArea(area);
        s.setBinId(cleanBinId);
        s.setLabel(label.trim());
        s.setLatitude(lat);
        s.setLongitude(lng);
        s.setBinHeightCm(binHeightCm);
        s.setIntervalSeconds(interval);
        s.setFullThreshold(threshold);
        s.setDeviceKeyHash("pending");
        s.setStatus(Sensor.SensorStatus.OFFLINE);
        s.setIsActive(true);
        s = sensorRepository.save(s);

        String rawKey = generateDeviceKey(s.getId());
        s.setDeviceKeyHash(passwordEncoder.encode(rawKey));
        s = sensorRepository.save(s);

        Map<String, Object> serialized = serializeSensor(s);
        wsHandler.broadcastToAreaAdmins(areaId, "sensor:created", serialized);
        return Map.of("sensor", serialized, "deviceKey", rawKey, "readingEndpoint", "/api/device/reading");
    }

    @Transactional
    public String regenerateKey(Long areaId, Long sensorId) {
        Sensor s = sensorRepository.findByIdAndAreaId(sensorId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        String rawKey = generateDeviceKey(s.getId());
        s.setDeviceKeyHash(passwordEncoder.encode(rawKey));
        sensorRepository.save(s);
        return rawKey;
    }

    @Transactional
    public Map<String, Object> ingestDeviceReading(String binId, String deviceKey, double distanceCm, Instant timestamp) {
        String cleanBin = binId.trim().toUpperCase();
        String key = deviceKey.trim();
        Sensor matched = null;

        Matcher m = KEY_PREFIX.matcher(key);
        if (m.find()) {
            Long candidateId = Long.parseLong(m.group(1));
            Sensor candidate = sensorRepository.findByIdAndBinIdIgnoreCase(candidateId, cleanBin).orElse(null);
            if (candidate != null && passwordEncoder.matches(key, candidate.getDeviceKeyHash())) {
                matched = candidate;
            }
        } else {
            for (Sensor c : sensorRepository.findByBinIdIgnoreCase(cleanBin)) {
                if (passwordEncoder.matches(key, c.getDeviceKeyHash())) {
                    matched = c;
                    break;
                }
            }
        }

        if (matched == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid Bin ID or device key.");
        }
        if (!Boolean.TRUE.equals(matched.getIsActive())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Sensor is deactivated.");
        }
        return persistReading(matched, distanceCm, timestamp != null ? timestamp : Instant.now());
    }

    @Transactional
    public Map<String, Object> persistReading(Sensor sensor, double distanceCm, Instant recordedAt) {
        if (distanceCm < 0 || distanceCm > sensor.getBinHeightCm()) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "Measured distance outside physical bin range (0 to " + sensor.getBinHeightCm() + " cm). Discarded.");
        }
        double fill = calculateFillPercent(sensor.getBinHeightCm(), distanceCm);
        SensorReading reading = new SensorReading();
        reading.setSensor(sensor);
        reading.setDistanceCm(distanceCm);
        reading.setFillPercent(fill);
        reading.setRecordedAt(recordedAt);
        readingRepository.save(reading);

        if (sensor.getLastSeenAt() == null || !recordedAt.isBefore(sensor.getLastSeenAt())) {
            sensor.setLastDistanceCm(distanceCm);
            sensor.setLastFillPercent(fill);
            sensor.setLastSeenAt(recordedAt);
            sensor.setStatus(computeStatus(sensor, sensor.getArea(), Instant.now()));
            sensorRepository.save(sensor);
        }

        Map<String, Object> serialized = serializeSensor(sensor);
        wsHandler.broadcastToAreaAdmins(sensor.getArea().getId(), "sensor:reading", Map.of(
                "sensor", serialized,
                "reading", Map.of("distanceCm", distanceCm, "fillPercent", fill, "recordedAt", recordedAt.toString())
        ));

        return Map.of(
                "success", true,
                "binId", sensor.getBinId(),
                "fillPercentage", fill,
                "status", sensor.getStatus().name(),
                "readingIntervalSeconds", sensor.getIntervalSeconds(),
                "sensor", serialized
        );
    }

    private String generateDeviceKey(Long sensorId) {
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        return "vr_" + sensorId + "_" + HexFormat.of().formatHex(bytes);
    }

    public Map<String, Object> serializeSensor(Sensor s) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", s.getId());
        out.put("areaId", s.getArea().getId());
        out.put("binId", s.getBinId());
        out.put("label", s.getLabel());
        out.put("latitude", s.getLatitude());
        out.put("longitude", s.getLongitude());
        out.put("binHeightCm", s.getBinHeightCm());
        out.put("intervalSeconds", s.getIntervalSeconds());
        out.put("fullThreshold", s.getFullThreshold());
        out.put("status", s.getStatus().name());
        out.put("isActive", s.getIsActive());
        out.put("lastFillPercent", s.getLastFillPercent());
        out.put("lastDistanceCm", s.getLastDistanceCm());
        out.put("lastSeenAt", s.getLastSeenAt() != null ? s.getLastSeenAt().toString() : null);
        out.put("createdAt", s.getCreatedAt().toString());
        return out;
    }
}
