import type { Request, Response } from 'express';
import { db, withTransaction } from '../database/db.ts';
import { verifyDeviceKey, type AuthedRequest } from '../middleware/auth.ts';
import {
  calculateFillPercentage,
  computeSensorStatus,
  getAreaThresholds,
  serializeSensor,
} from '../services/status.ts';
import { broadcastToAreaAdmins } from '../services/ws.ts';

function ingestReadingForSensor(sensor: any, distanceCm: number, recordedAtIso: string) {
  if (!Number.isFinite(distanceCm) || distanceCm < 0 || distanceCm > sensor.bin_height_cm) {
    return {
      ok: false as const,
      statusCode: 400,
      error: `Measured distance (${distanceCm} cm) is outside physical bin height range (0 to ${sensor.bin_height_cm} cm). Reading discarded and flagged.`,
      flagged: true,
    };
  }

  const area = getAreaThresholds(sensor.area_id);
  const fillPercent = calculateFillPercentage(sensor.bin_height_cm, distanceCm);
  const newStatus = computeSensorStatus(
    fillPercent,
    recordedAtIso,
    sensor.interval_seconds,
    area.medium_threshold,
    sensor.full_threshold,
    Date.now(),
    Boolean(sensor.is_active)
  );

  const shouldUpdateLatest =
    !sensor.last_seen_at || Date.parse(recordedAtIso) >= Date.parse(sensor.last_seen_at);

  withTransaction(() => {
    db.prepare(
      'INSERT INTO sensor_readings (sensor_id, distance_cm, fill_percent, recorded_at) VALUES (?, ?, ?, ?)'
    ).run(sensor.id, distanceCm, fillPercent, recordedAtIso);

    if (shouldUpdateLatest) {
      db.prepare(
        `UPDATE sensors
         SET last_distance_cm = ?, last_fill_percent = ?, last_seen_at = ?, status = ?
         WHERE id = ?`
      ).run(distanceCm, fillPercent, recordedAtIso, newStatus, sensor.id);
    }
  });

  const updatedSensor = serializeSensor(db.prepare('SELECT * FROM sensors WHERE id = ?').get(sensor.id));
  broadcastToAreaAdmins(sensor.area_id, 'sensor:reading', {
    sensor: updatedSensor,
    reading: {
      distanceCm,
      fillPercent,
      recordedAt: recordedAtIso,
    },
  });

  return {
    ok: true as const,
    sensor: updatedSensor,
    fillPercentage: fillPercent,
    status: updatedSensor.status,
    readingIntervalSeconds: sensor.interval_seconds,
  };
}

export function submitDeviceReading(req: Request, res: Response) {
  const { binId, deviceKey, distanceCm, timestamp } = req.body || {};
  const headerKey = (req.headers['x-device-key'] as string) || deviceKey;

  if (!binId || !headerKey || distanceCm === undefined || distanceCm === null) {
    res.status(400).json({ error: 'binId, deviceKey, and distanceCm are required.' });
    return;
  }

  const binIdClean = String(binId).trim().toUpperCase();
  const keyStr = String(headerKey).trim();
  let matchedSensor: any = null;

  const prefixMatch = /^vr_(\d+)_/.exec(keyStr);
  if (prefixMatch) {
    const candidate = db
      .prepare('SELECT * FROM sensors WHERE id = ? AND upper(bin_id) = ?')
      .get(Number(prefixMatch[1]), binIdClean) as any;
    if (candidate && verifyDeviceKey(keyStr, candidate.device_key_hash)) {
      matchedSensor = candidate;
    }
  } else {
    const candidates = db.prepare('SELECT * FROM sensors WHERE upper(bin_id) = ?').all(binIdClean) as any[];
    for (const c of candidates) {
      if (verifyDeviceKey(keyStr, c.device_key_hash)) {
        matchedSensor = c;
        break;
      }
    }
  }

  if (!matchedSensor) {
    res.status(401).json({ error: 'Invalid Bin ID or device key.' });
    return;
  }
  if (!matchedSensor.is_active) {
    res.status(403).json({ error: 'Sensor is deactivated.' });
    return;
  }

  let recordedAtIso = new Date().toISOString();
  if (timestamp !== undefined && timestamp !== null && timestamp !== '') {
    const parsed = typeof timestamp === 'number' ? new Date(timestamp) : new Date(String(timestamp));
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + 300_000) {
      recordedAtIso = parsed.toISOString();
    }
  }

  const outcome = ingestReadingForSensor(matchedSensor, Number(distanceCm), recordedAtIso);
  if (!outcome.ok) {
    res.status(outcome.statusCode).json({ error: outcome.error, flagged: outcome.flagged });
    return;
  }

  res.status(201).json({
    success: true,
    binId: matchedSensor.bin_id,
    fillPercentage: outcome.fillPercentage,
    status: outcome.status,
    readingIntervalSeconds: outcome.readingIntervalSeconds,
  });
}

export function simulateSensorReading(req: AuthedRequest, res: Response) {
  const sensorId = Number(req.params.id);
  const sensor = db
    .prepare('SELECT * FROM sensors WHERE id = ? AND area_id = ?')
    .get(sensorId, req.auth!.areaId) as any;

  if (!sensor) {
    res.status(404).json({ error: 'Sensor not found in your area.' });
    return;
  }
  if (!sensor.is_active) {
    res.status(400).json({ error: 'Activate sensor before testing readings.' });
    return;
  }

  const { distanceCm } = req.body || {};
  if (distanceCm === undefined || distanceCm === null) {
    res.status(400).json({ error: 'distanceCm is required.' });
    return;
  }

  const outcome = ingestReadingForSensor(sensor, Number(distanceCm), new Date().toISOString());
  if (!outcome.ok) {
    res.status(outcome.statusCode).json({ error: outcome.error, flagged: outcome.flagged });
    return;
  }

  res.status(201).json({
    success: true,
    sensor: outcome.sensor,
    fillPercentage: outcome.fillPercentage,
    status: outcome.status,
    readingIntervalSeconds: outcome.readingIntervalSeconds,
  });
}
