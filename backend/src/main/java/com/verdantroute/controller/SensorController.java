package com.verdantroute.controller;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.entity.SensorReading;
import com.verdantroute.entity.TaskBin;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorReadingRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.repository.TaskBinRepository;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.SensorService;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sensors")
public class SensorController {
    private final SensorRepository sensorRepository;
    private final SensorReadingRepository readingRepository;
    private final TaskBinRepository taskBinRepository;
    private final AreaRepository areaRepository;
    private final SensorService sensorService;
    private final RealtimeWebSocketHandler wsHandler;

    public SensorController(
            SensorRepository sensorRepository,
            SensorReadingRepository readingRepository,
            TaskBinRepository taskBinRepository,
            AreaRepository areaRepository,
            SensorService sensorService,
            RealtimeWebSocketHandler wsHandler) {
        this.sensorRepository = sensorRepository;
        this.readingRepository = readingRepository;
        this.taskBinRepository = taskBinRepository;
        this.areaRepository = areaRepository;
        this.sensorService = sensorService;
        this.wsHandler = wsHandler;
    }

    @GetMapping
    @Transactional
    public Map<String, Object> list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status) {
        Area area = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        Instant now = Instant.now();
        List<Sensor> sensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());
        for (Sensor s : sensors) {
            Sensor.SensorStatus computed = sensorService.computeStatus(s, area, now);
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
        return Map.of("sensors", sensors.stream().map(sensorService::serializeSensor).toList());
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) {
        String binId = body.get("binId") != null ? String.valueOf(body.get("binId")).trim() : "";
        String label = body.get("label") != null ? String.valueOf(body.get("label")).trim() : "";
        if (binId.isBlank() || label.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Bin ID and location label are required.");
        }
        if (!(body.get("latitude") instanceof Number latNum) || !(body.get("longitude") instanceof Number lngNum)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Valid map coordinates (latitude and longitude) are required.");
        }
        if (!(body.get("binHeightCm") instanceof Number heightNum)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Valid bin height (cm) is required.");
        }
        double lat = latNum.doubleValue();
        double lng = lngNum.doubleValue();
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Latitude/longitude out of bounds.");
        }
        Map<String, Object> created = sensorService.createSensor(
                principal.areaId(),
                binId,
                label,
                lat,
                lng,
                heightNum.doubleValue(),
                body.get("intervalSeconds") instanceof Number n ? n.intValue() : null,
                body.get("fullThreshold") instanceof Number n ? n.intValue() : null
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/{id}")
    @Transactional
    public Map<String, Object> detail(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestParam(defaultValue = "day") String range) {
        Sensor s = sensorRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        Sensor.SensorStatus computed = sensorService.computeStatus(s, s.getArea(), Instant.now());
        if (computed != s.getStatus()) {
            s.setStatus(computed);
            sensorRepository.save(s);
        }
        long days = "month".equalsIgnoreCase(range) ? 30 : "week".equalsIgnoreCase(range) ? 7 : 1;
        List<SensorReading> readings = readingRepository
                .findBySensorIdAndRecordedAtAfterOrderByRecordedAtAsc(id, Instant.now().minus(days, ChronoUnit.DAYS));
        List<TaskBin> collections = taskBinRepository.findBySensorIdAndCollectedAtIsNotNullOrderByCollectedAtDesc(id);

        return Map.of(
                "sensor", sensorService.serializeSensor(s),
                "readings", readings.stream().map(r -> Map.of(
                        "id", r.getId(),
                        "distanceCm", r.getDistanceCm(),
                        "fillPercent", r.getFillPercent(),
                        "recordedAt", r.getRecordedAt().toString()
                )).toList(),
                "collections", collections.stream().map(c -> Map.of(
                        "taskBinId", c.getId(),
                        "taskId", c.getTask().getId(),
                        "collectedAt", c.getCollectedAt().toString(),
                        "fillAtAssignment", c.getFillAtAssignment() != null ? c.getFillAtAssignment() : 0,
                        "taskStatus", c.getTask().getStatus().name(),
                        "employeeId", c.getTask().getAssignedTo().getId(),
                        "employeeName", c.getTask().getAssignedTo().getName()
                )).toList()
        );
    }

    @PutMapping("/{id}")
    @Transactional
    public Map<String, Object> update(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        Sensor s = sensorRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        Area area = s.getArea();

        if (body.get("binId") != null) {
            String nextBin = String.valueOf(body.get("binId")).trim().toUpperCase();
            if (nextBin.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "Bin ID cannot be blank.");
            if (sensorRepository.existsByAreaIdAndBinIdIgnoreCaseAndIdNot(area.getId(), nextBin, id)) {
                throw new ApiException(HttpStatus.CONFLICT, "Bin ID already assigned in this area.");
            }
            s.setBinId(nextBin);
        }
        if (body.get("label") != null) {
            String nextLabel = String.valueOf(body.get("label")).trim();
            if (nextLabel.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "Label cannot be blank.");
            s.setLabel(nextLabel);
        }
        if (body.get("latitude") instanceof Number n) {
            double lat = n.doubleValue();
            if (lat < -90 || lat > 90) throw new ApiException(HttpStatus.BAD_REQUEST, "Latitude out of bounds.");
            s.setLatitude(lat);
        }
        if (body.get("longitude") instanceof Number n) {
            double lng = n.doubleValue();
            if (lng < -180 || lng > 180) throw new ApiException(HttpStatus.BAD_REQUEST, "Longitude out of bounds.");
            s.setLongitude(lng);
        }
        if (body.get("binHeightCm") instanceof Number n) {
            double h = n.doubleValue();
            if (h < 10 || h > 500) throw new ApiException(HttpStatus.BAD_REQUEST, "Bin height must be 10..500 cm.");
            s.setBinHeightCm(h);
            if (s.getLastDistanceCm() != null) {
                s.setLastFillPercent(sensorService.calculateFillPercent(h, s.getLastDistanceCm()));
            }
        }
        if (body.get("intervalSeconds") instanceof Number n) {
            int val = n.intValue();
            if (val < 60 || val > 14400) throw new ApiException(HttpStatus.BAD_REQUEST, "Interval must be 60..14400s.");
            s.setIntervalSeconds(val);
        }
        if (body.get("fullThreshold") instanceof Number n) {
            int thr = n.intValue();
            if (thr <= area.getMediumThreshold() || thr > 100) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Full threshold must be above medium threshold and <= 100%.");
            }
            s.setFullThreshold(thr);
        }
        if (body.get("isActive") instanceof Boolean b) s.setIsActive(b);

        s.setStatus(sensorService.computeStatus(s, area, Instant.now()));
        sensorRepository.save(s);
        Map<String, Object> serialized = sensorService.serializeSensor(s);
        wsHandler.broadcastToAreaAdmins(area.getId(), "sensor:updated", serialized);
        return Map.of("sensor", serialized);
    }

    @PostMapping("/{id}/regenerate-key")
    public Map<String, Object> regenerateKey(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        return Map.of("deviceKey", sensorService.regenerateKey(principal.areaId(), id));
    }

    @PostMapping("/{id}/simulate-reading")
    public ResponseEntity<Map<String, Object>> simulateReading(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        Sensor s = sensorRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        if (!Boolean.TRUE.equals(s.getIsActive())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Activate sensor before testing readings.");
        }
        if (!(body.get("distanceCm") instanceof Number distNum)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Numeric distanceCm is required.");
        }
        double dist = distNum.doubleValue();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(sensorService.persistReading(s, dist, Instant.now()));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public Map<String, Object> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        Sensor s = sensorRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Sensor not found."));
        sensorRepository.delete(s);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "sensor:deleted", Map.of("id", id));
        return Map.of("success", true);
    }
}
