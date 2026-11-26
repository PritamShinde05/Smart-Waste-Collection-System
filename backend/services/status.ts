import { db } from '../database/db.ts';

export type SensorStatus = 'NORMAL' | 'MEDIUM' | 'FULL' | 'OFFLINE';

export function calculateFillPercentage(binHeightCm: number, distanceCm: number): number {
  if (binHeightCm <= 0) return 0;
  const raw = ((binHeightCm - distanceCm) / binHeightCm) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

export function computeSensorStatus(
  lastFillPercent: number | null,
  lastSeenAt: string | null,
  intervalSeconds: number,
  mediumThreshold: number,
  fullThreshold: number,
  nowMs: number = Date.now(),
  isActive: boolean = true
): SensorStatus {
  if (!isActive || !lastSeenAt || lastFillPercent === null || lastFillPercent === undefined) {
    return 'OFFLINE';
  }
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) {
    return 'OFFLINE';
  }
  const timeoutMs = Math.max(60, intervalSeconds) * 2 * 1000;
  if (nowMs - seenMs > timeoutMs) {
    return 'OFFLINE';
  }
  if (lastFillPercent >= fullThreshold) {
    return 'FULL';
  }
  if (lastFillPercent >= mediumThreshold) {
    return 'MEDIUM';
  }
  return 'NORMAL';
}

export function getAreaThresholds(areaId: number) {
  return db
    .prepare('SELECT medium_threshold, full_threshold, default_interval_seconds FROM areas WHERE id = ?')
    .get(areaId) as { medium_threshold: number; full_threshold: number; default_interval_seconds: number };
}

export function refreshSensorStatusRow(sensor: any, mediumThreshold: number) {
  const computed = computeSensorStatus(
    sensor.last_fill_percent,
    sensor.last_seen_at,
    sensor.interval_seconds,
    mediumThreshold,
    sensor.full_threshold,
    Date.now(),
    Boolean(sensor.is_active)
  );
  if (computed !== sensor.status) {
    db.prepare('UPDATE sensors SET status = ? WHERE id = ?').run(computed, sensor.id);
    sensor.status = computed;
  }
  return sensor;
}

export function serializeSensor(s: any) {
  return {
    id: s.id,
    areaId: s.area_id,
    binId: s.bin_id,
    label: s.label,
    latitude: s.latitude,
    longitude: s.longitude,
    binHeightCm: s.bin_height_cm,
    intervalSeconds: s.interval_seconds,
    fullThreshold: s.full_threshold,
    status: s.status,
    isActive: Boolean(s.is_active),
    lastFillPercent: s.last_fill_percent,
    lastDistanceCm: s.last_distance_cm,
    lastSeenAt: s.last_seen_at,
    createdAt: s.created_at,
  };
}
