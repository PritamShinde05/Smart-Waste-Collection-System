package com.verdantroute.repository;

import com.verdantroute.entity.CollectionTask;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TaskRepository extends JpaRepository<CollectionTask, Long> {
    List<CollectionTask> findByAreaIdOrderByCreatedAtDesc(Long areaId);
    List<CollectionTask> findByAreaIdAndStatusOrderByCreatedAtDesc(Long areaId, CollectionTask.TaskStatus status);
    List<CollectionTask> findByAreaIdAndAssignedToIdOrderByCreatedAtDesc(Long areaId, Long assignedToId);
    Optional<CollectionTask> findByIdAndAreaId(Long id, Long areaId);
    Optional<CollectionTask> findByIdAndAssignedToIdAndAreaId(Long id, Long assignedToId, Long areaId);
    List<CollectionTask> findByAssignedToIdAndAreaIdOrderByCreatedAtDesc(Long assignedToId, Long areaId);
    long countByAssignedToIdAndStatusIn(Long assignedToId, List<CollectionTask.TaskStatus> statuses);
    long countByAssignedToIdAndStatus(Long assignedToId, CollectionTask.TaskStatus status);
}
