package com.verdantroute.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "areas")
public class Area {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 120)
    private String city;

    @Column(name = "centre_lat", nullable = false)
    private Double centreLat;

    @Column(name = "centre_lng", nullable = false)
    private Double centreLng;

    @Column(name = "default_interval_seconds", nullable = false)
    private Integer defaultIntervalSeconds = 900;

    @Column(name = "medium_threshold", nullable = false)
    private Integer mediumThreshold = 50;

    @Column(name = "full_threshold", nullable = false)
    private Integer fullThreshold = 80;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }
    public Double getCentreLat() { return centreLat; }
    public void setCentreLat(Double centreLat) { this.centreLat = centreLat; }
    public Double getCentreLng() { return centreLng; }
    public void setCentreLng(Double centreLng) { this.centreLng = centreLng; }
    public Integer getDefaultIntervalSeconds() { return defaultIntervalSeconds; }
    public void setDefaultIntervalSeconds(Integer defaultIntervalSeconds) { this.defaultIntervalSeconds = defaultIntervalSeconds; }
    public Integer getMediumThreshold() { return mediumThreshold; }
    public void setMediumThreshold(Integer mediumThreshold) { this.mediumThreshold = mediumThreshold; }
    public Integer getFullThreshold() { return fullThreshold; }
    public void setFullThreshold(Integer fullThreshold) { this.fullThreshold = fullThreshold; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
