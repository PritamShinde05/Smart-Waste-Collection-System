package com.verdantroute.controller;

import com.verdantroute.dto.DashboardDtos.*;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.DashboardService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/summary")
    public DashboardSummaryResponse summary(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) Long sensorId,
            @RequestParam(required = false) Long employeeId) {
        return dashboardService.getSummary(principal.areaId(), sensorId, employeeId);
    }

    @GetMapping("/fill-trends")
    public FillTrendsResponse fillTrends(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) Long sensorId,
            @RequestParam(defaultValue = "7") int days) {
        return dashboardService.getFillTrends(principal.areaId(), sensorId, days);
    }

    @GetMapping("/collections")
    public CollectionsStatsResponse collections(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "14") int days,
            @RequestParam(required = false) Long employeeId,
            @RequestParam(required = false) Long sensorId) {
        return dashboardService.getCollectionsStats(principal.areaId(), days, employeeId, sensorId);
    }

    @GetMapping("/employee-stats")
    public EmployeeStatsResponse employeeStats(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(required = false) Long employeeId) {
        return dashboardService.getEmployeeStats(principal.areaId(), days, employeeId);
    }
}
