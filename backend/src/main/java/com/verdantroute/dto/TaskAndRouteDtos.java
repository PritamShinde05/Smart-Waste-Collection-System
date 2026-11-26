package com.verdantroute.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public final class TaskAndRouteDtos {
    private TaskAndRouteDtos() {}

    public record RoutePreviewRequest(
            String startType,
            Long employeeId,
            @NotEmpty(message = "Select at least one bin to generate an optimized route.") List<Long> sensorIds,
            Boolean returnToDepot
    ) {}

    public record CreateTaskRequest(
            @NotNull(message = "Employee and at least one bin are required.") Long employeeId,
            @NotEmpty(message = "Employee and at least one bin are required.") List<Long> sensorIds,
            String startType,
            String note,
            Boolean returnToDepot
    ) {}

    public record ReoptimizeTaskRequest(
            List<Long> sensorIds,
            String startType,
            Boolean returnToDepot
    ) {}

    public record CompleteTaskRequest(
            String completionNote
    ) {}

    public record StartPointDto(
            String label,
            double latitude,
            double longitude
    ) {}

    public record OrderedStopPreviewDto(
            Long sensorId,
            String binId,
            String label,
            double latitude,
            double longitude,
            Double fillPercent,
            int stopOrder
    ) {}

    public record RoutePreviewResponse(
            String startType,
            boolean returnToDepot,
            StartPointDto startPoint,
            List<OrderedStopPreviewDto> orderedStops,
            JsonNode routeGeometry,
            double totalDistanceMeters,
            double estimatedTimeSeconds
    ) {}

    public record TaskAssigneeDto(
            Long id,
            String name,
            String mobile,
            String email
    ) {}

    public record TaskCreatorDto(
            Long id,
            String name
    ) {}

    public record TaskStopDto(
            Long taskBinId,
            Long sensorId,
            int stopOrder,
            String binId,
            String label,
            double latitude,
            double longitude,
            Double fillAtAssignment,
            Double currentFillPercent,
            String sensorStatus,
            String collectedAt
    ) {}

    public record TaskSummaryDto(
            Long id,
            String status,
            double totalDistanceMeters,
            double estimatedTimeSeconds,
            String note,
            String completionNote,
            String createdAt,
            String acceptedAt,
            String completedAt,
            String cancelledAt,
            int binCount,
            long collectedCount,
            TaskAssigneeDto assignedTo
    ) {}

    public record TaskDetailDto(
            Long id,
            Long areaId,
            String status,
            String startType,
            boolean returnToDepot,
            double startLat,
            double startLng,
            JsonNode routeGeometry,
            double totalDistanceMeters,
            double estimatedTimeSeconds,
            String note,
            String completionNote,
            String createdAt,
            String acceptedAt,
            String completedAt,
            String cancelledAt,
            TaskCreatorDto createdBy,
            TaskAssigneeDto assignedTo,
            List<TaskStopDto> stops
    ) {}

    public record TaskListResponse(
            List<TaskSummaryDto> tasks
    ) {}

    public record TaskDetailResponse(
            TaskDetailDto task
    ) {}
}
