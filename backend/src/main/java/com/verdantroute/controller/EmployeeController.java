package com.verdantroute.controller;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.CollectionTask;
import com.verdantroute.entity.User;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.TaskRepository;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.AuthService;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/employees")
public class EmployeeController {
    private final UserRepository userRepository;
    private final AreaRepository areaRepository;
    private final TaskRepository taskRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthService authService;
    private final RealtimeWebSocketHandler wsHandler;

    public EmployeeController(
            UserRepository userRepository,
            AreaRepository areaRepository,
            TaskRepository taskRepository,
            PasswordEncoder passwordEncoder,
            AuthService authService,
            RealtimeWebSocketHandler wsHandler) {
        this.userRepository = userRepository;
        this.areaRepository = areaRepository;
        this.taskRepository = taskRepository;
        this.passwordEncoder = passwordEncoder;
        this.authService = authService;
        this.wsHandler = wsHandler;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public Map<String, Object> list(@AuthenticationPrincipal AuthPrincipal principal) {
        List<User> employees = userRepository.findByAreaIdAndRoleOrderByCreatedAtDesc(
                principal.areaId(), User.Role.EMPLOYEE);
        List<Map<String, Object>> out = employees.stream().map(e -> {
            long open = taskRepository.countByAssignedToIdAndStatusIn(
                    e.getId(), List.of(CollectionTask.TaskStatus.ASSIGNED, CollectionTask.TaskStatus.ACCEPTED));
            long completed = taskRepository.countByAssignedToIdAndStatus(
                    e.getId(), CollectionTask.TaskStatus.COMPLETED);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.getId());
            m.put("name", e.getName());
            m.put("email", e.getEmail());
            m.put("mobile", e.getMobile());
            m.put("status", e.getStatus().name());
            m.put("openTasks", open);
            m.put("completedTasks", completed);
            m.put("lastLat", e.getLastLat());
            m.put("lastLng", e.getLastLng());
            m.put("lastLocationAt", e.getLastLocationAt() != null ? e.getLastLocationAt().toString() : null);
            m.put("createdAt", e.getCreatedAt().toString());
            return m;
        }).toList();
        return Map.of("employees", out);
    }

    @PostMapping
    @Transactional
    public ResponseEntity<Map<String, Object>> create(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) {
        String name = body.get("name") != null ? String.valueOf(body.get("name")).trim() : "";
        String email = body.get("email") != null ? String.valueOf(body.get("email")).trim().toLowerCase() : "";
        String mobile = body.get("mobile") != null ? String.valueOf(body.get("mobile")).trim() : "";
        String password = body.get("password") != null ? String.valueOf(body.get("password")) : "";
        if (name.isBlank() || email.isBlank() || mobile.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Name, email, and mobile are required.");
        }
        authService.validateEmailAndMobile(email, mobile);
        authService.validatePasswordStrength(password);

        if (userRepository.existsByEmailIgnoreCaseOrMobile(email, mobile)) {
            throw new ApiException(HttpStatus.CONFLICT, "Email or mobile already registered.");
        }

        Area area = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));

        User emp = new User();
        emp.setArea(area);
        emp.setName(name);
        emp.setEmail(email);
        emp.setMobile(mobile);
        emp.setPasswordHash(passwordEncoder.encode(password));
        emp.setRole(User.Role.EMPLOYEE);
        emp.setStatus("INACTIVE".equals(body.get("status")) ? User.Status.INACTIVE : User.Status.ACTIVE);
        emp = userRepository.save(emp);

        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", emp.getId());
        dto.put("name", emp.getName());
        dto.put("email", emp.getEmail());
        dto.put("mobile", emp.getMobile());
        dto.put("status", emp.getStatus().name());
        dto.put("openTasks", 0);
        dto.put("completedTasks", 0);
        dto.put("lastLat", null);
        dto.put("lastLng", null);
        dto.put("lastLocationAt", null);
        dto.put("createdAt", emp.getCreatedAt().toString());
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "employee:updated", dto);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("employee", dto));
    }

    @PutMapping("/{id}")
    @Transactional
    public Map<String, Object> update(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        User emp = userRepository.findByIdAndAreaIdAndRole(id, principal.areaId(), User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        String nextName = body.get("name") != null ? String.valueOf(body.get("name")).trim() : emp.getName();
        String nextEmail = body.get("email") != null ? String.valueOf(body.get("email")).trim().toLowerCase() : emp.getEmail();
        String nextMobile = body.get("mobile") != null ? String.valueOf(body.get("mobile")).trim() : emp.getMobile();
        if (nextName.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Name cannot be blank.");
        }
        authService.validateEmailAndMobile(nextEmail, nextMobile);
        if (userRepository.existsByEmailIgnoreCaseAndIdNot(nextEmail, id)
                || userRepository.existsByMobileAndIdNot(nextMobile, id)) {
            throw new ApiException(HttpStatus.CONFLICT, "Email or mobile number already in use by another account.");
        }

        emp.setName(nextName);
        emp.setEmail(nextEmail);
        emp.setMobile(nextMobile);
        if (body.get("status") != null) {
            String st = String.valueOf(body.get("status"));
            if (!"ACTIVE".equals(st) && !"INACTIVE".equals(st)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Status must be ACTIVE or INACTIVE.");
            }
            emp.setStatus("INACTIVE".equals(st) ? User.Status.INACTIVE : User.Status.ACTIVE);
        }
        userRepository.save(emp);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "employee:updated", Map.of("id", emp.getId(), "status", emp.getStatus().name()));
        return Map.of("employee", Map.of("id", emp.getId(), "name", emp.getName(), "email", emp.getEmail(), "mobile", emp.getMobile(), "status", emp.getStatus().name()));
    }

    @PatchMapping("/{id}/status")
    @Transactional
    public Map<String, Object> updateStatus(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        String st = String.valueOf(body.getOrDefault("status", ""));
        if (!"ACTIVE".equals(st) && !"INACTIVE".equals(st)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Status must be ACTIVE or INACTIVE.");
        }
        User emp = userRepository.findByIdAndAreaIdAndRole(id, principal.areaId(), User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        emp.setStatus("INACTIVE".equals(st) ? User.Status.INACTIVE : User.Status.ACTIVE);
        userRepository.save(emp);
        wsHandler.broadcastToAreaAdmins(principal.areaId(), "employee:updated", Map.of("id", emp.getId(), "status", emp.getStatus().name()));
        return Map.of("success", true, "status", emp.getStatus().name());
    }

    @PatchMapping("/{id}/reset-password")
    @Transactional
    public Map<String, Object> resetPassword(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        User emp = userRepository.findByIdAndAreaIdAndRole(id, principal.areaId(), User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        String newPwd = body.get("newPassword") != null ? String.valueOf(body.get("newPassword")) : "";
        authService.validatePasswordStrength(newPwd);
        emp.setPasswordHash(passwordEncoder.encode(newPwd));
        userRepository.save(emp);
        return Map.of("success", true);
    }

    @GetMapping("/{id}/history")
    @Transactional(readOnly = true)
    public Map<String, Object> history(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        User emp = userRepository.findByIdAndAreaIdAndRole(id, principal.areaId(), User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        List<CollectionTask> tasks = taskRepository.findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(principal.areaId(), id);
        return Map.of(
                "employee", Map.of("id", emp.getId(), "name", emp.getName(), "email", emp.getEmail(), "mobile", emp.getMobile(), "status", emp.getStatus().name()),
                "tasks", tasks.stream().map(t -> Map.of(
                        "id", t.getId(),
                        "status", t.getStatus().name(),
                        "totalDistanceMeters", t.getTotalDistanceMeters(),
                        "estimatedTimeSeconds", t.getEstimatedTimeSeconds(),
                        "binCount", t.getStops().size(),
                        "createdAt", t.getCreatedAt().toString()
                )).toList()
        );
    }
}
