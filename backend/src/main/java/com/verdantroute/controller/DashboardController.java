package com.verdantroute.controller;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.CollectionTask;
import com.verdantroute.entity.Sensor;
import com.verdantroute.entity.SensorReading;
import com.verdantroute.entity.User;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorReadingRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.repository.TaskRepository;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.SensorService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final AreaRepository areaRepository;
    private final SensorRepository sensorRepository;
    private final SensorReadingRepository readingRepository;
    private final TaskRepository taskRepository;
    private final UserRepository userRepository;
    private final SensorService sensorService;

    public DashboardController(
            AreaRepository areaRepository,
            SensorRepository sensorRepository,
            SensorReadingRepository readingRepository,
            TaskRepository taskRepository,
            UserRepository userRepository,
            SensorService sensorService) {
        this.areaRepository = areaRepository;
        this.sensorRepository = sensorRepository;
        this.readingRepository = readingRepository;
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
        this.sensorService = sensorService;
    }

    @GetMapping("/summary")
    @Transactional
    public Map<String, Object> summary(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) Long sensorId,
            @RequestParam(required = false) Long employeeId) {
        Area area = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        Instant now = Instant.now();

        List<Sensor> allAreaSensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());
        for (Sensor s : allAreaSensors) {
            Sensor.SensorStatus computed = sensorService.computeStatus(s, area, now);
            if (computed != s.getStatus()) {
                s.setStatus(computed);
                sensorRepository.save(s);
            }
        }
        List<Sensor> sensors = sensorId != null
                ? allAreaSensors.stream().filter(s -> s.getId().equals(sensorId)).toList()
                : allAreaSensors;

        int full = 0, medium = 0, normal = 0, offline = 0;
        for (Sensor s : sensors) {
            if (!Boolean.TRUE.equals(s.getIsActive()) || s.getStatus() == Sensor.SensorStatus.OFFLINE) offline++;
            else if (s.getStatus() == Sensor.SensorStatus.FULL) full++;
            else if (s.getStatus() == Sensor.SensorStatus.MEDIUM) medium++;
            else normal++;
        }

        List<CollectionTask> tasks = employeeId != null
                ? taskRepository.findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(principal.areaId(), employeeId)
                : taskRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());

        if (sensorId != null) {
            tasks = tasks.stream()
                    .filter(t -> t.getStops().stream().anyMatch(st -> st.getSensor().getId().equals(sensorId)))
                    .toList();
        }

        String today = LocalDate.now(ZoneOffset.UTC).toString();
        int pending = 0, inProgress = 0, completed = 0, completedToday = 0, cancelled = 0;
        for (CollectionTask t : tasks) {
            switch (t.getStatus()) {
                case ASSIGNED -> pending++;
                case ACCEPTED -> inProgress++;
                case COMPLETED -> {
                    completed++;
                    if (t.getCompletedAt() != null && t.getCompletedAt().toString().startsWith(today)) completedToday++;
                }
                case CANCELLED -> cancelled++;
            }
        }

        List<Map<String, Object>> binsByFill = sensors.stream()
                .sorted((a, b) -> Double.compare(
                        b.getLastFillPercent() != null ? b.getLastFillPercent() : -1.0,
                        a.getLastFillPercent() != null ? a.getLastFillPercent() : -1.0))
                .map(s -> Map.<String, Object>of(
                        "id", s.getId(),
                        "binId", s.getBinId(),
                        "label", s.getLabel(),
                        "fillPercent", s.getLastFillPercent() != null ? s.getLastFillPercent() : 0.0,
                        "hasReading", s.getLastFillPercent() != null,
                        "status", s.getStatus().name()
                ))
                .toList();

        long empCount = userRepository.countByAreaIdAndRole(principal.areaId(), User.Role.EMPLOYEE);

        return Map.of(
                "cards", Map.ofEntries(
                        Map.entry("totalBins", sensors.size()),
                        Map.entry("fullBins", full),
                        Map.entry("mediumBins", medium),
                        Map.entry("normalBins", normal),
                        Map.entry("offlineSensors", offline),
                        Map.entry("pendingTasks", pending),
                        Map.entry("inProgressTasks", inProgress),
                        Map.entry("completedToday", completedToday),
                        Map.entry("completedTasks", completed),
                        Map.entry("cancelledTasks", cancelled),
                        Map.entry("employeeCount", empCount)
                ),
                "binStatusSplit", List.of(
                        Map.of("name", "Normal", "value", normal, "color", "#16A34A"),
                        Map.of("name", "Medium", "value", medium, "color", "#D97706"),
                        Map.of("name", "Full", "value", full, "color", "#DC2626"),
                        Map.of("name", "Offline", "value", offline, "color", "#64748B")
                ),
                "taskStatusSplit", List.of(
                        Map.of("name", "Pending", "value", pending, "color", "#D97706"),
                        Map.of("name", "Accepted", "value", inProgress, "color", "#0284C7"),
                        Map.of("name", "Completed", "value", completed, "color", "#16A34A")
                ),
                "binsByFill", binsByFill
        );
    }

    @GetMapping("/fill-trends")
    @Transactional(readOnly = true)
    public Map<String, Object> fillTrends(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) Long sensorId,
            @RequestParam(defaultValue = "7") int days) {
        int clampedDays = Math.min(90, Math.max(1, days));
        List<Sensor> areaSensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());
        Sensor target = sensorId != null
                ? areaSensors.stream().filter(s -> s.getId().equals(sensorId)).findFirst().orElse(null)
                : areaSensors.stream()
                        .max(Comparator.comparingDouble(s -> s.getLastFillPercent() != null ? s.getLastFillPercent() : -1.0))
                        .orElse(null);

        if (target == null) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("sensor", null);
            empty.put("points", List.of());
            return empty;
        }
        List<SensorReading> readings = readingRepository.findBySensorIdAndRecordedAtAfterOrderByRecordedAtAsc(
                target.getId(), Instant.now().minus(clampedDays, ChronoUnit.DAYS));

        return Map.of(
                "sensor", Map.of("id", target.getId(), "binId", target.getBinId(), "label", target.getLabel()),
                "points", readings.stream().map(r -> Map.of(
                        "fillPercent", r.getFillPercent(),
                        "distanceCm", r.getDistanceCm(),
                        "recordedAt", r.getRecordedAt().toString()
                )).toList()
        );
    }

    @GetMapping("/collections")
    @Transactional(readOnly = true)
    public Map<String, Object> collections(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "14") int days,
            @RequestParam(required = false) Long employeeId,
            @RequestParam(required = false) Long sensorId) {
        int clampedDays = Math.min(90, Math.max(7, days));
        Instant cutoff = Instant.now().minus(clampedDays, ChronoUnit.DAYS);
        List<CollectionTask> tasks = employeeId != null
                ? taskRepository.findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(principal.areaId(), employeeId)
                : taskRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());

        Map<String, Integer> byDay = new TreeMap<>();
        for (CollectionTask t : tasks) {
            t.getStops().forEach(st -> {
                if (sensorId != null && !st.getSensor().getId().equals(sensorId)) {
                    return;
                }
                if (st.getCollectedAt() != null && !st.getCollectedAt().isBefore(cutoff)) {
                    String day = st.getCollectedAt().toString().substring(0, 10);
                    byDay.merge(day, 1, Integer::sum);
                }
            });
        }

        List<Map<String, Object>> out = byDay.entrySet().stream()
                .map(e -> Map.<String, Object>of("day", e.getKey(), "count", e.getValue()))
                .toList();
        return Map.of("collections", out);
    }

    @GetMapping("/employee-stats")
    @Transactional(readOnly = true)
    public Map<String, Object> employeeStats(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(required = false) Long employeeId) {
        int clampedDays = Math.min(90, Math.max(1, days));
        Instant cutoff = Instant.now().minus(clampedDays, ChronoUnit.DAYS);
        List<User> employees = userRepository.findByAreaIdAndRoleOrderByCreatedAtDesc(principal.areaId(), User.Role.EMPLOYEE);
        if (employeeId != null) {
            employees = employees.stream().filter(e -> e.getId().equals(employeeId)).toList();
        }
        List<CollectionTask> areaTasks = taskRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());

        List<Map<String, Object>> out = new ArrayList<>();
        for (User emp : employees) {
            long completed = areaTasks.stream()
                    .filter(t -> t.getAssignedTo().getId().equals(emp.getId())
                            && t.getStatus() == CollectionTask.TaskStatus.COMPLETED
                            && t.getCompletedAt() != null
                            && !t.getCompletedAt().isBefore(cutoff))
                    .count();
            long open = areaTasks.stream()
                    .filter(t -> t.getAssignedTo().getId().equals(emp.getId())
                            && (t.getStatus() == CollectionTask.TaskStatus.ASSIGNED
                            || t.getStatus() == CollectionTask.TaskStatus.ACCEPTED))
                    .count();
            out.add(Map.of(
                    "employeeId", emp.getId(),
                    "name", emp.getName(),
                    "completedCount", completed,
                    "openCount", open
            ));
        }
        return Map.of("employees", out);
    }
}
