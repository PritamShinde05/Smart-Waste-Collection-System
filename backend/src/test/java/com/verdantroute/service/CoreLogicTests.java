package com.verdantroute.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.exception.ApiException;
import com.verdantroute.util.FillMathUtil;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class CoreLogicTests {

    private final RouteOptimizationService routeService =
            new RouteOptimizationService("https://router.project-osrm.org", 50, 12, new ObjectMapper());

    @Test
    void fillPercentageCalculatesAndClampsAccurately() {
        assertEquals(0.0, FillMathUtil.calculateFillPercent(100.0, 100.0));
        assertEquals(50.0, FillMathUtil.calculateFillPercent(100.0, 50.0));
        assertEquals(85.0, FillMathUtil.calculateFillPercent(100.0, 15.0));
        assertEquals(100.0, FillMathUtil.calculateFillPercent(100.0, 0.0));
        assertEquals(100.0, FillMathUtil.calculateFillPercent(100.0, -5.0));
        assertEquals(0.0, FillMathUtil.calculateFillPercent(100.0, 140.0));
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
        assertEquals(Sensor.SensorStatus.NORMAL, FillMathUtil.computeStatus(s, area, now));

        s.setLastFillPercent(55.0);
        assertEquals(Sensor.SensorStatus.MEDIUM, FillMathUtil.computeStatus(s, area, now));

        s.setLastFillPercent(85.0);
        assertEquals(Sensor.SensorStatus.FULL, FillMathUtil.computeStatus(s, area, now));

        // Exceeds 2 * intervalSeconds (1801s > 1800s) -> OFFLINE
        s.setLastSeenAt(now.minusSeconds(1801));
        assertEquals(Sensor.SensorStatus.OFFLINE, FillMathUtil.computeStatus(s, area, now));

        // Inactive sensor is always OFFLINE even with recent reading
        s.setLastSeenAt(now.minusSeconds(10));
        s.setIsActive(false);
        assertEquals(Sensor.SensorStatus.OFFLINE, FillMathUtil.computeStatus(s, area, now));
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

    @Test
    void returnToDepotChangesOptimalOrderWhenReturnLegMatters() {
        double[][] asymmetric = {
                {0,   10, 30, 35},
                {200,  0, 10, 15},
                {1,   30,  0, 12},
                {500, 35, 10,  0}
        };
        List<Integer> openOrder = routeService.solveOptimizedTour(3, asymmetric, false);
        assertEquals(List.of(1, 2, 3), openOrder);
        assertEquals(32.0, routeService.tourDuration(openOrder, asymmetric, false));

        List<Integer> roundTripOrder = routeService.solveOptimizedTour(3, asymmetric, true);
        assertEquals(List.of(1, 3, 2), roundTripOrder);
        assertEquals(36.0, routeService.tourDuration(roundTripOrder, asymmetric, true));
    }

    @Test
    void maxWaypointsGuardRejectsOver50Bins() {
        List<Sensor> tooMany = new ArrayList<>();
        for (int i = 0; i < 51; i++) {
            Sensor s = new Sensor();
            s.setBinId("BIN-" + i);
            s.setLatitude(18.52 + i * 0.001);
            s.setLongitude(73.85 + i * 0.001);
            tooMany.add(s);
        }
        ApiException ex = assertThrows(ApiException.class,
                () -> routeService.optimize(18.52, 73.85, tooMany, false));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
    }
}
