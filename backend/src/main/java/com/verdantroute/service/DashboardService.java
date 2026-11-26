package com.verdantroute.service;

import com.verdantroute.dto.DashboardDtos.*;
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
import com.verdantroute.util.FillMathUtil;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class DashboardService {
    private final AreaRepository areaRepository;
    private final SensorRepository sensorRepository;
    private final SensorReadingRepository readingRepository;
    private final TaskRepository taskRepository;
    private final UserRepository userRepository;
    private final Clock clock;

    public DashboardService(
            AreaRepository areaRepository,
            SensorRepository sensorRepository,
            SensorReadingRepository readingRepository,
            TaskRepository taskRepository,
            UserRepository userRepository,
            Clock clock) {
        this.areaRepository = areaRepository;
        this.sensorRepository = sensorRepository;
        this.readingRepository = readingRepository;
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
        this.clock = clock;
    }

    @Transactional
    public DashboardSummaryResponse getSummary(Long areaId, Long sensorId, Long employeeId) {
        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        Instant now = clock.instant();

        List<Sensor> allAreaSensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(areaId);
        for (Sensor s : allAreaSensors) {
            Sensor.SensorStatus computed = FillMathUtil.computeStatus(s, area, now);
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
                ? taskRepository.findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(areaId, employeeId)
                : taskRepository.findByAreaIdOrderByCreatedAtDesc(areaId);

        if (sensorId != null) {
            tasks = tasks.stream()
                    .filter(t -> t.getStops().stream().anyMatch(st -> st.getSensor().getId().equals(sensorId)))
                    .toList();
        }

        String today = LocalDate.now(clock.withZone(ZoneOffset.UTC)).toString();
        int pending = 0, inProgress = 0, completed = 0, completedToday = 0, cancelled = 0;
        for (CollectionTask t : tasks) {
            switch (t.getStatus()) {
                case ASSIGNED -> pending++;
                case ACCEPTED -> inProgress++;
                case COMPLETED -> {
                    completed++;
                    if (t.getCompletedAt() != null && t.getCompletedAt().toString().startsWith(today)) {
                        completedToday++;
                    }
                }
                case CANCELLED -> cancelled++;
            }
        }

        List<BinFillSummaryDto> binsByFill = sensors.stream()
                .sorted((a, b) -> Double.compare(
                        b.getLastFillPercent() != null ? b.getLastFillPercent() : -1.0,
                        a.getLastFillPercent() != null ? a.getLastFillPercent() : -1.0))
                .map(s -> new BinFillSummaryDto(
                        s.getId(),
                        s.getBinId(),
                        s.getLabel(),
                        s.getLastFillPercent() != null ? s.getLastFillPercent() : 0.0,
                        s.getLastFillPercent() != null,
                        s.getStatus().name()
                ))
                .toList();

        long empCount = userRepository.countByAreaIdAndRole(areaId, User.Role.EMPLOYEE);

        return new DashboardSummaryResponse(
                new DashboardCardsDto(
                        sensors.size(), full, medium, normal, offline,
                        pending, inProgress, completedToday, completed, cancelled, empCount),
                List.of(
                        new ChartSliceDto("Normal", normal, "#16A34A"),
                        new ChartSliceDto("Medium", medium, "#D97706"),
                        new ChartSliceDto("Full", full, "#DC2626"),
                        new ChartSliceDto("Offline", offline, "#64748B")
                ),
                List.of(
                        new ChartSliceDto("Pending", pending, "#D97706"),
                        new ChartSliceDto("Accepted", inProgress, "#0284C7"),
                        new ChartSliceDto("Completed", completed, "#16A34A")
                ),
                binsByFill
        );
    }

    @Transactional(readOnly = true)
    public FillTrendsResponse getFillTrends(Long areaId, Long sensorId, int days) {
        int clampedDays = Math.min(90, Math.max(1, days));
        List<Sensor> areaSensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(areaId);
        Sensor target = sensorId != null
                ? areaSensors.stream().filter(s -> s.getId().equals(sensorId)).findFirst().orElse(null)
                : areaSensors.stream()
                        .max(Comparator.comparingDouble(s -> s.getLastFillPercent() != null ? s.getLastFillPercent() : -1.0))
                        .orElse(null);

        if (target == null) {
            return new FillTrendsResponse(null, List.of());
        }

        List<SensorReading> readings = readingRepository.findBySensorIdAndRecordedAtAfterOrderByRecordedAtAsc(
                target.getId(), clock.instant().minus(clampedDays, ChronoUnit.DAYS));

        List<FillTrendPointDto> points = readings.stream()
                .map(r -> new FillTrendPointDto(r.getFillPercent(), r.getDistanceCm(), r.getRecordedAt().toString()))
                .toList();

        return new FillTrendsResponse(
                new SensorRefDto(target.getId(), target.getBinId(), target.getLabel()),
                points
        );
    }

    @Transactional(readOnly = true)
    public CollectionsStatsResponse getCollectionsStats(Long areaId, int days, Long employeeId, Long sensorId) {
        int clampedDays = Math.min(90, Math.max(7, days));
        Instant cutoff = clock.instant().minus(clampedDays, ChronoUnit.DAYS);
        List<CollectionTask> tasks = employeeId != null
                ? taskRepository.findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(areaId, employeeId)
                : taskRepository.findByAreaIdOrderByCreatedAtDesc(areaId);

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

        List<DailyCollectionCountDto> out = byDay.entrySet().stream()
                .map(e -> new DailyCollectionCountDto(e.getKey(), e.getValue()))
                .toList();
        return new CollectionsStatsResponse(out);
    }

    @Transactional(readOnly = true)
    public EmployeeStatsResponse getEmployeeStats(Long areaId, int days, Long employeeId) {
        int clampedDays = Math.min(90, Math.max(1, days));
        Instant cutoff = clock.instant().minus(clampedDays, ChronoUnit.DAYS);
        List<User> employees = userRepository.findByAreaIdAndRoleOrderByCreatedAtDesc(areaId, User.Role.EMPLOYEE);
        if (employeeId != null) {
            employees = employees.stream().filter(e -> e.getId().equals(employeeId)).toList();
        }
        List<CollectionTask> areaTasks = taskRepository.findByAreaIdOrderByCreatedAtDesc(areaId);

        List<EmployeeStatDto> out = new ArrayList<>();
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
            out.add(new EmployeeStatDto(emp.getId(), emp.getName(), completed, open));
        }
        return new EmployeeStatsResponse(out);
    }
}
