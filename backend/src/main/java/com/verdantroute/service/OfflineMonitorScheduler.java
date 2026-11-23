package com.verdantroute.service;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;

@Component
public class OfflineMonitorScheduler {
    private final SensorRepository sensorRepository;
    private final AreaRepository areaRepository;
    private final SensorService sensorService;
    private final RealtimeWebSocketHandler wsHandler;

    public OfflineMonitorScheduler(
            SensorRepository sensorRepository,
            AreaRepository areaRepository,
            SensorService sensorService,
            RealtimeWebSocketHandler wsHandler) {
        this.sensorRepository = sensorRepository;
        this.areaRepository = areaRepository;
        this.sensorService = sensorService;
        this.wsHandler = wsHandler;
    }

    @Scheduled(fixedDelay = 20000)
    @Transactional
    public void detectOfflineSensors() {
        Instant now = Instant.now();
        List<Sensor> onlineSensors = sensorRepository.findByIsActiveTrueAndStatusNot(Sensor.SensorStatus.OFFLINE);
        for (Sensor s : onlineSensors) {
            Area area = areaRepository.findById(s.getArea().getId()).orElse(null);
            if (area == null) continue;
            Sensor.SensorStatus next = sensorService.computeStatus(s, area, now);
            if (next == Sensor.SensorStatus.OFFLINE) {
                s.setStatus(Sensor.SensorStatus.OFFLINE);
                sensorRepository.save(s);
                wsHandler.broadcastToAreaAdmins(area.getId(), "sensor:updated", sensorService.serializeSensor(s));
            }
        }
    }
}
