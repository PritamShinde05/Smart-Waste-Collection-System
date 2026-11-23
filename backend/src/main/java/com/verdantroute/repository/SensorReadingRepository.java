package com.verdantroute.repository;

import com.verdantroute.entity.SensorReading;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.Instant;
import java.util.List;

public interface SensorReadingRepository extends JpaRepository<SensorReading, Long> {
    List<SensorReading> findBySensorIdAndRecordedAtAfterOrderByRecordedAtAsc(Long sensorId, Instant after);
}
