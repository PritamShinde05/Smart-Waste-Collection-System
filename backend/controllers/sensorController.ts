import type { Response } from 'express';
import { db, withTransaction } from '../database/db.ts';
import { generateDeviceKey, type AuthedRequest } from '../middleware/auth.ts';
import {
  calculateFillPercentage,
  computeSensorStatus,
  getAreaThresholds,
  refreshSensorStatusRow,
  serializeSensor,
} from '../services/status.ts';
import { broadcastToAreaAdmins } from '../services/ws.ts';

export function listSensors(req: AuthedRequest, res: Response) {
  const { search, status } = req.query;
  const area = getAreaThresholds(req.auth!.areaId);
  let rows = db
    .prepare('SELECT * FROM sensors WHERE area_id = ? ORDER BY created_at DESC, id DESC')
    .all(req.auth!.areaId) as any[];

  rows = rows.map((r) => refreshSensorStatusRow(r, area.medium_threshold));
  let list = rows.map(serializeSensor);

  if (typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((s) => s.binId.toLowerCase().includes(q) || s.label.toLowerCase().includes(q));
  }
  if (typeof status === 'string' && status && status !== 'ALL') {
    if (status === 'ONLINE') {
      list = list.filter((s) => s.isActive && s.status !== 'OFFLINE');
    } else if (status === 'INACTIVE') {
      list = list.filter((s) => !s.isActive);
    } else {
      list = list.filter((s) => s.status === status);
    }
  }

  res.json({ sensors: list });
}

export function createSensor(req: AuthedRequest, res: Response) {
  const { binId, label, latitude, longitude, binHeightCm, intervalSeconds, fullThreshold } = req.body || {};

  if (!binId?.trim() || !label?.trim()) {
    res.status(400).json({ error: 'Bin ID and location label are required.' });
    return;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  const height = Number(binHeightCm);
  const area = getAreaThresholds(req.auth!.areaId);
  const interval = intervalSeconds !== undefined ? Number(intervalSeconds) : area.default_interval_seconds;
  const threshold = fullThreshold !== undefined ? Number(fullThreshold) : area.full_threshold;

  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: 'Valid map coordinates (latitude and longitude) are required.' });
    return;
  }
  if (Number.isNaN(height) || height < 10 || height > 500) {
    res.status(400).json({ error: 'Bin height must be between 10 cm and 500 cm.' });
    return;
  }
  if (Number.isNaN(interval) || interval < 60 || interval > 14400) {
    res.status(400).json({ error: 'Reading interval must be between 1 minute (60s) and 4 hours (14400s).' });
    return;
  }
  if (Number.isNaN(threshold) || threshold <= area.medium_threshold || threshold > 100) {
    res.status(400).json({ error: `Full threshold must be between ${area.medium_threshold + 1}% and 100%.` });
    return;
  }

  const binIdClean = String(binId).trim().toUpperCase();
  const duplicate = db
    .prepare('SELECT id FROM sensors WHERE area_id = ? AND upper(bin_id) = ?')
    .get(req.auth!.areaId, binIdClean);
  if (duplicate) {
    res.status(409).json({ error: `Bin ID "${binIdClean}" already exists in your area.` });
    return;
  }

  const result = withTransaction(() => {
    const ins = db
      .prepare(
        `INSERT INTO sensors (area_id, bin_id, label, latitude, longitude, bin_height_cm, interval_seconds, full_threshold, device_key_hash, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'OFFLINE', 1)`
      )
      .run(req.auth!.areaId, binIdClean, String(label).trim(), lat, lng, height, interval, threshold);

    const sensorId = Number(ins.lastInsertRowid);
    const { rawKey, keyHash } = generateDeviceKey(sensorId);
    db.prepare('UPDATE sensors SET device_key_hash = ? WHERE id = ?').run(keyHash, sensorId);

    const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(sensorId) as any;
    return { row, rawKey };
  });

  const serialized = serializeSensor(result.row);
  broadcastToAreaAdmins(req.auth!.areaId, 'sensor:created', serialized);

  res.status(201).json({
    sensor: serialized,
    deviceKey: result.rawKey,
    readingEndpoint: '/api/device/reading',
  });
}

export function getSensorDetail(req: AuthedRequest, res: Response) {
  const sensorId = Number(req.params.id);
  const area = getAreaThresholds(req.auth!.areaId);
  const sensor = db
    .prepare('SELECT * FROM sensors WHERE id = ? AND area_id = ?')
    .get(sensorId, req.auth!.areaId) as any;

  if (!sensor) {
    res.status(404).json({ error: 'Sensor not found in your area.' });
    return;
  }
  refreshSensorStatusRow(sensor, area.medium_threshold);

  const range = String(req.query.range || 'day');
  let cutoffSql = "datetime('now', '-1 day')";
  if (range === 'week') cutoffSql = "datetime('now', '-7 days')";
  else if (range === 'month') cutoffSql = "datetime('now', '-30 days')";

  const readings = db
    .prepare(
      `SELECT id, distance_cm, fill_percent, recorded_at
       FROM sensor_readings
       WHERE sensor_id = ? AND datetime(recorded_at) >= ${cutoffSql}
       ORDER BY datetime(recorded_at) ASC
       LIMIT 500`
    )
    .all(sensorId) as any[];

  const collections = db
    .prepare(
      `SELECT tb.id AS task_bin_id, tb.task_id, tb.collected_at, tb.fill_at_assignment,
              t.status AS task_status, u.id AS employee_id, u.name AS employee_name
       FROM task_bins tb
       JOIN tasks t ON t.id = tb.task_id
       JOIN users u ON u.id = t.assigned_to
       WHERE tb.sensor_id = ? AND tb.collected_at IS NOT NULL
       ORDER BY datetime(tb.collected_at) DESC
       LIMIT 50`
    )
    .all(sensorId) as any[];

  res.json({
    sensor: serializeSensor(sensor),
    readings: readings.map((r) => ({
      id: r.id,
      distanceCm: r.distance_cm,
      fillPercent: r.fill_percent,
      recordedAt: r.recorded_at,
    })),
    collections: collections.map((c) => ({
      taskBinId: c.task_bin_id,
      taskId: c.task_id,
      collectedAt: c.collected_at,
      fillAtAssignment: c.fill_at_assignment,
      taskStatus: c.task_status,
      employeeId: c.employee_id,
      employeeName: c.employee_name,
    })),
  });
}

export function updateSensor(req: AuthedRequest, res: Response) {
  const sensorId = Number(req.params.id);
  const existing = db
    .prepare('SELECT * FROM sensors WHERE id = ? AND area_id = ?')
    .get(sensorId, req.auth!.areaId) as any;

  if (!existing) {
    res.status(404).json({ error: 'Sensor not found in your area.' });
    return;
  }

  const area = getAreaThresholds(req.auth!.areaId);
  const { binId, label, latitude, longitude, binHeightCm, intervalSeconds, fullThreshold, isActive } = req.body || {};

  const nextBinId = binId !== undefined ? String(binId).trim().toUpperCase() : existing.bin_id;
  const nextLabel = label !== undefined ? String(label).trim() : existing.label;
  const nextLat = latitude !== undefined ? Number(latitude) : existing.latitude;
  const nextLng = longitude !== undefined ? Number(longitude) : existing.longitude;
  const nextHeight = binHeightCm !== undefined ? Number(binHeightCm) : existing.bin_height_cm;
  const nextInterval = intervalSeconds !== undefined ? Number(intervalSeconds) : existing.interval_seconds;
  const nextThreshold = fullThreshold !== undefined ? Number(fullThreshold) : existing.full_threshold;
  const nextActive = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active;

  if (!nextBinId || !nextLabel) {
    res.status(400).json({ error: 'Bin ID and label are required.' });
    return;
  }
  if (Number.isNaN(nextLat) || Number.isNaN(nextLng) || nextLat < -90 || nextLat > 90 || nextLng < -180 || nextLng > 180) {
    res.status(400).json({ error: 'Valid map coordinates (latitude and longitude) are required.' });
    return;
  }
  if (nextHeight < 10 || nextHeight > 500) {
    res.status(400).json({ error: 'Bin height must be between 10 and 500 cm.' });
    return;
  }
  if (nextInterval < 60 || nextInterval > 14400) {
    res.status(400).json({ error: 'Reading interval must be between 60 and 14400 seconds.' });
    return;
  }
  if (nextThreshold <= area.medium_threshold || nextThreshold > 100) {
    res.status(400).json({ error: `Full threshold must be between ${area.medium_threshold + 1} and 100%.` });
    return;
  }

  const dup = db
    .prepare('SELECT id FROM sensors WHERE area_id = ? AND upper(bin_id) = ? AND id != ?')
    .get(req.auth!.areaId, nextBinId, sensorId);
  if (dup) {
    res.status(409).json({ error: `Bin ID "${nextBinId}" is already assigned in this area.` });
    return;
  }

  let nextFill = existing.last_fill_percent;
  if (nextHeight !== existing.bin_height_cm && existing.last_distance_cm !== null) {
    nextFill = calculateFillPercentage(nextHeight, existing.last_distance_cm);
  }
  const nextStatus = computeSensorStatus(
    nextFill,
    existing.last_seen_at,
    nextInterval,
    area.medium_threshold,
    nextThreshold,
    Date.now(),
    Boolean(nextActive)
  );

  db.prepare(
    `UPDATE sensors
     SET bin_id = ?, label = ?, latitude = ?, longitude = ?, bin_height_cm = ?, interval_seconds = ?, full_threshold = ?, is_active = ?, last_fill_percent = ?, status = ?
     WHERE id = ?`
  ).run(nextBinId, nextLabel, nextLat, nextLng, nextHeight, nextInterval, nextThreshold, nextActive, nextFill, nextStatus, sensorId);

  const updated = serializeSensor(db.prepare('SELECT * FROM sensors WHERE id = ?').get(sensorId));
  broadcastToAreaAdmins(req.auth!.areaId, 'sensor:updated', updated);
  res.json({ sensor: updated });
}

export function regenerateSensorKey(req: AuthedRequest, res: Response) {
  const sensorId = Number(req.params.id);
  const existing = db
    .prepare('SELECT id FROM sensors WHERE id = ? AND area_id = ?')
    .get(sensorId, req.auth!.areaId);
  if (!existing) {
    res.status(404).json({ error: 'Sensor not found in your area.' });
    return;
  }

  const { rawKey, keyHash } = generateDeviceKey(sensorId);
  db.prepare('UPDATE sensors SET device_key_hash = ? WHERE id = ?').run(keyHash, sensorId);
  res.json({ deviceKey: rawKey });
}

export function deleteSensor(req: AuthedRequest, res: Response) {
  const sensorId = Number(req.params.id);
  const existing = db
    .prepare('SELECT id FROM sensors WHERE id = ? AND area_id = ?')
    .get(sensorId, req.auth!.areaId);
  if (!existing) {
    res.status(404).json({ error: 'Sensor not found in your area.' });
    return;
  }

  db.prepare('DELETE FROM sensors WHERE id = ?').run(sensorId);
  broadcastToAreaAdmins(req.auth!.areaId, 'sensor:deleted', { id: sensorId });
  res.json({ success: true });
}
