package com.verdantroute.service;

import com.verdantroute.dto.AreaAndBackupDtos.*;
import com.verdantroute.dto.AuthDtos.AreaDto;
import com.verdantroute.dto.SensorAndDeviceDtos.SensorDto;
import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.util.FillMathUtil;
import com.verdantroute.util.ValidationUtil;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.List;

@Service
public class AreaService {
    private final AreaRepository areaRepository;
    private final SensorRepository sensorRepository;
    private final SensorService sensorService;
    private final AuthService authService;
    private final RealtimeWebSocketHandler wsHandler;
    private final Clock clock;

    public AreaService(
            AreaRepository areaRepository,
            SensorRepository sensorRepository,
            SensorService sensorService,
            AuthService authService,
            RealtimeWebSocketHandler wsHandler,
            Clock clock) {
        this.areaRepository = areaRepository;
        this.sensorRepository = sensorRepository;
        this.sensorService = sensorService;
        this.authService = authService;
        this.wsHandler = wsHandler;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AreaDto getArea(Long areaId) {
        Area a = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));
        return authService.toAreaDto(a);
    }

    @Transactional
    public AreaDto updateArea(Long areaId, UpdateAreaRequest req) {
        Area a = areaRepository.findById(areaId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Area not found"));

        int oldFull = a.getFullThreshold();
        if (req.name() != null) {
            String nextName = req.name().trim();
            if (nextName.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "Area name cannot be blank.");
            a.setName(nextName);
        }
        if (req.city() != null) {
            String nextCity = req.city().trim();
            if (nextCity.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "City cannot be blank.");
            a.setCity(nextCity);
        }
        if (req.centreLat() != null) {
            double lat = req.centreLat();
            ValidationUtil.validateCoordinates(lat, a.getCentreLng());
            a.setCentreLat(lat);
        }
        if (req.centreLng() != null) {
            double lng = req.centreLng();
            ValidationUtil.validateCoordinates(a.getCentreLat(), lng);
            a.setCentreLng(lng);
        }
        if (req.defaultIntervalSeconds() != null) {
            int val = req.defaultIntervalSeconds();
            if (val < 60 || val > 14400) {
                throw new ApiException(HttpStatus.BAD_REQUEST,
                        "Default reading interval must be between 60 seconds (1 min) and 14400 seconds (4 hours).");
            }
            a.setDefaultIntervalSeconds(val);
        }
        if (req.mediumThreshold() != null) a.setMediumThreshold(req.mediumThreshold());
        if (req.fullThreshold() != null) a.setFullThreshold(req.fullThreshold());

        if (a.getMediumThreshold() < 10 || a.getMediumThreshold() >= a.getFullThreshold() || a.getFullThreshold() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Thresholds must satisfy 10 <= Medium < Full <= 100.");
        }
        areaRepository.save(a);

        Instant now = clock.instant();
        List<Sensor> sensors = sensorRepository.findByAreaIdOrderByCreatedAtDesc(a.getId());
        for (Sensor s : sensors) {
            if (oldFull != a.getFullThreshold() && s.getFullThreshold() == oldFull) {
                s.setFullThreshold(a.getFullThreshold());
            }
            s.setStatus(FillMathUtil.computeStatus(s, a, now));
        }
        sensorRepository.saveAll(sensors);

        AreaDto areaDto = authService.toAreaDto(a);
        List<SensorDto> sensorDtos = sensors.stream().map(sensorService::toSensorDto).toList();
        wsHandler.broadcastToAreaAdmins(a.getId(), "area:updated", new AreaUpdatedEvent(areaDto, sensorDtos));
        return areaDto;
    }
}
