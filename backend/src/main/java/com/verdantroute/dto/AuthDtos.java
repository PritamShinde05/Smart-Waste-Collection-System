package com.verdantroute.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthDtos {
    private AuthDtos() {}

    public record RegisterAdminRequest(
            @NotBlank(message = "Name is required.") @Size(max = 120) String name,
            @NotBlank(message = "Email is required.") @Size(max = 160) String email,
            @NotBlank(message = "Mobile number is required.") @Size(max = 30) String mobile,
            @NotBlank(message = "Password is required.") String password,
            String confirmPassword,
            @NotBlank(message = "Area name is required.") @Size(max = 120) String areaName,
            @NotBlank(message = "City is required.") @Size(max = 120) String city,
            Double centreLat,
            Double centreLng
    ) {}

    public record LoginRequest(
            @NotBlank(message = "Email or mobile identifier is required.") String identifier,
            @NotBlank(message = "Password is required.") String password
    ) {}

    public record ChangePasswordRequest(
            @NotBlank(message = "Current password is required.") String currentPassword,
            @NotBlank(message = "New password is required.") String newPassword,
            String confirmPassword
    ) {}

    public record AreaDto(
            Long id,
            String name,
            String city,
            Double centreLat,
            Double centreLng,
            Integer defaultIntervalSeconds,
            Integer mediumThreshold,
            Integer fullThreshold
    ) {}

    public record UserDto(
            Long id,
            Long areaId,
            String name,
            String email,
            String mobile,
            String role,
            String status,
            AreaDto area
    ) {}

    public record AuthResponse(
            String token,
            UserDto user
    ) {}

    public record SimpleSuccessResponse(
            boolean success
    ) {}

    public record MessageSuccessResponse(
            boolean success,
            String message
    ) {}
}
