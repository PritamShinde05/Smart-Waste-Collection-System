package com.verdantroute.controller;

import com.verdantroute.dto.AuthDtos.SimpleSuccessResponse;
import com.verdantroute.dto.EmployeeDtos.*;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.EmployeeService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/employees")
public class EmployeeController {
    private final EmployeeService employeeService;

    public EmployeeController(EmployeeService employeeService) {
        this.employeeService = employeeService;
    }

    @GetMapping
    public EmployeeListResponse list(@AuthenticationPrincipal AuthPrincipal principal) {
        return employeeService.listEmployees(principal.areaId());
    }

    @PostMapping
    public ResponseEntity<EmployeeSingleResponse> create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody CreateEmployeeRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(employeeService.createEmployee(principal.areaId(), body));
    }

    @PutMapping("/{id}")
    public EmployeeSingleResponse update(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody UpdateEmployeeRequest body) {
        return employeeService.updateEmployee(principal.areaId(), id, body);
    }

    @PatchMapping("/{id}/status")
    public EmployeeStatusResponse updateStatus(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @Valid @RequestBody UpdateEmployeeStatusRequest body) {
        return employeeService.updateEmployeeStatus(principal.areaId(), id, body);
    }

    @PatchMapping("/{id}/reset-password")
    public SimpleSuccessResponse resetPassword(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @Valid @RequestBody ResetEmployeePasswordRequest body) {
        employeeService.resetPassword(principal.areaId(), id, body);
        return new SimpleSuccessResponse(true);
    }

    @GetMapping("/{id}/history")
    public EmployeeHistoryResponse history(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        return employeeService.getHistory(principal.areaId(), id);
    }
}
