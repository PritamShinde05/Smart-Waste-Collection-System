package com.verdantroute.repository;

import com.verdantroute.entity.Sensor;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SensorRepository extends JpaRepository<Sensor, Long> {
    List<Sensor> findByAreaIdOrderByCreatedAtDesc(Long areaId);
    Optional<Sensor> findByIdAndAreaId(Long id, Long areaId);
    boolean existsByAreaIdAndBinIdIgnoreCase(Long areaId, String binId);
    boolean existsByAreaIdAndBinIdIgnoreCaseAndIdNot(Long areaId, String binId, Long id);
    List<Sensor> findByBinIdIgnoreCase(String binId);
    Optional<Sensor> findByIdAndBinIdIgnoreCase(Long id, String binId);
    List<Sensor> findByIsActiveTrueAndStatusNot(Sensor.SensorStatus status);
}
