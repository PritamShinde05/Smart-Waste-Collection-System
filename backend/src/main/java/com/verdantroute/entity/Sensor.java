package com.verdantroute.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "sensors", uniqueConstraints = @UniqueConstraint(columnNames = {"area_id", "bin_id"}))
public class Sensor {
    public enum SensorStatus { NORMAL, MEDIUM, FULL, OFFLINE }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "area_id", nullable = false)
    private Area area;

    @Column(name = "bin_id", nullable = false, length = 64)
    private String binId;

    @Column(nullable = false, length = 180)
    private String label;

    @Column(nullable = false)
    private Double latitude;

    @Column(nullable = false)
    private Double longitude;

    @Column(name = "bin_height_cm", nullable = false)
    private Double binHeightCm;

    @Column(name = "interval_seconds", nullable = false)
    private Integer intervalSeconds = 900;

    @Column(name = "full_threshold", nullable = false)
    private Integer fullThreshold = 80;

    @Column(name = "device_key_hash", nullable = false)
    private String deviceKeyHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SensorStatus status = SensorStatus.OFFLINE;

    @Column(name = "is_active", nullable = false)
    private Boolean isActive = true;

    @Column(name = "last_fill_percent")
    private Double lastFillPercent;

    @Column(name = "last_distance_cm")
    private Double lastDistanceCm;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Area getArea() { return area; }
    public void setArea(Area area) { this.area = area; }
    public String getBinId() { return binId; }
    public void setBinId(String binId) { this.binId = binId; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }
    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }
    public Double getBinHeightCm() { return binHeightCm; }
    public void setBinHeightCm(Double binHeightCm) { this.binHeightCm = binHeightCm; }
    public Integer getIntervalSeconds() { return intervalSeconds; }
    public void setIntervalSeconds(Integer intervalSeconds) { this.intervalSeconds = intervalSeconds; }
    public Integer getFullThreshold() { return fullThreshold; }
    public void setFullThreshold(Integer fullThreshold) { this.fullThreshold = fullThreshold; }
    public String getDeviceKeyHash() { return deviceKeyHash; }
    public void setDeviceKeyHash(String deviceKeyHash) { this.deviceKeyHash = deviceKeyHash; }
    public SensorStatus getStatus() { return status; }
    public void setStatus(SensorStatus status) { this.status = status; }
    public Boolean getIsActive() { return isActive; }
    public void setIsActive(Boolean active) { isActive = active; }
    public Double getLastFillPercent() { return lastFillPercent; }
    public void setLastFillPercent(Double lastFillPercent) { this.lastFillPercent = lastFillPercent; }
    public Double getLastDistanceCm() { return lastDistanceCm; }
    public void setLastDistanceCm(Double lastDistanceCm) { this.lastDistanceCm = lastDistanceCm; }
    public Instant getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(Instant lastSeenAt) { this.lastSeenAt = lastSeenAt; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
