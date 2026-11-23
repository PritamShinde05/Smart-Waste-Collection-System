package com.verdantroute.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "task_bins")
public class TaskBin {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id", nullable = false)
    private CollectionTask task;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sensor_id", nullable = false)
    private Sensor sensor;

    @Column(name = "stop_order", nullable = false)
    private Integer stopOrder;

    @Column(name = "fill_at_assignment")
    private Double fillAtAssignment;

    @Column(name = "collected_at")
    private Instant collectedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public CollectionTask getTask() { return task; }
    public void setTask(CollectionTask task) { this.task = task; }
    public Sensor getSensor() { return sensor; }
    public void setSensor(Sensor sensor) { this.sensor = sensor; }
    public Integer getStopOrder() { return stopOrder; }
    public void setStopOrder(Integer stopOrder) { this.stopOrder = stopOrder; }
    public Double getFillAtAssignment() { return fillAtAssignment; }
    public void setFillAtAssignment(Double fillAtAssignment) { this.fillAtAssignment = fillAtAssignment; }
    public Instant getCollectedAt() { return collectedAt; }
    public void setCollectedAt(Instant collectedAt) { this.collectedAt = collectedAt; }
}
