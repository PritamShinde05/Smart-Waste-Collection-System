package com.verdantroute.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "sensor_readings")
public class SensorReading {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sensor_id", nullable = false)
    private Sensor sensor;

    @Column(name = "distance_cm", nullable = false)
    private Double distanceCm;

    @Column(name = "fill_percent", nullable = false)
    private Double fillPercent;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Sensor getSensor() { return sensor; }
    public void setSensor(Sensor sensor) { this.sensor = sensor; }
    public Double getDistanceCm() { return distanceCm; }
    public void setDistanceCm(Double distanceCm) { this.distanceCm = distanceCm; }
    public Double getFillPercent() { return fillPercent; }
    public void setFillPercent(Double fillPercent) { this.fillPercent = fillPercent; }
    public Instant getRecordedAt() { return recordedAt; }
    public void setRecordedAt(Instant recordedAt) { this.recordedAt = recordedAt; }
}
