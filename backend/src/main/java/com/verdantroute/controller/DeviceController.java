package com.verdantroute.controller;

import com.verdantroute.dto.SensorAndDeviceDtos.*;
import com.verdantroute.exception.ApiException;
import com.verdantroute.service.SensorService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

@RestController
@RequestMapping("/api/device")
public class DeviceController {
    private final SensorService sensorService;
    private final Clock clock;

    public DeviceController(SensorService sensorService, Clock clock) {
        this.sensorService = sensorService;
        this.clock = clock;
    }

    @PostMapping("/reading")
    public ResponseEntity<DeviceReadingResponse> submitReading(
            @RequestHeader(value = "X-Device-Key", required = false) String headerKey,
            @Valid @RequestBody DeviceReadingRequest body) {
        String binId = body.binId().trim();
        String deviceKey = headerKey != null && !headerKey.isBlank()
                ? headerKey.trim()
                : (body.deviceKey() != null ? body.deviceKey().trim() : "");

        if (binId.isBlank() || deviceKey.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "binId, deviceKey, and numeric distanceCm are required.");
        }
        double distanceCm = body.distanceCm();
        if (Double.isNaN(distanceCm) || Double.isInfinite(distanceCm)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "distanceCm must be a valid finite number.");
        }

        Instant now = clock.instant();
        Instant ts = now;
        Object tsObj = body.timestamp();
        if (tsObj != null && !String.valueOf(tsObj).isBlank()) {
            try {
                Instant parsed = tsObj instanceof Number n
                        ? Instant.ofEpochMilli(n.longValue())
                        : Instant.parse(String.valueOf(tsObj));
                if (!parsed.isAfter(now.plus(5, ChronoUnit.MINUTES))) {
                    ts = parsed;
                }
            } catch (Exception ignored) {
                ts = now;
            }
        }

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(sensorService.ingestDeviceReading(binId, deviceKey, distanceCm, ts));
    }
}
