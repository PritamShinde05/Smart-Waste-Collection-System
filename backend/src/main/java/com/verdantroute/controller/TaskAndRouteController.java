package com.verdantroute.controller;

import com.verdantroute.dto.EmployeeDtos.*;
import com.verdantroute.dto.TaskAndRouteDtos.*;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.EmployeeService;
import com.verdantroute.service.TaskService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class TaskAndRouteController {
    private final TaskService taskService;
    private final EmployeeService employeeService;

    public TaskAndRouteController(TaskService taskService, EmployeeService employeeService) {
        this.taskService = taskService;
        this.employeeService = employeeService;
    }

    @PostMapping("/routes/preview")
    public RoutePreviewResponse previewRoute(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody RoutePreviewRequest body) {
        return taskService.previewRoute(principal.areaId(), body);
    }

    @PostMapping("/tasks")
    public ResponseEntity<TaskDetailResponse> createTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody CreateTaskRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(taskService.createTask(principal.areaId(), principal.userId(), body));
    }

    @GetMapping("/tasks")
    public TaskListResponse listTasks(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long employeeId) {
        return taskService.listTasks(principal.areaId(), status, employeeId);
    }

    @GetMapping("/tasks/{id}")
    public TaskDetailResponse getTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        return taskService.getTaskDetail(principal.areaId(), id);
    }

    @PatchMapping("/tasks/{id}/cancel")
    public TaskDetailResponse cancelTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        return taskService.cancelTask(principal.areaId(), id);
    }

    @PostMapping("/tasks/{id}/reoptimize")
    public TaskDetailResponse reoptimizeTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody(required = false) ReoptimizeTaskRequest body) {
        return taskService.reoptimizeTask(principal.areaId(), id, body);
    }

    // ---- Employee Endpoints ----
    @GetMapping("/employee/tasks")
    public TaskListResponse myTasks(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status) {
        return taskService.listMyTasks(principal.userId(), principal.areaId(), status);
    }

    @GetMapping("/employee/tasks/{id}")
    public TaskDetailResponse myTaskDetail(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        return taskService.getMyTaskDetail(principal.userId(), principal.areaId(), id);
    }

    @PatchMapping("/employee/tasks/{id}/accept")
    public TaskDetailResponse acceptTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        return taskService.acceptTask(principal.userId(), principal.areaId(), id);
    }

    @PatchMapping("/employee/tasks/{id}/bins/{taskBinId}/collect")
    public TaskDetailResponse markBinCollected(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @PathVariable Long taskBinId) {
        return taskService.markBinCollected(principal.userId(), principal.areaId(), id, taskBinId);
    }

    @PatchMapping("/employee/tasks/{id}/complete")
    public TaskDetailResponse completeTask(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody(required = false) CompleteTaskRequest body) {
        return taskService.completeTask(principal.userId(), principal.areaId(), id, body);
    }

    @PatchMapping("/employee/location")
    public LocationUpdateResponse updateLocation(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody UpdateLocationRequest body) {
        return employeeService.updateLocation(principal.userId(), body);
    }
}
