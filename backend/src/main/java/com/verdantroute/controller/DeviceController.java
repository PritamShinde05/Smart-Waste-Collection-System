package com.verdantroute.controller;

import com.verdantroute.exception.ApiException;
import com.verdantroute.service.SensorService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

@RestController
@RequestMapping("/api/device")
public class DeviceController {
    private final SensorService sensorService;

    public DeviceController(SensorService sensorService) {
        this.sensorService = sensorService;
    }

    @PostMapping("/reading")
    public ResponseEntity<Map<String, Object>> submitReading(
            @RequestHeader(value = "X-Device-Key", required = false) String headerKey,
            @RequestBody Map<String, Object> body) {
        Object binObj = body.get("binId");
        String binId = binObj != null ? String.valueOf(binObj).trim() : "";
        String deviceKey = headerKey != null && !headerKey.isBlank()
                ? headerKey.trim()
                : (body.get("deviceKey") != null ? String.valueOf(body.get("deviceKey")).trim() : "");

        if (binId.isBlank() || deviceKey.isBlank() || !(body.get("distanceCm") instanceof Number distNum)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "binId, deviceKey, and numeric distanceCm are required.");
        }
        double distanceCm = distNum.doubleValue();
        if (Double.isNaN(distanceCm) || Double.isInfinite(distanceCm)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "distanceCm must be a valid finite number.");
        }

        Instant now = Instant.now();
        Instant ts = now;
        Object tsObj = body.get("timestamp");
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
