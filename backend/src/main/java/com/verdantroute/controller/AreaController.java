package com.verdantroute.controller;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.SensorService;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/area")
public class AreaController {
    private final AreaRepository areaRepository;
    private final SensorRepository sensorRepository;
    private final SensorService sensorService;
    private final RealtimeWebSocketHandler wsHandler;

    public AreaController(
            AreaRepository areaRepository,
            SensorRepository sensorRepository,
            SensorService sensorService,
            RealtimeWebSocketHandler wsHandler) {
        this.areaRepository = areaRepository;
        this.sensorRepository = sensorRepository;
        this.sensorService = sensorService;
        this.wsHandler = wsHandler;
    }

    @GetMapping
    public Map<String, Object> getArea(@AuthenticationPrincipal AuthPrincipal principal) {
        Area a = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        return Map.of(
                "id", a.getId(),
                "name", a.getName(),
                "city", a.getCity(),
                "centreLat", a.getCentreLat(),
                "centreLng", a.getCentreLng(),
                "defaultIntervalSeconds", a.getDefaultIntervalSeconds(),
                "mediumThreshold", a.getMediumThreshold(),
                "fullThreshold", a.getFullThreshold()
        );
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public Map<String, Object> updateArea(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) {
        Area a = areaRepository.findById(principal.areaId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));

        int oldFull = a.getFullThreshold();
        if (body.get("name") != null) {
            String nextName = String.valueOf(body.get("name")).trim();
            if (nextName.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "Area name cannot be blank.");
            a.setName(nextName);
        }
        if (body.get("city") != null) {
            String nextCity = String.valueOf(body.get("city")).trim();
            if (nextCity.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "City cannot be blank.");
            a.setCity(nextCity);
        }
        if (body.get("centreLat") instanceof Number n) {
            double lat = n.doubleValue();
            if (lat < -90 || lat > 90) throw new ApiException(HttpStatus.BAD_REQUEST, "Latitude out of bounds.");
            a.setCentreLat(lat);
        }
        if (body.get("centreLng") instanceof Number n) {
            double lng = n.doubleValue();
            if (lng < -180 || lng > 180) throw new ApiException(HttpStatus.BAD_REQUEST, "Longitude out of bounds.");
            a.setCentreLng(lng);
        }
        if (body.get("defaultIntervalSeconds") instanceof Number n) {
            int val = n.intValue();
            if (val < 60 || val > 14400) throw new ApiException(HttpStatus.BAD_REQUEST, "Interval must be 60..14400s");
            a.setDefaultIntervalSeconds(val);
        }
        if (body.get("mediumThreshold") instanceof Number n) a.setMediumThreshold(n.intValue());
        if (body.get("fullThreshold") instanceof Number n) a.setFullThreshold(n.intValue());

        if (a.getMediumThreshold() < 10 || a.getMediumThreshold() >= a.getFullThreshold() || a.getFullThreshold() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Thresholds must satisfy 10 <= Medium < Full <= 100.");
        }
        areaRepository.save(a);

        Instant now = Instant.now();
        List<Sensor> sensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(a.getId());
        for (Sensor s : sensors) {
            if (oldFull != a.getFullThreshold() && s.getFullThreshold() == oldFull) {
                s.setFullThreshold(a.getFullThreshold());
            }
            s.setStatus(sensorService.computeStatus(s, a, now));
        }
        sensorRepository.saveAll(sensors);

        Map<String, Object> areaDto = getArea(principal);
        wsHandler.broadcastToAreaAdmins(a.getId(), "area:updated", Map.of(
                "area", areaDto,
                "sensors", sensors.stream().map(sensorService::serializeSensor).toList()
        ));
        return areaDto;
    }
}
