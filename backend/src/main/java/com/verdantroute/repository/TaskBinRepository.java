package com.verdantroute.repository;

import com.verdantroute.entity.TaskBin;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TaskBinRepository extends JpaRepository<TaskBin, Long> {
    Optional<TaskBin> findByIdAndTaskId(Long id, Long taskId);
    List<TaskBin> findBySensorIdAndCollectedAtIsNotNullOrderByCollectedAtDesc(Long sensorId);
}
