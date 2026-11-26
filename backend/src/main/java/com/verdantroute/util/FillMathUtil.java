package com.verdantroute.util;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.Sensor;
import java.time.Instant;

public final class FillMathUtil {
    private FillMathUtil() {}

    public static double calculateFillPercent(double binHeightCm, double distanceCm) {
        if (binHeightCm <= 0) {
            return 0.0;
        }
        double raw = ((binHeightCm - distanceCm) / binHeightCm) * 100.0;
        double clamped = Math.max(0.0, Math.min(100.0, raw));
        return Math.round(clamped * 10.0) / 10.0;
    }

    public static Sensor.SensorStatus computeStatus(Sensor sensor, Area area, Instant now) {
        if (!Boolean.TRUE.equals(sensor.getIsActive())
                || sensor.getLastSeenAt() == null
                || sensor.getLastFillPercent() == null) {
            return Sensor.SensorStatus.OFFLINE;
        }
        long offlineMillis = sensor.getIntervalSeconds() * 2000L;
        if (now.toEpochMilli() - sensor.getLastSeenAt().toEpochMilli() > offlineMillis) {
            return Sensor.SensorStatus.OFFLINE;
        }
        double fill = sensor.getLastFillPercent();
        if (fill >= sensor.getFullThreshold()) {
            return Sensor.SensorStatus.FULL;
        }
        if (fill >= area.getMediumThreshold()) {
            return Sensor.SensorStatus.MEDIUM;
        }
        return Sensor.SensorStatus.NORMAL;
    }
}
