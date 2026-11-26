package com.verdantroute.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public final class EmployeeDtos {
    private EmployeeDtos() {}

    public record CreateEmployeeRequest(
            @NotBlank(message = "Name is required.") @Size(max = 120) String name,
            @NotBlank(message = "Email is required.") @Size(max = 160) String email,
            @NotBlank(message = "Mobile number is required.") @Size(max = 30) String mobile,
            @NotBlank(message = "Password is required.") String password,
            String status
    ) {}

    public record UpdateEmployeeRequest(
            String name,
            String email,
            String mobile,
            String status
    ) {}

    public record UpdateEmployeeStatusRequest(
            @NotBlank(message = "Status must be ACTIVE or INACTIVE.") String status
    ) {}

    public record ResetEmployeePasswordRequest(
            @NotBlank(message = "New password is required.") String newPassword
    ) {}

    public record UpdateLocationRequest(
            @NotNull(message = "Latitude is required.") Double latitude,
            @NotNull(message = "Longitude is required.") Double longitude
    ) {}

    public record EmployeeDto(
            Long id,
            String name,
            String email,
            String mobile,
            String status,
            long openTasks,
            long completedTasks,
            Double lastLat,
            Double lastLng,
            String lastLocationAt,
            String createdAt
    ) {}

    public record EmployeeListResponse(
            List<EmployeeDto> employees
    ) {}

    public record EmployeeSingleResponse(
            EmployeeDto employee
    ) {}

    public record EmployeeStatusResponse(
            boolean success,
            String status
    ) {}

    public record EmployeeHistoryResponse(
            EmployeeDto employee,
            List<TaskAndRouteDtos.TaskSummaryDto> tasks
    ) {}

    public record LocationUpdateResponse(
            boolean success,
            double latitude,
            double longitude,
            String updatedAt
    ) {}
}
