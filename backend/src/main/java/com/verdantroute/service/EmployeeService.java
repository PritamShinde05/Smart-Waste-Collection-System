package com.verdantroute.service;

import com.verdantroute.dto.EmployeeDtos.*;
import com.verdantroute.dto.TaskAndRouteDtos.*;
import com.verdantroute.entity.Area;
import com.verdantroute.entity.CollectionTask;
import com.verdantroute.entity.User;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.TaskRepository;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.util.ValidationUtil;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class EmployeeService {
    private final UserRepository userRepository;
    private final AreaRepository areaRepository;
    private final TaskRepository taskRepository;
    private final PasswordEncoder passwordEncoder;
    private final RealtimeWebSocketHandler wsHandler;
    private final Clock clock;

    public EmployeeService(
            UserRepository userRepository,
            AreaRepository areaRepository,
            TaskRepository taskRepository,
            PasswordEncoder passwordEncoder,
            RealtimeWebSocketHandler wsHandler,
            Clock clock) {
        this.userRepository = userRepository;
        this.areaRepository = areaRepository;
        this.taskRepository = taskRepository;
        this.passwordEncoder = passwordEncoder;
        this.wsHandler = wsHandler;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public EmployeeListResponse listEmployees(Long areaId) {
        List<User> employees = userRepository.findByAreaIdAndRoleOrderByCreatedAtDesc(areaId, User.Role.EMPLOYEE);
        List<EmployeeDto> list = employees.stream().map(this::toEmployeeDtoWithCounts).toList();
        return new EmployeeListResponse(list);
    }

    @Transactional
    public EmployeeSingleResponse createEmployee(Long areaId, CreateEmployeeRequest req) {
        String name = req.name() != null ? req.name().trim() : "";
        String email = req.email() != null ? req.email().trim().toLowerCase() : "";
        String mobile = req.mobile() != null ? req.mobile().trim() : "";
        if (name.isBlank() || email.isBlank() || mobile.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Name, email, and mobile are required.");
        }
        ValidationUtil.validateEmailAndMobile(email, mobile);
        ValidationUtil.validatePasswordStrength(req.password());

        if (userRepository.existsByEmailIgnoreCaseOrMobile(email, mobile)) {
            throw new ApiException(HttpStatus.CONFLICT, "Email or mobile already registered.");
        }

        Area area = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));

        User emp = new User();
        emp.setArea(area);
        emp.setName(name);
        emp.setEmail(email);
        emp.setMobile(mobile);
        emp.setPasswordHash(passwordEncoder.encode(req.password()));
        emp.setRole(User.Role.EMPLOYEE);
        emp.setStatus("INACTIVE".equalsIgnoreCase(req.status()) ? User.Status.INACTIVE : User.Status.ACTIVE);
        emp = userRepository.save(emp);

        EmployeeDto dto = toEmployeeDto(emp, 0, 0);
        wsHandler.broadcastToAreaAdmins(areaId, "employee:updated", dto);
        return new EmployeeSingleResponse(dto);
    }

    @Transactional
    public EmployeeSingleResponse updateEmployee(Long areaId, Long employeeId, UpdateEmployeeRequest req) {
        User emp = userRepository.findByIdAndAreaIdAndRole(employeeId, areaId, User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));

        String nextName = req.name() != null ? req.name().trim() : emp.getName();
        String nextEmail = req.email() != null ? req.email().trim().toLowerCase() : emp.getEmail();
        String nextMobile = req.mobile() != null ? req.mobile().trim() : emp.getMobile();
        if (nextName.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Name cannot be blank.");
        }
        ValidationUtil.validateEmailAndMobile(nextEmail, nextMobile);
        if (userRepository.existsByEmailIgnoreCaseAndIdNot(nextEmail, employeeId)
                || userRepository.existsByMobileAndIdNot(nextMobile, employeeId)) {
            throw new ApiException(HttpStatus.CONFLICT, "Email or mobile number already in use by another account.");
        }

        emp.setName(nextName);
        emp.setEmail(nextEmail);
        emp.setMobile(nextMobile);
        if (req.status() != null) {
            String st = req.status().trim().toUpperCase();
            if (!"ACTIVE".equals(st) && !"INACTIVE".equals(st)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Status must be ACTIVE or INACTIVE.");
            }
            emp.setStatus("INACTIVE".equals(st) ? User.Status.INACTIVE : User.Status.ACTIVE);
        }
        userRepository.save(emp);

        EmployeeDto dto = toEmployeeDtoWithCounts(emp);
        wsHandler.broadcastToAreaAdmins(areaId, "employee:updated", Map.of("id", emp.getId(), "status", emp.getStatus().name()));
        return new EmployeeSingleResponse(dto);
    }

    @Transactional
    public EmployeeStatusResponse updateEmployeeStatus(Long areaId, Long employeeId, UpdateEmployeeStatusRequest req) {
        String st = req.status() != null ? req.status().trim().toUpperCase() : "";
        if (!"ACTIVE".equals(st) && !"INACTIVE".equals(st)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Status must be ACTIVE or INACTIVE.");
        }
        User emp = userRepository.findByIdAndAreaIdAndRole(employeeId, areaId, User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        emp.setStatus("INACTIVE".equals(st) ? User.Status.INACTIVE : User.Status.ACTIVE);
        userRepository.save(emp);
        wsHandler.broadcastToAreaAdmins(areaId, "employee:updated", Map.of("id", emp.getId(), "status", emp.getStatus().name()));
        return new EmployeeStatusResponse(true, emp.getStatus().name());
    }

    @Transactional
    public void resetPassword(Long areaId, Long employeeId, ResetEmployeePasswordRequest req) {
        User emp = userRepository.findByIdAndAreaIdAndRole(employeeId, areaId, User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        ValidationUtil.validatePasswordStrength(req.newPassword());
        emp.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        userRepository.save(emp);
    }

    @Transactional(readOnly = true)
    public EmployeeHistoryResponse getHistory(Long areaId, Long employeeId) {
        User emp = userRepository.findByIdAndAreaIdAndRole(employeeId, areaId, User.Role.EMPLOYEE)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Employee not found."));
        List<CollectionTask> tasks = taskRepository.findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(areaId, employeeId);
        List<TaskSummaryDto> summaries = tasks.stream().map(t -> {
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
                    new TaskAssigneeDto(emp.getId(), emp.getName(), emp.getMobile(), emp.getEmail())
            );
        }).toList();
        return new EmployeeHistoryResponse(toEmployeeDtoWithCounts(emp), summaries);
    }

    @Transactional
    public LocationUpdateResponse updateLocation(Long userId, UpdateLocationRequest req) {
        ValidationUtil.validateCoordinates(req.latitude(), req.longitude());
        User u = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "User not found."));
        Instant now = clock.instant();
        u.setLastLat(req.latitude());
        u.setLastLng(req.longitude());
        u.setLastLocationAt(now);
        userRepository.save(u);
        return new LocationUpdateResponse(true, req.latitude(), req.longitude(), now.toString());
    }

    private EmployeeDto toEmployeeDtoWithCounts(User e) {
        long open = taskRepository.countByAssignedToIdAndStatusIn(
                e.getId(), List.of(CollectionTask.TaskStatus.ASSIGNED, CollectionTask.TaskStatus.ACCEPTED));
        long completed = taskRepository.countByAssignedToIdAndStatus(
                e.getId(), CollectionTask.TaskStatus.COMPLETED);
        return toEmployeeDto(e, open, completed);
    }

    private EmployeeDto toEmployeeDto(User e, long openTasks, long completedTasks) {
        return new EmployeeDto(
                e.getId(),
                e.getName(),
                e.getEmail(),
                e.getMobile(),
                e.getStatus().name(),
                openTasks,
                completedTasks,
                e.getLastLat(),
                e.getLastLng(),
                e.getLastLocationAt() != null ? e.getLastLocationAt().toString() : null,
                e.getCreatedAt().toString()
        );
    }
}
