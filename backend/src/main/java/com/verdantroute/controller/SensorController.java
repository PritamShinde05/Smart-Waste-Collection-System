package com.verdantroute.controller;

import com.verdantroute.dto.AuthDtos.SimpleSuccessResponse;
import com.verdantroute.dto.SensorAndDeviceDtos.*;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.SensorService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sensors")
public class SensorController {
    private final SensorService sensorService;

    public SensorController(SensorService sensorService) {
        this.sensorService = sensorService;
    }

    @GetMapping
    public SensorListResponse list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status) {
        return sensorService.listSensors(principal.areaId(), search, status);
    }

    @PostMapping
    public ResponseEntity<CreateSensorResponse> create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody CreateSensorRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(sensorService.createSensor(principal.areaId(), body));
    }

    @GetMapping("/{id}")
    public SensorDetailResponse detail(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestParam(defaultValue = "day") String range) {
        return sensorService.getSensorDetail(principal.areaId(), id, range);
    }

    @PutMapping("/{id}")
    public SensorSingleResponse update(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @RequestBody UpdateSensorRequest body) {
        return sensorService.updateSensor(principal.areaId(), id, body);
    }

    @PostMapping("/{id}/regenerate-key")
    public RegenerateKeyResponse regenerateKey(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        return new RegenerateKeyResponse(sensorService.regenerateKey(principal.areaId(), id));
    }

    @PostMapping("/{id}/simulate-reading")
    public ResponseEntity<DeviceReadingResponse> simulateReading(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id,
            @Valid @RequestBody SimulateReadingRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(sensorService.simulateReading(principal.areaId(), id, body));
    }

    @DeleteMapping("/{id}")
    public SimpleSuccessResponse delete(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        sensorService.deleteSensor(principal.areaId(), id);
        return new SimpleSuccessResponse(true);
    }
}
