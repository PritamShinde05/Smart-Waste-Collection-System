package com.verdantroute.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.entity.*;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.*;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.RouteOptimizationService;
import com.verdantroute.service.SensorService;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api")
public class TaskAndRouteController {
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

    public TaskAndRouteController(
            AreaRepository areaRepository,
            UserRepository userRepository,
            SensorRepository sensorRepository,
            TaskRepository taskRepository,
            TaskBinRepository taskBinRepository,
            NotificationRepository notificationRepository,
            RouteOptimizationService routeService,
            SensorService sensorService,
            RealtimeWebSocketHandler wsHandler,
            ObjectMapper objectMapper) {
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
    }

    @PostMapping("/routes/preview")
    @Transactional(readOnly = true)
    public Map<String, Object> previewRoute(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) throws Exception {
        Area area = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        String startType = String.valueOf(body.getOrDefault("startType", "DEPOT"));
        Long employeeId = body.get("employeeId") instanceof Number n ? n.longValue() : null;
        if (!(body.get("sensorIds") instanceof List<?> rawList) || rawList.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one bin to generate an optimized route.");
        }
        List<Long> sensorIds = rawList.stream()
                .filter(Number.class::isInstance)
                .map(x -> ((Number) x).longValue())
                .distinct()
                .toList();
        if (sensorIds.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one bin to generate an optimized route.");
        }

        double[] startCoords = resolveStartCoords(area, startType, employeeId);
        List<Sensor> bins = loadAreaSensors(area.getId(), sensorIds);
        RouteOptimizationService.OptimizedResult opt = routeService.optimize(startCoords[0], startCoords[1], bins);

        List<Map<String, Object>> stops = new ArrayList<>();
        for (int i = 0; i < opt.orderedBins().size(); i++) {
            Sensor b = opt.orderedBins().get(i);
            stops.add(Map.of(
                    "sensorId", b.getId(),
                    "binId", b.getBinId(),
                    "label", b.getLabel(),
                    "latitude", b.getLatitude(),
                    "longitude", b.getLongitude(),
                    "fillPercent", b.getLastFillPercent() != null ? b.getLastFillPercent() : 0.0,
                    "stopOrder", i + 1
            ));
        }

        return Map.of(
                "startType", startType,
                "startPoint", Map.of("label", "EMPLOYEE_LAST_LOCATION".equals(startType) ? "Employee Last Location" : area.getName() + " Depot", "latitude", startCoords[0], "longitude", startCoords[1]),
                "orderedStops", stops,
                "routeGeometry", objectMapper.readTree(opt.routeGeometryJson()),
                "totalDistanceMeters", opt.totalDistanceMeters(),
                "estimatedTimeSeconds", opt.estimatedTimeSeconds()
        );
    }

    @PostMapping("/tasks")
    @Transactional
    public ResponseEntity<Map<String, Object>> createTask(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) {
        if (!(body.get("employeeId") instanceof Number empNum)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Employee and at least one bin are required.");
        }
        if (!(body.get("sensorIds") instanceof List<?> rawList) || rawList.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Employee and at least one bin are required.");
        }
        Long employeeId = empNum.longValue();
        String startType = String.valueOf(body.getOrDefault("startType", "DEPOT"));
        String note = body.get("note") != null ? String.valueOf(body.get("note")).trim() : null;
        List<Long> sensorIds = rawList.stream()
                .filter(Number.class::isInstance)
                .map(x -> ((Number) x).longValue())
                .distinct()
                .toList();
        if (sensorIds.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one valid bin.");
        }

        Area area = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        User admin = userRepository.findById(principal.userId()).orElseThrow();
        User employee = userRepository.findByIdAndAreaIdAndRole(employeeId, area.getId(), User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        if (employee.getStatus() != User.Status.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Cannot assign task to inactive employee.");
        }

        double[] startCoords = resolveStartCoords(area, startType, employeeId);
        List<Sensor> bins = loadAreaSensors(area.getId(), sensorIds);
        RouteOptimizationService.OptimizedResult opt = routeService.optimize(startCoords[0], startCoords[1], bins);

        CollectionTask task = new CollectionTask();
        task.setArea(area);
        task.setCreatedBy(admin);
        task.setAssignedTo(employee);
        task.setStatus(CollectionTask.TaskStatus.ASSIGNED);
        task.setStartType(startType);
        task.setStartLat(startCoords[0]);
        task.setStartLng(startCoords[1]);
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

        Map<String, Object> detail = serializeTaskDetail(task);
        wsHandler.broadcastToAreaAdmins(area.getId(), "task:created", detail);
        wsHandler.broadcastToUser(employee.getId(), area.getId(), "task:assigned", detail);
        wsHandler.broadcastToUser(employee.getId(), area.getId(), "notification:new", Map.of(
                "type", "TASK_ASSIGNED", "relatedTaskId", task.getId(), "message", notifMsg
        ));
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("task", detail));
    }

    @GetMapping("/tasks")
    @Transactional(readOnly = true)
    public Map<String, Object> listTasks(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long employeeId) {
        List<CollectionTask> tasks = taskRepository.findByAreaIdOrderByCreatedAtDesc(principal.areaId());
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            CollectionTask.TaskStatus st = parseTaskStatus(status);
            tasks = tasks.stream().filter(t -> t.getStatus() == st).toList();
        }
        if (employeeId != null) {
            tasks = tasks.stream().filter(t -> t.getAssignedTo().getId().equals(employeeId)).toList();
        }
        return Map.of("tasks", tasks.stream().map(this::serializeTaskSummary).toList());
    }

    @GetMapping("/tasks/{id}")
    @Transactional(readOnly = true)
    public Map<String, Object> getTask(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        CollectionTask t = taskRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        return Map.of("task", serializeTaskDetail(t));
    }

    @PatchMapping("/tasks/{id}/cancel")
    @Transactional
    public Map<String, Object> cancelTask(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        CollectionTask t = taskRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() == CollectionTask.TaskStatus.COMPLETED || t.getStatus() == CollectionTask.TaskStatus.CANCELLED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Task cannot be cancelled.");
        }
        t.setStatus(CollectionTask.TaskStatus.CANCELLED);
        t.setCancelledAt(Instant.now());
        taskRepository.save(t);

        String cancelMsg = "Collection task #" + t.getId() + " has been cancelled by the admin.";
        Notification n = new Notification();
        n.setUser(t.getAssignedTo());
        n.setType("TASK_CANCELLED");
        n.setMessage(cancelMsg);
        n.setRelatedTaskId(t.getId());
        notificationRepository.save(n);

        Map<String, Object> detail = serializeTaskDetail(t);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), principal.areaId(), "notification:new", Map.of(
                "type", "TASK_CANCELLED", "relatedTaskId", t.getId(), "message", cancelMsg
        ));
        return Map.of("task", detail);
    }

    @PostMapping("/tasks/{id}/reoptimize")
    @Transactional
    public Map<String, Object> reoptimizeTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, Object> body) {
        CollectionTask t = taskRepository.findByIdAndAreaId(id, principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() == CollectionTask.TaskStatus.COMPLETED || t.getStatus() == CollectionTask.TaskStatus.CANCELLED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only active tasks can be re-optimized.");
        }

        String nextStartType = body != null && body.get("startType") != null
                ? String.valueOf(body.get("startType"))
                : t.getStartType();
        double[] startCoords = resolveStartCoords(t.getArea(), nextStartType, t.getAssignedTo().getId());

        List<Sensor> bins;
        if (body != null && body.get("sensorIds") instanceof List<?> rawList && !rawList.isEmpty()) {
            List<Long> sensorIds = rawList.stream()
                    .filter(Number.class::isInstance)
                    .map(x -> ((Number) x).longValue())
                    .distinct()
                    .toList();
            if (sensorIds.isEmpty()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Please select at least one bin.");
            }
            bins = loadAreaSensors(principal.areaId(), sensorIds);
        } else {
            bins = t.getStops().stream().map(TaskBin::getSensor).toList();
        }

        RouteOptimizationService.OptimizedResult opt = routeService.optimize(startCoords[0], startCoords[1], bins);

        Map<Long, Instant> prevCollected = new HashMap<>();
        Map<Long, Double> prevFill = new HashMap<>();
        for (TaskBin existing : t.getStops()) {
            prevCollected.put(existing.getSensor().getId(), existing.getCollectedAt());
            prevFill.put(existing.getSensor().getId(), existing.getFillAtAssignment());
        }

        t.setStartType(nextStartType);
        t.setStartLat(startCoords[0]);
        t.setStartLng(startCoords[1]);
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

        Map<String, Object> detail = serializeTaskDetail(t);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToUser(t.getAssignedTo().getId(), principal.areaId(), "notification:new", Map.of(
                "type", "TASK_ROUTE_UPDATED", "relatedTaskId", t.getId(), "message", reoptMsg
        ));
        return Map.of("task", detail);
    }

    // ---- Employee Endpoints ----
    @GetMapping("/employee/tasks")
    @Transactional(readOnly = true)
    public Map<String, Object> myTasks(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestParam(required = false) String status) {
        List<CollectionTask> tasks = taskRepository.findByAssignedToIdAndAreaIdOrderByCreatedAtDesc(
                principal.userId(), principal.areaId());
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            CollectionTask.TaskStatus st = parseTaskStatus(status);
            tasks = tasks.stream().filter(t -> t.getStatus() == st).toList();
        }
        return Map.of("tasks", tasks.stream().map(this::serializeTaskSummary).toList());
    }

    @GetMapping("/employee/tasks/{id}")
    @Transactional(readOnly = true)
    public Map<String, Object> myTaskDetail(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(id, principal.userId(), principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        return Map.of("task", serializeTaskDetail(t));
    }

    @PatchMapping("/employee/tasks/{id}/accept")
    @Transactional
    public Map<String, Object> acceptTask(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(id, principal.userId(), principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() != CollectionTask.TaskStatus.ASSIGNED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only assigned tasks can be accepted.");
        }
        t.setStatus(CollectionTask.TaskStatus.ACCEPTED);
        t.setAcceptedAt(Instant.now());
        taskRepository.save(t);
        Map<String, Object> detail = serializeTaskDetail(t);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToUser(principal.userId(), principal.areaId(), "task:updated", detail);
        return Map.of("task", detail);
    }

    @PatchMapping("/employee/tasks/{id}/bins/{taskBinId}/collect")
    @Transactional
    public Map<String, Object> markBinCollected(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @PathVariable Long taskBinId) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(id, principal.userId(), principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() != CollectionTask.TaskStatus.ACCEPTED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Accept task before marking bins collected.");
        }
        TaskBin tb = taskBinRepository.findByIdAndTaskId(taskBinId, id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Stop not found."));
        if (tb.getCollectedAt() == null) {
            tb.setCollectedAt(Instant.now());
            taskBinRepository.save(tb);
        }
        Sensor s = tb.getSensor();
        s.setLastFillPercent(0.0);
        s.setLastDistanceCm(s.getBinHeightCm());
        if (s.getStatus() != Sensor.SensorStatus.OFFLINE) s.setStatus(Sensor.SensorStatus.NORMAL);
        sensorRepository.save(s);

        Map<String, Object> detail = serializeTaskDetail(t);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "sensor:updated", sensorService.serializeSensor(s));
        wsHandler.broadcastToUser(principal.userId(), principal.areaId(), "task:updated", detail);
        return Map.of("task", detail);
    }

    @PatchMapping("/employee/tasks/{id}/complete")
    @Transactional
    public Map<String, Object> completeTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, Object> body) {
        CollectionTask t = taskRepository.findByIdAndAssignedToIdAndAreaId(id, principal.userId(), principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found."));
        if (t.getStatus() != CollectionTask.TaskStatus.ACCEPTED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only accepted tasks can be completed.");
        }
        Instant now = Instant.now();
        t.setStatus(CollectionTask.TaskStatus.COMPLETED);
        t.setCompletedAt(now);
        if (body != null && body.get("completionNote") != null) {
            t.setCompletionNote(String.valueOf(body.get("completionNote")).trim());
        }
        for (TaskBin tb : t.getStops()) {
            if (tb.getCollectedAt() == null) tb.setCollectedAt(now);
            Sensor s = tb.getSensor();
            s.setLastFillPercent(0.0);
            s.setLastDistanceCm(s.getBinHeightCm());
            if (s.getStatus() != Sensor.SensorStatus.OFFLINE) s.setStatus(Sensor.SensorStatus.NORMAL);
            sensorRepository.save(s);
            wsHandler.broadcastToAreaAdmins(principal.areaId(), "sensor:updated", sensorService.serializeSensor(s));
        }
        taskRepository.save(t);
        Map<String, Object> detail = serializeTaskDetail(t);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "task:updated", detail);
        wsHandler.broadcastToUser(principal.userId(), principal.areaId(), "task:updated", detail);
        return Map.of("task", detail);
    }

    @PatchMapping("/employee/location")
    @Transactional
    public Map<String, Object> updateLocation(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) {
        if (!(body.get("latitude") instanceof Number latNum) || !(body.get("longitude") instanceof Number lngNum)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Valid GPS latitude and longitude required.");
        }
        double lat = latNum.doubleValue();
        double lng = lngNum.doubleValue();
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "GPS coordinates out of range.");
        }
        User u = userRepository.findById(principal.userId()).orElseThrow();
        Instant now = Instant.now();
        u.setLastLat(lat);
        u.setLastLng(lng);
        u.setLastLocationAt(now);
        userRepository.save(u);
        return Map.of("success", true, "latitude", lat, "longitude", lng, "updatedAt", now.toString());
    }

    @GetMapping("/notifications")
    @Transactional(readOnly = true)
    public Map<String, Object> notifications(@AuthenticationPrincipal AuthPrincipal principal) {
        List<Map<String, Object>> list = notificationRepository.findTop30ByUserIdOrderByCreatedAtDesc(principal.userId())
                .stream()
                .map(n -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", n.getId());
                    m.put("type", n.getType());
                    m.put("message", n.getMessage());
                    m.put("relatedTaskId", n.getRelatedTaskId());
                    m.put("read", n.getReadFlag());
                    m.put("createdAt", n.getCreatedAt().toString());
                    return m;
                }).toList();
        return Map.of("notifications", list);
    }

    @PatchMapping("/notifications/read-all")
    @Transactional
    public Map<String, Object> readAll(@AuthenticationPrincipal AuthPrincipal principal) {
        List<Notification> unread = notificationRepository.findByUserIdAndReadFlagFalse(principal.userId());
        unread.forEach(n -> n.setReadFlag(true));
        notificationRepository.saveAll(unread);
        return Map.of("success", true);
    }

    @PatchMapping("/notifications/{id}/read")
    @Transactional
    public Map<String, Object> readOne(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        notificationRepository.findByIdAndUserId(id, principal.userId()).ifPresent(n -> {
            n.setReadFlag(true);
            notificationRepository.save(n);
        });
        return Map.of("success", true);
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

    private Map<String, Object> serializeTaskSummary(CollectionTask t) {
        long collected = t.getStops().stream().filter(s -> s.getCollectedAt() != null).count();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("status", t.getStatus().name());
        m.put("totalDistanceMeters", t.getTotalDistanceMeters());
        m.put("estimatedTimeSeconds", t.getEstimatedTimeSeconds());
        m.put("note", t.getNote());
        m.put("completionNote", t.getCompletionNote());
        m.put("createdAt", t.getCreatedAt().toString());
        m.put("acceptedAt", t.getAcceptedAt() != null ? t.getAcceptedAt().toString() : null);
        m.put("completedAt", t.getCompletedAt() != null ? t.getCompletedAt().toString() : null);
        m.put("cancelledAt", t.getCancelledAt() != null ? t.getCancelledAt().toString() : null);
        m.put("binCount", t.getStops().size());
        m.put("collectedCount", collected);
        m.put("assignedTo", Map.of(
                "id", t.getAssignedTo().getId(),
                "name", t.getAssignedTo().getName(),
                "mobile", t.getAssignedTo().getMobile(),
                "email", t.getAssignedTo().getEmail()
        ));
        return m;
    }

    private Map<String, Object> serializeTaskDetail(CollectionTask t) {
        Map<String, Object> m = serializeTaskSummary(t);
        m.put("areaId", t.getArea().getId());
        m.put("startType", t.getStartType());
        m.put("startLat", t.getStartLat());
        m.put("startLng", t.getStartLng());
        try {
            m.put("routeGeometry", objectMapper.readTree(t.getRouteGeometry()));
        } catch (Exception e) {
            m.put("routeGeometry", null);
        }
        m.put("createdBy", Map.of("id", t.getCreatedBy().getId(), "name", t.getCreatedBy().getName()));
        m.put("stops", t.getStops().stream().map(st -> {
            Map<String, Object> sm = new LinkedHashMap<>();
            sm.put("taskBinId", st.getId());
            sm.put("sensorId", st.getSensor().getId());
            sm.put("stopOrder", st.getStopOrder());
            sm.put("binId", st.getSensor().getBinId());
            sm.put("label", st.getSensor().getLabel());
            sm.put("latitude", st.getSensor().getLatitude());
            sm.put("longitude", st.getSensor().getLongitude());
            sm.put("fillAtAssignment", st.getFillAtAssignment());
            sm.put("currentFillPercent", st.getSensor().getLastFillPercent());
            sm.put("sensorStatus", st.getSensor().getStatus().name());
            sm.put("collectedAt", st.getCollectedAt() != null ? st.getCollectedAt().toString() : null);
            return sm;
        }).toList());
        return m;
    }
}
