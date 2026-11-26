package com.verdantroute.service;

import com.verdantroute.dto.SensorAndDeviceDtos.*;
import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.entity.SensorReading;
import com.verdantroute.entity.TaskBin;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorReadingRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.repository.TaskBinRepository;
import com.verdantroute.util.DeviceKeyUtil;
import com.verdantroute.util.FillMathUtil;
import com.verdantroute.util.ValidationUtil;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@Service
public class SensorService {
    private final SensorRepository sensorRepository;
    private final SensorReadingRepository readingRepository;
    private final TaskBinRepository taskBinRepository;
    private final AreaRepository areaRepository;
    private final PasswordEncoder passwordEncoder;
    private final RealtimeWebSocketHandler wsHandler;
    private final Clock clock;

    public SensorService(
            SensorRepository sensorRepository,
            SensorReadingRepository readingRepository,
            TaskBinRepository taskBinRepository,
            AreaRepository areaRepository,
            PasswordEncoder passwordEncoder,
            RealtimeWebSocketHandler wsHandler,
            Clock clock) {
        this.sensorRepository = sensorRepository;
        this.readingRepository = readingRepository;
        this.taskBinRepository = taskBinRepository;
        this.areaRepository = areaRepository;
        this.passwordEncoder = passwordEncoder;
        this.wsHandler = wsHandler;
        this.clock = clock;
    }

    public double calculateFillPercent(double binHeightCm, double distanceCm) {
        return FillMathUtil.calculateFillPercent(binHeightCm, distanceCm);
    }

    public Sensor.SensorStatus computeStatus(Sensor sensor, Area area, Instant now) {
        return FillMathUtil.computeStatus(sensor, area, now);
    }

    @Transactional
    public SensorListResponse listSensors(Long areaId, String search, String status) {
        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        Instant now = clock.instant();
        List<Sensor> sensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(areaId);
        for (Sensor s : sensors) {
            Sensor.SensorStatus computed = computeStatus(s, area, now);
            if (computed != s.getStatus()) {
                s.setStatus(computed);
                sensorRepository.save(s);
            }
        }
        if (search != null && !search.isBlank()) {
            String q = search.trim().toLowerCase();
            sensors = sensors.stream()
                    .filter(s -> s.getBinId().toLowerCase().contains(q) || s.getLabel().toLowerCase().contains(q))
                    .toList();
        }
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            if ("ONLINE".equalsIgnoreCase(status)) {
                sensors = sensors.stream()
                        .filter(s -> Boolean.TRUE.equals(s.getIsActive()) && s.getStatus() != Sensor.SensorStatus.OFFLINE)
                        .toList();
            } else if ("INACTIVE".equalsIgnoreCase(status)) {
                sensors = sensors.stream()
                        .filter(s -> !Boolean.TRUE.equals(s.getIsActive()))
                        .toList();
            } else {
                String target = status.toUpperCase();
                sensors = sensors.stream()
                        .filter(s -> s.getStatus().name().equals(target))
                        .toList();
            }
        }
        return new SensorListResponse(sensors.stream().map(this::toSensorDto).toList());
    }

    @Transactional
    public CreateSensorResponse createSensor(Long areaId, CreateSensorRequest req) {
        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));

        String cleanBinId = req.binId().trim().toUpperCase();
        String cleanLabel = req.label().trim();
        if (cleanBinId.isBlank() || cleanLabel.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Bin ID and location label are required.");
        }
        ValidationUtil.validateCoordinates(req.latitude(), req.longitude());

        if (sensorRepository.existsByAreaIdAndBinIdIgnoreCase(areaId, cleanBinId)) {
            throw new ApiException(HttpStatus.CONFLICT, "Bin ID already exists in your area.");
        }

        int interval = req.intervalSeconds() != null ? req.intervalSeconds() : area.getDefaultIntervalSeconds();
        int threshold = req.fullThreshold() != null ? req.fullThreshold() : area.getFullThreshold();
        if (interval < 60 || interval > 14400) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Interval must be between 60 and 14400 seconds.");
        }
        if (req.binHeightCm() < 10 || req.binHeightCm() > 500) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Bin height must be between 10 and 500 cm.");
        }
        if (threshold <= area.getMediumThreshold() || threshold > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "Full threshold must be above medium threshold and <= 100%.");
        }

        Sensor s = new Sensor();
        s.setArea(area);
        s.setBinId(cleanBinId);
        s.setLabel(cleanLabel);
        s.setLatitude(req.latitude());
        s.setLongitude(req.longitude());
        s.setBinHeightCm(req.binHeightCm());
        s.setIntervalSeconds(interval);
        s.setFullThreshold(threshold);
        s.setDeviceKeyHash("pending");
        s.setStatus(Sensor.SensorStatus.OFFLINE);
        s.setIsActive(true);
        s = sensorRepository.save(s);

        String rawKey = DeviceKeyUtil.generateDeviceKey(s.getId());
        s.setDeviceKeyHash(passwordEncoder.encode(rawKey));
        s = sensorRepository.save(s);

        SensorDto dto = toSensorDto(s);
        wsHandler.broadcastToAreaAdmins(areaId, "sensor:created", dto);
        return new CreateSensorResponse(dto, rawKey, "/api/device/reading");
    }

    @Transactional
    public SensorDetailResponse getSensorDetail(Long areaId, Long id, String range) {
        Sensor s = sensorRepository.findByIdAndAreaId(id, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        Instant now = clock.instant();
        Sensor.SensorStatus computed = computeStatus(s, s.getArea(), now);
        if (computed != s.getStatus()) {
            s.setStatus(computed);
            sensorRepository.save(s);
        }

        long days = "month".equalsIgnoreCase(range) ? 30 : "week".equalsIgnoreCase(range) ? 7 : 1;
        List<SensorReading> readings = readingRepository
                .findBySensorIdAndRecordedAtAfterOrderByRecordedAtAsc(id, now.minus(days, ChronoUnit.DAYS));
        List<TaskBin> collections = taskBinRepository.findBySensorIdAndCollectedAtIsNotNullOrderByCollectedAtDesc(id);

        List<SensorReadingDto> readingDtos = readings.stream()
                .map(r -> new SensorReadingDto(r.getId(), r.getDistanceCm(), r.getFillPercent(), r.getRecordedAt().toString()))
                .toList();

        List<CollectionRecordDto> collectionDtos = collections.stream()
                .map(c -> new CollectionRecordDto(
                        c.getId(),
                        c.getTask().getId(),
                        c.getCollectedAt().toString(),
                        c.getFillAtAssignment(),
                        c.getTask().getStatus().name(),
                        c.getTask().getAssignedTo().getId(),
                        c.getTask().getAssignedTo().getName()
                ))
                .toList();

        return new SensorDetailResponse(toSensorDto(s), readingDtos, collectionDtos);
    }

    @Transactional
    public SensorSingleResponse updateSensor(Long areaId, Long id, UpdateSensorRequest req) {
        Sensor s = sensorRepository.findByIdAndAreaId(id, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        Area area = s.getArea();

        if (req.binId() != null) {
            String nextBin = req.binId().trim().toUpperCase();
            if (nextBin.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "Bin ID cannot be blank.");
            if (sensorRepository.existsByAreaIdAndBinIdIgnoreCaseAndIdNot(area.getId(), nextBin, id)) {
                throw new ApiException(HttpStatus.CONFLICT, "Bin ID already assigned in this area.");
            }
            s.setBinId(nextBin);
        }
        if (req.label() != null) {
            String nextLabel = req.label().trim();
            if (nextLabel.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "Label cannot be blank.");
            s.setLabel(nextLabel);
        }
        if (req.latitude() != null) {
            ValidationUtil.validateCoordinates(req.latitude(), s.getLongitude());
            s.setLatitude(req.latitude());
        }
        if (req.longitude() != null) {
            ValidationUtil.validateCoordinates(s.getLatitude(), req.longitude());
            s.setLongitude(req.longitude());
        }
        if (req.binHeightCm() != null) {
            double h = req.binHeightCm();
            if (h < 10 || h > 500) throw new ApiException(HttpStatus.BAD_REQUEST, "Bin height must be 10..500 cm.");
            s.setBinHeightCm(h);
            if (s.getLastDistanceCm() != null) {
                s.setLastFillPercent(calculateFillPercent(h, s.getLastDistanceCm()));
            }
        }
        if (req.intervalSeconds() != null) {
            int val = req.intervalSeconds();
            if (val < 60 || val > 14400) throw new ApiException(HttpStatus.BAD_REQUEST, "Interval must be 60..14400s.");
            s.setIntervalSeconds(val);
        }
        if (req.fullThreshold() != null) {
            int thr = req.fullThreshold();
            if (thr <= area.getMediumThreshold() || thr > 100) {
                throw new ApiException(HttpStatus.BAD_REQUEST,
                        "Full threshold must be above medium threshold and <= 100%.");
            }
            s.setFullThreshold(thr);
        }
        if (req.isActive() != null) {
            s.setIsActive(req.isActive());
        }

        s.setStatus(computeStatus(s, area, clock.instant()));
        sensorRepository.save(s);

        SensorDto dto = toSensorDto(s);
        wsHandler.broadcastToAreaAdmins(area.getId(), "sensor:updated", dto);
        return new SensorSingleResponse(dto);
    }

    @Transactional
    public String regenerateKey(Long areaId, Long sensorId) {
        Sensor s = sensorRepository.findByIdAndAreaId(sensorId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        String rawKey = DeviceKeyUtil.generateDeviceKey(s.getId());
        s.setDeviceKeyHash(passwordEncoder.encode(rawKey));
        sensorRepository.save(s);
        return rawKey;
    }

    @Transactional
    public void deleteSensor(Long areaId, Long sensorId) {
        Sensor s = sensorRepository.findByIdAndAreaId(sensorId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        sensorRepository.delete(s);
        wsHandler.broadcastToAreaAdmins(areaId, "sensor:deleted", Map.of("id", sensorId));
    }

    @Transactional
    public DeviceReadingResponse simulateReading(Long areaId, Long sensorId, SimulateReadingRequest req) {
        Sensor s = sensorRepository.findByIdAndAreaId(sensorId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        if (!Boolean.TRUE.equals(s.getIsActive())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Activate sensor before testing readings.");
        }
        if (Double.isNaN(req.distanceCm()) || Double.isInfinite(req.distanceCm())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "distanceCm must be a valid finite number.");
        }
        return persistReading(s, req.distanceCm(), clock.instant());
    }

    @Transactional
    public DeviceReadingResponse ingestDeviceReading(String binId, String deviceKey, double distanceCm, Instant timestamp) {
        String cleanBin = binId.trim().toUpperCase();
        String key = deviceKey.trim();
        Sensor matched = null;

        var optId = DeviceKeyUtil.extractSensorId(key);
        if (optId.isPresent()) {
            Sensor candidate = sensorRepository.findByIdAndBinIdIgnoreCase(optId.get(), cleanBin).orElse(null);
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
        return persistReading(matched, distanceCm, timestamp != null ? timestamp : clock.instant());
    }

    @Transactional
    public DeviceReadingResponse persistReading(Sensor sensor, double distanceCm, Instant recordedAt) {
        if (Double.isNaN(distanceCm) || Double.isInfinite(distanceCm)
                || distanceCm < 0 || distanceCm > sensor.getBinHeightCm()) {
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
            sensor.setStatus(computeStatus(sensor, sensor.getArea(), clock.instant()));
            sensorRepository.save(sensor);
        }

        SensorDto dto = toSensorDto(sensor);
        wsHandler.broadcastToAreaAdmins(
                sensor.getArea().getId(),
                "sensor:reading",
                new SensorReadingEventPayload(dto, new ReadingPointPayload(distanceCm, fill, recordedAt.toString()))
        );

        return new DeviceReadingResponse(
                true,
                sensor.getBinId(),
                fill,
                sensor.getStatus().name(),
                sensor.getIntervalSeconds(),
                dto
        );
    }

    public SensorDto toSensorDto(Sensor s) {
        return new SensorDto(
                s.getId(),
                s.getArea().getId(),
                s.getBinId(),
                s.getLabel(),
                s.getLatitude(),
                s.getLongitude(),
                s.getBinHeightCm(),
                s.getIntervalSeconds(),
                s.getFullThreshold(),
                s.getStatus().name(),
                s.getIsActive(),
                s.getLastFillPercent(),
                s.getLastDistanceCm(),
                s.getLastSeenAt() != null ? s.getLastSeenAt().toString() : null,
                s.getCreatedAt().toString()
        );
    }
}
