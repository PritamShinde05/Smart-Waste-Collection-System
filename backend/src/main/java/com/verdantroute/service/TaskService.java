package com.verdantroute.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.dto.NotificationDtos.NotificationEventPayload;
import com.verdantroute.dto.TaskAndRouteDtos.*;
import com.verdantroute.entity.*;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.*;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.*;

@Service
public class TaskService {
    private final AreaRepository areaRepository;
    private final UserRepository userRepository;
    private final SensorRepository sensorRepository;
    private final TaskRepository taskRepository;
    private final TaskBinRepository taskBinRepository;
    private final NotificationRepository notificationRepository;
    private final RouteOptimizationService routeService;
    private final SensorService sensorService;
    private final RealtimeWebSocketHandler wsHandler;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public TaskService(
            AreaRepository areaRepository,
            UserRepository userRepository,
            SensorRepository sensorRepository,
            TaskRepository taskRepository,
            TaskBinRepository taskBinRepository,
            NotificationRepository notificationRepository,
            RouteOptimizationService routeService,
            SensorService sensorService,
            RealtimeWebSocketHandler wsHandler,
            ObjectMapper objectMapper,
            Clock clock) {
        this.areaRepository = areaRepository;
        this.userRepository = userRepository;
        this.sensorRepository = sensorRepository;
        this.taskRepository = taskRepository;
        this.taskBinRepository = taskBinRepository;
        this.notificationRepository = notificationRepository;
        this.routeService = routeService;
        this.sensorService = sensorService;
        this.wsHandler = wsHandler;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public RoutePreviewResponse previewRoute(Long areaId, RoutePreviewRequest req) {
        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        String startType = normalizeStartType(req.startType());
        boolean returnToDepot = Boolean.TRUE.equals(req.returnToDepot());

        List<Long> sensorIds = normalizeSensorIds(req.sensorIds());
        double[] startCoords = resolveStartCoords(area, startType, req.employeeId());
        List<Sensor> bins = loadAreaSensors(area.getId(), sensorIds);
        RouteOptimizationService.OptimizedResult opt = routeService.optimize(startCoords[0], startCoords[1], bins, returnToDepot);

        List<OrderedStopPreviewDto> stops = new ArrayList<>();
        for (int i = 0; i < opt.orderedBins().size(); i++) {
            Sensor b = opt.orderedBins().get(i);
            stops.add(new OrderedStopPreviewDto(
                    b.getId(),
                    b.getBinId(),
                    b.getLabel(),
                    b.getLatitude(),
                    b.getLongitude(),
                    b.getLastFillPercent() != null ? b.getLastFillPercent() : 0.0,
                    i + 1
            ));
        }

        String startLabel = "EMPLOYEE_LAST_LOCATION".equals(startType) ? "Employee Last Location" : area.getName() + " Depot";
        return new RoutePreviewResponse(
                startType,
                returnToDepot,
                new StartPointDto(startLabel, startCoords[0], startCoords[1]),
                stops,
                parseGeometry(opt.routeGeometryJson()),
                opt.totalDistanceMeters(),
                opt.estimatedTimeSeconds()
        );
    }

    @Transactional
    public TaskDetailResponse createTask(Long areaId, Long adminId, CreateTaskRequest req) {
        List<Long> sensorIds = normalizeSensorIds(req.sensorIds());
        String startType = normalizeStartType(req.startType());
        boolean returnToDepot = Boolean.TRUE.equals(req.returnToDepot());
        String note = req.note() != null && !req.note().trim().isEmpty() ? req.note().trim() : null;

        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        User admin = userRepository.findById(adminId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Admin account not found."));
        User employee = userRepository.findByIdAndAreaIdAndRole(req.employeeId(), area.getId(), User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        if (employee.getStatus() != User.Status.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Cannot assign task to inactive employee.");
        }

        double[] startCoords = resolveStartCoords(area, startType, employee.getId());
        List<Sensor> bins = loadAreaSensors(area.getId(), sensorIds);
        RouteOptimizationService.OptimizedResult opt = routeService.optimize(startCoords[0], startCoords[1], bins, returnToDepot);

        CollectionTask task = new CollectionTask();
        task.setArea(area);
        task.setCreatedBy(admin);
        task.setAssignedTo(employee);
        task.setStatus(CollectionTask.TaskStatus.ASSIGNED);
        task.setStartType(startType);
        task.setStartLat(startCoords[0]);
        task.setStartLng(startCoords[1]);
        task.setReturnToDepot(returnToDepot);
        task.setRouteGeometry(opt.routeGeometryJson());
        task.setTotalDistanceMeters(opt.totalDistanceMeters());
        task.setEstimatedTimeSeconds(opt.estimatedTimeSeconds());
        task.setNote(note);

        for (int i = 0; i < opt.orderedBins().size(); i++) {
            Sensor b = opt.orderedBins().get(i);
            TaskBin tb = new TaskBin();
            tb.setTask(task);
            tb.setSensor(b);
            tb.setStopOrder(i + 1);
            tb.setFillAtAssignment(b.getLastFillPercent() != null ? b.getLastFillPercent() : 0.0);
            task.getStops().add(tb);
        }

        task = taskRepository.save(task);

        String notifMsg = "New collection task #" + task.getId() + " with " + task.getStops().size() + " bin(s) assigned.";
        Notification n = new Notification();
        n.setUser(employee);
        n.setType("TASK_ASSIGNED");
        n.setMessage(notifMsg);
        n.setRelatedTaskId(task.getId());
        notificationRepository.save(n);

        TaskDetailDto detail = toTaskDetailDto(task);
        wsHandler.broadcastToAreaAdmins(area.getId(), "task:created", detail);
        wsHandler.broadcastToUser(employee.getId(), area.getId(), "task:assigned", detail);
        wsHandler.broadcastToUser(employee.getId(), area.getId(), "notification:new",
                new NotificationEventPayload("TASK_ASSIGNED", task.getId(), notifMsg));
        return new TaskDetailResponse(detail);
    }

    @Transactional(readOnly = true)
    public TaskListResponse listTasks(Long areaId, String status, Long employeeId) {
        List<CollectionTask> tasks = taskRepository.findByAreaIdOrderByCreatedAtDesc(areaId);
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            CollectionTask.TaskStatus st = parseTaskStatus(status);
            tasks = tasks.stream().filter(t -> t.getStatus() == st).toList();
        }
        if (employeeId != null) {
            tasks = tasks.stream().filter(t -> t.getAssignedTo().getId().equals(employeeId)).toList();
        }
        return new TaskListResponse(tasks.stream().map(this::toTaskSummaryDto).toList());
    }

    @Transactional(readOnly = true)
    public TaskDetailResponse getTaskDetail(Long areaId, Long taskId) {
        CollectionTask t = taskRepository.findByIdAndAreaId(taskId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        return new TaskDetailResponse(toTaskDetailDto(t));
    }

    @Transactional
    public TaskDetailResponse cancelTask(Long areaId, Long taskId) {
        CollectionTask t = taskRepository.findByIdAndAreaId(taskId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() == CollectionTask.TaskStatus.COMPLETED || t.getStatus() == CollectionTask.TaskStatus.CANCELLED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Task cannot be cancelled.");
        }
        t.setStatus(CollectionTask.TaskStatus.CANCELLED);
        t.setCancelledAt(clock.instant());
        taskRepository.save(t);

        String cancelMsg = "Collection task #" + t.getId() + " has been cancelled by the admin.";
        Notification n = new Notification();
        n.setUser(t.getAssignedTo());
        n.setType("TASK_CANCELLED");
        n.setMessage(cancelMsg);
        n.setRelatedTaskId(t.getId());
        notificationRepository.save(n);

        TaskDetailDto detail = toTaskDetailDto(t);
        wsHandler.broadcastToAreaAdmins(areaId, "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), areaId, "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), areaId, "notification:new",
                new NotificationEventPayload("TASK_CANCELLED", t.getId(), cancelMsg));
        return new TaskDetailResponse(detail);
    }

    @Transactional
    public TaskDetailResponse reoptimizeTask(Long areaId, Long taskId, ReoptimizeTaskRequest req) {
        CollectionTask t = taskRepository.findByIdAndAreaId(taskId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() == CollectionTask.TaskStatus.COMPLETED || t.getStatus() == CollectionTask.TaskStatus.CANCELLED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only active tasks can be re-optimized.");
        }

        String nextStartType = req != null && req.startType() != null
                ? normalizeStartType(req.startType())
                : t.getStartType();
        boolean nextReturnToDepot = req != null && req.returnToDepot() != null
                ? req.returnToDepot()
                : Boolean.TRUE.equals(t.getReturnToDepot());
        double[] startCoords = resolveStartCoords(t.getArea(), nextStartType, t.getAssignedTo().getId());

        List<Sensor> bins;
        if (req != null && req.sensorIds() != null && !req.sensorIds().isEmpty()) {
            bins = loadAreaSensors(areaId, normalizeSensorIds(req.sensorIds()));
        } else {
            bins = t.getStops().stream().map(TaskBin::getSensor).toList();
        }

        RouteOptimizationService.OptimizedResult opt = routeService.optimize(startCoords[0], startCoords[1], bins, nextReturnToDepot);

        Map<Long, Instant> prevCollected = new HashMap<>();
        Map<Long, Double> prevFill = new HashMap<>();
        for (TaskBin existing : t.getStops()) {
            prevCollected.put(existing.getSensor().getId(), existing.getCollectedAt());
            prevFill.put(existing.getSensor().getId(), existing.getFillAtAssignment());
        }

        t.setStartType(nextStartType);
        t.setStartLat(startCoords[0]);
        t.setStartLng(startCoords[1]);
        t.setReturnToDepot(nextReturnToDepot);
        t.setRouteGeometry(opt.routeGeometryJson());
        t.setTotalDistanceMeters(opt.totalDistanceMeters());
        t.setEstimatedTimeSeconds(opt.estimatedTimeSeconds());

        t.getStops().clear();
        taskRepository.flush();
        for (int i = 0; i < opt.orderedBins().size(); i++) {
            Sensor b = opt.orderedBins().get(i);
            TaskBin tb = new TaskBin();
            tb.setTask(t);
            tb.setSensor(b);
            tb.setStopOrder(i + 1);
            tb.setFillAtAssignment(prevFill.getOrDefault(b.getId(), b.getLastFillPercent() != null ? b.getLastFillPercent() : 0.0));
            tb.setCollectedAt(prevCollected.get(b.getId()));
            t.getStops().add(tb);
        }
        taskRepository.save(t);

        String reoptMsg = "Route for task #" + t.getId() + " was updated by the admin.";
        Notification n = new Notification();
        n.setUser(t.getAssignedTo());
        n.setType("TASK_ROUTE_UPDATED");
        n.setMessage(reoptMsg);
        n.setRelatedTaskId(t.getId());
        notificationRepository.save(n);

        TaskDetailDto detail = toTaskDetailDto(t);
        wsHandler.broadcastToAreaAdmins(areaId, "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), areaId, "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), areaId, "notification:new",
                new NotificationEventPayload("TASK_ROUTE_UPDATED", t.getId(), reoptMsg));
        return new TaskDetailResponse(detail);
    }

    @Transactional(readOnly = true)
    public TaskListResponse listMyTasks(Long userId, Long areaId, String status) {
        List<CollectionTask> tasks = taskRepository.findByAssignedToIdAndAreaIdOrderByCreatedAtDesc(userId, areaId);
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            CollectionTask.TaskStatus st = parseTaskStatus(status);
            tasks = tasks.stream().filter(t -> t.getStatus() == st).toList();
        }
        return new TaskListResponse(tasks.stream().map(this::toTaskSummaryDto).toList());
    }

    @Transactional(readOnly = true)
    public TaskDetailResponse getMyTaskDetail(Long userId, Long areaId, Long taskId) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(taskId, userId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        return new TaskDetailResponse(toTaskDetailDto(t));
    }

    @Transactional
    public TaskDetailResponse acceptTask(Long userId, Long areaId, Long taskId) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(taskId, userId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() != CollectionTask.TaskStatus.ASSIGNED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only assigned tasks can be accepted.");
        }
        t.setStatus(CollectionTask.TaskStatus.ACCEPTED);
        t.setAcceptedAt(clock.instant());
        taskRepository.save(t);
        TaskDetailDto detail = toTaskDetailDto(t);
        wsHandler.broadcastToAreaAdmins(areaId, "task:updated", detail);
        wsHandler.broadcastToUser(userId, areaId, "task:updated", detail);
        return new TaskDetailResponse(detail);
    }

    @Transactional
    public TaskDetailResponse markBinCollected(Long userId, Long areaId, Long taskId, Long taskBinId) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(taskId, userId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() != CollectionTask.TaskStatus.ACCEPTED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Accept task before marking bins collected.");
        }
        TaskBin tb = taskBinRepository.findByIdAndTaskId(taskBinId, taskId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Stop not found."));
        if (tb.getCollectedAt() == null) {
            tb.setCollectedAt(clock.instant());
            taskBinRepository.save(tb);
        }
        Sensor s = tb.getSensor();
        s.setLastFillPercent(0.0);
        s.setLastDistanceCm(s.getBinHeightCm());
        if (s.getStatus() != Sensor.SensorStatus.OFFLINE) {
            s.setStatus(Sensor.SensorStatus.NORMAL);
        }
        sensorRepository.save(s);

        TaskDetailDto detail = toTaskDetailDto(t);
        wsHandler.broadcastToAreaAdmins(areaId, "task:updated", detail);
        wsHandler.broadcastToAreaAdmins(areaId, "sensor:updated", sensorService.toSensorDto(s));
        wsHandler.broadcastToUser(userId, areaId, "task:updated", detail);
        return new TaskDetailResponse(detail);
    }

    @Transactional
    public TaskDetailResponse completeTask(Long userId, Long areaId, Long taskId, CompleteTaskRequest req) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(taskId, userId, areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() != CollectionTask.TaskStatus.ACCEPTED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only accepted tasks can be completed.");
        }
        Instant now = clock.instant();
        t.setStatus(CollectionTask.TaskStatus.COMPLETED);
        t.setCompletedAt(now);
        if (req != null && req.completionNote() != null && !req.completionNote().trim().isEmpty()) {
            t.setCompletionNote(req.completionNote().trim());
        }
        for (TaskBin tb : t.getStops()) {
            if (tb.getCollectedAt() == null) tb.setCollectedAt(now);
            Sensor s = tb.getSensor();
            s.setLastFillPercent(0.0);
            s.setLastDistanceCm(s.getBinHeightCm());
            if (s.getStatus() != Sensor.SensorStatus.OFFLINE) {
                s.setStatus(Sensor.SensorStatus.NORMAL);
            }
            sensorRepository.save(s);
            wsHandler.broadcastToAreaAdmins(areaId, "sensor:updated", sensorService.toSensorDto(s));
        }
        taskRepository.save(t);
        TaskDetailDto detail = toTaskDetailDto(t);
        wsHandler.broadcastToAreaAdmins(areaId, "task:updated", detail);
        wsHandler.broadcastToUser(userId, areaId, "task:updated", detail);
        return new TaskDetailResponse(detail);
    }

    private String normalizeStartType(String raw) {
        return "EMPLOYEE_LAST_LOCATION".equals(raw) ? "EMPLOYEE_LAST_LOCATION" : "DEPOT";
    }

    private List<Long> normalizeSensorIds(List<Long> raw) {
        if (raw == null || raw.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one bin.");
        }
        List<Long> ids = raw.stream().filter(Objects::nonNull).filter(id -> id > 0).distinct().toList();
        if (ids.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one valid bin.");
        }
        return ids;
    }

    private CollectionTask.TaskStatus parseTaskStatus(String raw) {
        try {
            return CollectionTask.TaskStatus.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid task status filter: " + raw);
        }
    }

    private double[] resolveStartCoords(Area area, String startType, Long employeeId) {
        if ("EMPLOYEE_LAST_LOCATION".equals(startType) && employeeId != null) {
            User emp = userRepository.findByIdAndAreaIdAndRole(employeeId, area.getId(), User.Role.EMPLOYEE)
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
            if (emp.getLastLat() != null && emp.getLastLng() != null) {
                return new double[]{emp.getLastLat(), emp.getLastLng()};
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "Employee has no recent GPS location yet.");
        }
        return new double[]{area.getCentreLat(), area.getCentreLng()};
    }

    private List<Sensor> loadAreaSensors(Long areaId, List<Long> sensorIds) {
        List<Sensor> out = new ArrayList<>();
        for (Long sid : sensorIds) {
            out.add(sensorRepository.findByIdAndAreaId(sid, areaId)
                    .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "Bin not found in area: " + sid)));
        }
        return out;
    }

    private JsonNode parseGeometry(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private TaskSummaryDto toTaskSummaryDto(CollectionTask t) {
        long collected = t.getStops().stream().filter(s -> s.getCollectedAt() != null).count();
        return new TaskSummaryDto(
                t.getId(),
                t.getStatus().name(),
                t.getTotalDistanceMeters(),
                t.getEstimatedTimeSeconds(),
                t.getNote(),
                t.getCompletionNote(),
                t.getCreatedAt().toString(),
                t.getAcceptedAt() != null ? t.getAcceptedAt().toString() : null,
                t.getCompletedAt() != null ? t.getCompletedAt().toString() : null,
                t.getCancelledAt() != null ? t.getCancelledAt().toString() : null,
                t.getStops().size(),
                collected,
                new TaskAssigneeDto(
                        t.getAssignedTo().getId(),
                        t.getAssignedTo().getName(),
                        t.getAssignedTo().getMobile(),
                        t.getAssignedTo().getEmail()
                )
        );
    }

    private TaskDetailDto toTaskDetailDto(CollectionTask t) {
        List<TaskStopDto> stops = t.getStops().stream()
                .map(st -> new TaskStopDto(
                        st.getId(),
                        st.getSensor().getId(),
                        st.getStopOrder(),
                        st.getSensor().getBinId(),
                        st.getSensor().getLabel(),
                        st.getSensor().getLatitude(),
                        st.getSensor().getLongitude(),
                        st.getFillAtAssignment(),
                        st.getSensor().getLastFillPercent(),
                        st.getSensor().getStatus().name(),
                        st.getCollectedAt() != null ? st.getCollectedAt().toString() : null
                ))
                .toList();

        return new TaskDetailDto(
                t.getId(),
                t.getArea().getId(),
                t.getStatus().name(),
                t.getStartType(),
                Boolean.TRUE.equals(t.getReturnToDepot()),
                t.getStartLat(),
                t.getStartLng(),
                parseGeometry(t.getRouteGeometry()),
                t.getTotalDistanceMeters(),
                t.getEstimatedTimeSeconds(),
                t.getNote(),
                t.getCompletionNote(),
                t.getCreatedAt().toString(),
                t.getAcceptedAt() != null ? t.getAcceptedAt().toString() : null,
                t.getCompletedAt() != null ? t.getCompletedAt().toString() : null,
                t.getCancelledAt() != null ? t.getCancelledAt().toString() : null,
                new TaskCreatorDto(t.getCreatedBy().getId(), t.getCreatedBy().getName()),
                new TaskAssigneeDto(
                        t.getAssignedTo().getId(),
                        t.getAssignedTo().getName(),
                        t.getAssignedTo().getMobile(),
                        t.getAssignedTo().getEmail()
                ),
                stops
        );
    }
}
