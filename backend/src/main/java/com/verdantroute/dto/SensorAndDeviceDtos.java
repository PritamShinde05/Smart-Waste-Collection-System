package com.verdantroute.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public final class SensorAndDeviceDtos {
    private SensorAndDeviceDtos() {}

    public record CreateSensorRequest(
            @NotBlank(message = "Bin ID is required.") @Size(max = 64) String binId,
            @NotBlank(message = "Location label is required.") @Size(max = 180) String label,
            @NotNull(message = "Latitude is required.") Double latitude,
            @NotNull(message = "Longitude is required.") Double longitude,
            @NotNull(message = "Bin height (cm) is required.") Double binHeightCm,
            Integer intervalSeconds,
            Integer fullThreshold
    ) {}

    public record UpdateSensorRequest(
            String binId,
            String label,
            Double latitude,
            Double longitude,
            Double binHeightCm,
            Integer intervalSeconds,
            Integer fullThreshold,
            Boolean isActive
    ) {}

    public record SimulateReadingRequest(
            @NotNull(message = "Numeric distanceCm is required.") Double distanceCm
    ) {}

    public record DeviceReadingRequest(
            @NotBlank(message = "binId is required.") String binId,
            String deviceKey,
            @NotNull(message = "Numeric distanceCm is required.") Double distanceCm,
            Object timestamp
    ) {}

    public record SensorDto(
            Long id,
            Long areaId,
            String binId,
            String label,
            Double latitude,
            Double longitude,
            Double binHeightCm,
            Integer intervalSeconds,
            Integer fullThreshold,
            String status,
            Boolean isActive,
            Double lastFillPercent,
            Double lastDistanceCm,
            String lastSeenAt,
            String createdAt
    ) {}

    public record SensorReadingDto(
            Long id,
            Double distanceCm,
            Double fillPercent,
            String recordedAt
    ) {}

    public record CollectionRecordDto(
            Long taskBinId,
            Long taskId,
            String collectedAt,
            Double fillAtAssignment,
            String taskStatus,
            Long employeeId,
            String employeeName
    ) {}

    public record SensorListResponse(
            List<SensorDto> sensors
    ) {}

    public record SensorSingleResponse(
            SensorDto sensor
    ) {}

    public record CreateSensorResponse(
            SensorDto sensor,
            String deviceKey,
            String readingEndpoint
    ) {}

    public record SensorDetailResponse(
            SensorDto sensor,
            List<SensorReadingDto> readings,
            List<CollectionRecordDto> collections
    ) {}

    public record RegenerateKeyResponse(
            String deviceKey
    ) {}

    public record DeviceReadingResponse(
            boolean success,
            String binId,
            double fillPercentage,
            String status,
            int readingIntervalSeconds,
            SensorDto sensor
    ) {}

    public record ReadingPointPayload(
            double distanceCm,
            double fillPercent,
            String recordedAt
    ) {}

    public record SensorReadingEventPayload(
            SensorDto sensor,
            ReadingPointPayload reading
    ) {}
}
