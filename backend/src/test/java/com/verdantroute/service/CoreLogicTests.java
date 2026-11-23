package com.verdantroute.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class CoreLogicTests {

    private final SensorService sensorService = new SensorService(null, null, null, null, null);
    private final RouteOptimizationService routeService = new RouteOptimizationService("https://router.project-osrm.org", new ObjectMapper());

    @Test
    void fillPercentageCalculatesAndClampsAccurately() {
        assertEquals(0.0, sensorService.calculateFillPercent(100.0, 100.0));
        assertEquals(50.0, sensorService.calculateFillPercent(100.0, 50.0));
        assertEquals(85.0, sensorService.calculateFillPercent(100.0, 15.0));
        assertEquals(100.0, sensorService.calculateFillPercent(100.0, 0.0));
    }

    @Test
    void sensorStatusThresholdsAndOfflineRuleWorkCorrectly() {
        Area area = new Area();
        area.setMediumThreshold(50);
        area.setFullThreshold(80);

        Instant now = Instant.parse("2026-11-23T12:00:00Z");

        Sensor s = new Sensor();
        s.setIsActive(true);
        s.setIntervalSeconds(900);
        s.setFullThreshold(80);
        s.setLastSeenAt(now.minusSeconds(300));

        s.setLastFillPercent(25.0);
        assertEquals(Sensor.SensorStatus.NORMAL, sensorService.computeStatus(s, area, now));

        s.setLastFillPercent(55.0);
        assertEquals(Sensor.SensorStatus.MEDIUM, sensorService.computeStatus(s, area, now));

        s.setLastFillPercent(85.0);
        assertEquals(Sensor.SensorStatus.FULL, sensorService.computeStatus(s, area, now));

        // Exceeds 2 * intervalSeconds (1801s > 1800s) -> OFFLINE
        s.setLastSeenAt(now.minusSeconds(1801));
        assertEquals(Sensor.SensorStatus.OFFLINE, sensorService.computeStatus(s, area, now));

        // Inactive sensor is always OFFLINE even with recent reading
        s.setLastSeenAt(now.minusSeconds(10));
        s.setIsActive(false);
        assertEquals(Sensor.SensorStatus.OFFLINE, sensorService.computeStatus(s, area, now));
    }

    @Test
    void twoOptImprovesNonOptimalTour() {
        double[][] durations = {
                {0, 10, 50, 80},
                {10, 0, 40, 20},
                {50, 40, 0, 10},
                {80, 20, 10, 0}
        };
        List<Integer> order = routeService.solveNearestNeighborAndTwoOpt(3, durations);
        assertEquals(List.of(1, 3, 2), order);
    }
}
