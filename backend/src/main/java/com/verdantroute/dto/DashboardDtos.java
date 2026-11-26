package com.verdantroute.dto;

import java.util.List;

public final class DashboardDtos {
    private DashboardDtos() {}

    public record DashboardCardsDto(
            long totalBins,
            long fullBins,
            long mediumBins,
            long normalBins,
            long offlineSensors,
            long pendingTasks,
            long inProgressTasks,
            long completedToday,
            long completedTasks,
            long cancelledTasks,
            long employeeCount
    ) {}

    public record ChartSliceDto(
            String name,
            long value,
            String color
    ) {}

    public record BinFillSummaryDto(
            Long id,
            String binId,
            String label,
            double fillPercent,
            boolean hasReading,
            String status
    ) {}

    public record DashboardSummaryResponse(
            DashboardCardsDto cards,
            List<ChartSliceDto> binStatusSplit,
            List<ChartSliceDto> taskStatusSplit,
            List<BinFillSummaryDto> binsByFill
    ) {}

    public record SensorRefDto(
            Long id,
            String binId,
            String label
    ) {}

    public record FillTrendPointDto(
            double fillPercent,
            double distanceCm,
            String recordedAt
    ) {}

    public record FillTrendsResponse(
            SensorRefDto sensor,
            List<FillTrendPointDto> points
    ) {}

    public record DailyCollectionCountDto(
            String day,
            int count
    ) {}

    public record CollectionsStatsResponse(
            List<DailyCollectionCountDto> collections
    ) {}

    public record EmployeeStatDto(
            Long employeeId,
            String name,
            long completedCount,
            long openCount
    ) {}

    public record EmployeeStatsResponse(
            List<EmployeeStatDto> employees
    ) {}
}
