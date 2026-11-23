export type SensorStatus = 'NORMAL' | 'MEDIUM' | 'FULL' | 'OFFLINE';

export function calculateFillPercentage(binHeightCm: number, distanceCm: number): number {
  if (binHeightCm <= 0) return 0;
  const raw = ((binHeightCm - distanceCm) / binHeightCm) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 10) / 10;
}

export function computeSensorStatus(
  fillPercent: number | null,
  lastSeenAt: string | null,
  intervalSeconds: number,
  mediumThreshold: number,
  fullThreshold: number,
  nowMs: number = Date.now(),
  isActive: boolean = true
): SensorStatus {
  if (!isActive || !lastSeenAt || fillPercent === null || fillPercent === undefined) {
    return 'OFFLINE';
  }
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) {
    return 'OFFLINE';
  }
  const offlineLimitMs = intervalSeconds * 2 * 1000;
  if (nowMs - seenMs > offlineLimitMs) {
    return 'OFFLINE';
  }
  if (fillPercent >= fullThreshold) {
    return 'FULL';
  }
  if (fillPercent >= mediumThreshold) {
    return 'MEDIUM';
  }
  return 'NORMAL';
}
