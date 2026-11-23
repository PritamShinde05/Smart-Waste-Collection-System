import { Router, type Request, type Response } from 'express';
import { db, withTransaction } from './db.ts';
import {
  clearSessionCookie,
  generateDeviceKey,
  hashPassword,
  requireAuth,
  requireRole,
  setSessionCookie,
  signToken,
  validatePasswordStrength,
  verifyDeviceKey,
  verifyPassword,
  type AuthedRequest,
} from './auth.ts';
import { calculateFillPercentage, computeSensorStatus } from './status.ts';
import { optimizeRoadRoute } from './routing.ts';
import { broadcastToAreaAdmins, broadcastToUser } from './ws.ts';

export const apiRouter = Router();

function formatUserResponse(userRow: any, areaRow: any) {
  return {
    id: userRow.id,
    areaId: userRow.area_id,
    name: userRow.name,
    email: userRow.email,
    mobile: userRow.mobile,
    role: userRow.role,
    status: userRow.status,
    area: areaRow
      ? {
          id: areaRow.id,
          name: areaRow.name,
          city: areaRow.city,
          centreLat: areaRow.centre_lat,
          centreLng: areaRow.centre_lng,
          defaultIntervalSeconds: areaRow.default_interval_seconds,
          mediumThreshold: areaRow.medium_threshold,
          fullThreshold: areaRow.full_threshold,
        }
      : null,
  };
}

function getAreaThresholds(areaId: number) {
  return db
    .prepare('SELECT medium_threshold, full_threshold, default_interval_seconds FROM areas WHERE id = ?')
    .get(areaId) as { medium_threshold: number; full_threshold: number; default_interval_seconds: number };
}

function refreshSensorStatusRow(sensor: any, mediumThreshold: number) {
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

function serializeSensor(s: any) {
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

function getFullTaskDetail(taskId: number, areaId: number) {
  const task = db
    .prepare(
      `SELECT t.*,
              emp.name AS employee_name, emp.mobile AS employee_mobile, emp.email AS employee_email,
              adm.name AS created_by_name
       FROM tasks t
       JOIN users emp ON emp.id = t.assigned_to
       JOIN users adm ON adm.id = t.created_by
       WHERE t.id = ? AND t.area_id = ?`
    )
    .get(taskId, areaId) as any;

  if (!task) return null;

  const stops = db
    .prepare(
      `SELECT tb.id AS task_bin_id, tb.sensor_id, tb.stop_order, tb.fill_at_assignment, tb.collected_at,
              s.bin_id, s.label, s.latitude, s.longitude, s.last_fill_percent, s.status AS sensor_status
       FROM task_bins tb
       JOIN sensors s ON s.id = tb.sensor_id
       WHERE tb.task_id = ?
       ORDER BY tb.stop_order ASC`
    )
    .all(taskId) as any[];

  let parsedGeometry: any = null;
  try {
    parsedGeometry = JSON.parse(task.route_geometry);
  } catch {
    parsedGeometry = null;
  }

  return {
    id: task.id,
    areaId: task.area_id,
    status: task.status,
    startType: task.start_type,
    startLat: task.start_lat,
    startLng: task.start_lng,
    routeGeometry: parsedGeometry,
    totalDistanceMeters: task.total_distance_meters,
    estimatedTimeSeconds: task.estimated_time_seconds,
    note: task.note,
    completionNote: task.completion_note,
    createdAt: task.created_at,
    acceptedAt: task.accepted_at,
    completedAt: task.completed_at,
    cancelledAt: task.cancelled_at,
    createdBy: { id: task.created_by, name: task.created_by_name },
    assignedTo: {
      id: task.assigned_to,
      name: task.employee_name,
      mobile: task.employee_mobile,
      email: task.employee_email,
    },
    stops: stops.map((st) => ({
      taskBinId: st.task_bin_id,
      sensorId: st.sensor_id,
      stopOrder: st.stop_order,
      binId: st.bin_id,
      label: st.label,
      latitude: st.latitude,
      longitude: st.longitude,
      fillAtAssignment: st.fill_at_assignment,
      currentFillPercent: st.last_fill_percent,
      sensorStatus: st.sensor_status,
      collectedAt: st.collected_at,
    })),
  };
}

// ==================== HEALTH ====================
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== AUTH ====================
apiRouter.post('/auth/register-admin', (req: Request, res: Response) => {
  const { name, email, mobile, password, confirmPassword, areaName, city, centreLat, centreLng } = req.body || {};

  if (!name?.trim() || !email?.trim() || !mobile?.trim() || !password || !areaName?.trim() || !city?.trim()) {
    res.status(400).json({ error: 'All required fields must be filled in.' });
    return;
  }

  const emailNorm = String(email).trim().toLowerCase();
  const mobileNorm = String(mobile).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!/^[0-9+\-\s]{7,20}$/.test(mobileNorm)) {
    res.status(400).json({ error: 'Please enter a valid mobile number.' });
    return;
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    res.status(400).json({ error: 'Passwords do not match.' });
    return;
  }
  const pwdError = validatePasswordStrength(password);
  if (pwdError) {
    res.status(400).json({ error: pwdError });
    return;
  }

  const existing = db
    .prepare('SELECT id, email, mobile FROM users WHERE lower(email) = ? OR mobile = ?')
    .get(emailNorm, mobileNorm) as any;
  if (existing) {
    if (existing.email?.toLowerCase() === emailNorm) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    res.status(409).json({ error: 'An account with this mobile number already exists.' });
    return;
  }

  const lat = typeof centreLat === 'number' && !Number.isNaN(centreLat) ? centreLat : 18.5204;
  const lng = typeof centreLng === 'number' && !Number.isNaN(centreLng) ? centreLng : 73.8567;
  const passwordHash = hashPassword(password);

  const created = withTransaction(() => {
    const areaRes = db
      .prepare(
        `INSERT INTO areas (name, city, centre_lat, centre_lng, default_interval_seconds, medium_threshold, full_threshold)
         VALUES (?, ?, ?, ?, 900, 50, 80)`
      )
      .run(String(areaName).trim(), String(city).trim(), lat, lng);
    const areaId = Number(areaRes.lastInsertRowid);

    const userRes = db
      .prepare(
        `INSERT INTO users (area_id, name, email, mobile, password_hash, role, status)
         VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE')`
      )
      .run(areaId, String(name).trim(), emailNorm, mobileNorm, passwordHash);
    const userId = Number(userRes.lastInsertRowid);

    const areaRow = db.prepare('SELECT * FROM areas WHERE id = ?').get(areaId);
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return { areaRow, userRow };
  });

  const token = signToken({
    userId: (created.userRow as any).id,
    areaId: (created.areaRow as any).id,
    role: 'ADMIN',
    email: emailNorm,
  });

  setSessionCookie(req, res, token);
  res.status(201).json({
    token,
    user: formatUserResponse(created.userRow, created.areaRow),
  });
});

apiRouter.post('/auth/login', (req: Request, res: Response) => {
  const { identifier, password } = req.body || {};
  if (!identifier?.trim() || !password) {
    res.status(400).json({ error: 'Please provide your email or mobile number and password.' });
    return;
  }

  const idNorm = String(identifier).trim();
  const user = db
    .prepare('SELECT * FROM users WHERE lower(email) = ? OR mobile = ?')
    .get(idNorm.toLowerCase(), idNorm) as any;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials. Please check your login details.' });
    return;
  }

  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Your account has been deactivated. Please contact your area admin.' });
    return;
  }

  const area = db.prepare('SELECT * FROM areas WHERE id = ?').get(user.area_id);
  const token = signToken({
    userId: user.id,
    areaId: user.area_id,
    role: user.role,
    email: user.email,
  });

  setSessionCookie(req, res, token);
  res.json({
    token,
    user: formatUserResponse(user, area),
  });
});

apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  clearSessionCookie(req, res);
  res.json({ success: true });
});

apiRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.userId) as any;
  const area = db.prepare('SELECT * FROM areas WHERE id = ?').get(req.auth!.areaId) as any;
  const freshToken = signToken({
    userId: user.id,
    areaId: user.area_id,
    role: user.role,
    email: user.email,
  });
  res.json({
    token: freshToken,
    user: formatUserResponse(user, area),
  });
});

apiRouter.post('/auth/change-password', requireAuth, (req: AuthedRequest, res: Response) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current and new passwords are required.' });
    return;
  }
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    res.status(400).json({ error: 'New passwords do not match.' });
    return;
  }
  const pwdError = validatePasswordStrength(newPassword);
  if (pwdError) {
    res.status(400).json({ error: pwdError });
    return;
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.auth!.userId) as any;
  if (!verifyPassword(currentPassword, user.password_hash)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  res.json({ success: true, message: 'Password updated successfully.' });
});

// ==================== AREA SETTINGS (ADMIN) ====================
apiRouter.get('/area', requireAuth, (req: AuthedRequest, res: Response) => {
  const area = db.prepare('SELECT * FROM areas WHERE id = ?').get(req.auth!.areaId) as any;
  if (!area) {
    res.status(404).json({ error: 'Area not found' });
    return;
  }
  res.json({
    id: area.id,
    name: area.name,
    city: area.city,
    centreLat: area.centre_lat,
    centreLng: area.centre_lng,
    defaultIntervalSeconds: area.default_interval_seconds,
    mediumThreshold: area.medium_threshold,
    fullThreshold: area.full_threshold,
    createdAt: area.created_at,
  });
});

apiRouter.put('/area', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const { name, city, centreLat, centreLng, defaultIntervalSeconds, mediumThreshold, fullThreshold } = req.body || {};

  const current = db.prepare('SELECT * FROM areas WHERE id = ?').get(req.auth!.areaId) as any;
  const nextName = name !== undefined ? String(name).trim() : current.name;
  const nextCity = city !== undefined ? String(city).trim() : current.city;
  const nextLat = typeof centreLat === 'number' ? centreLat : current.centre_lat;
  const nextLng = typeof centreLng === 'number' ? centreLng : current.centre_lng;
  const nextInterval =
    defaultIntervalSeconds !== undefined ? Number(defaultIntervalSeconds) : current.default_interval_seconds;
  const nextMed = mediumThreshold !== undefined ? Number(mediumThreshold) : current.medium_threshold;
  const nextFull = fullThreshold !== undefined ? Number(fullThreshold) : current.full_threshold;

  if (!nextName || !nextCity) {
    res.status(400).json({ error: 'Area name and city are required.' });
    return;
  }
  if (Number.isNaN(nextLat) || Number.isNaN(nextLng) || nextLat < -90 || nextLat > 90 || nextLng < -180 || nextLng > 180) {
    res.status(400).json({ error: 'Valid area coordinates are required.' });
    return;
  }
  if (nextInterval < 60 || nextInterval > 14400) {
    res.status(400).json({ error: 'Default reading interval must be between 60 seconds (1 min) and 14400 seconds (4 hours).' });
    return;
  }
  if (nextMed < 10 || nextMed >= nextFull || nextFull > 100) {
    res.status(400).json({ error: 'Thresholds must satisfy 10 <= Medium < Full <= 100.' });
    return;
  }

  withTransaction(() => {
    db.prepare(
      `UPDATE areas
       SET name = ?, city = ?, centre_lat = ?, centre_lng = ?, default_interval_seconds = ?, medium_threshold = ?, full_threshold = ?
       WHERE id = ?`
    ).run(nextName, nextCity, nextLat, nextLng, nextInterval, nextMed, nextFull, req.auth!.areaId);

    // Update sensors using old area full threshold if requested or recalculate statuses immediately
    if (nextFull !== current.full_threshold) {
      db.prepare('UPDATE sensors SET full_threshold = ? WHERE area_id = ? AND full_threshold = ?').run(
        nextFull,
        req.auth!.areaId,
        current.full_threshold
      );
    }

    const areaSensors = db.prepare('SELECT * FROM sensors WHERE area_id = ?').all(req.auth!.areaId) as any[];
    for (const s of areaSensors) {
      const updatedStatus = computeSensorStatus(
        s.last_fill_percent,
        s.last_seen_at,
        s.interval_seconds,
        nextMed,
        s.full_threshold,
        Date.now(),
        Boolean(s.is_active)
      );
      if (updatedStatus !== s.status) {
        db.prepare('UPDATE sensors SET status = ? WHERE id = ?').run(updatedStatus, s.id);
      }
    }
  });

  const updatedArea = db.prepare('SELECT * FROM areas WHERE id = ?').get(req.auth!.areaId) as any;
  const updatedSensors = (db.prepare('SELECT * FROM sensors WHERE area_id = ?').all(req.auth!.areaId) as any[]).map(
    serializeSensor
  );
  broadcastToAreaAdmins(req.auth!.areaId, 'area:updated', {
    area: {
      id: updatedArea.id,
      name: updatedArea.name,
      city: updatedArea.city,
      centreLat: updatedArea.centre_lat,
      centreLng: updatedArea.centre_lng,
      defaultIntervalSeconds: updatedArea.default_interval_seconds,
      mediumThreshold: updatedArea.medium_threshold,
      fullThreshold: updatedArea.full_threshold,
    },
    sensors: updatedSensors,
  });

  res.json({
    id: updatedArea.id,
    name: updatedArea.name,
    city: updatedArea.city,
    centreLat: updatedArea.centre_lat,
    centreLng: updatedArea.centre_lng,
    defaultIntervalSeconds: updatedArea.default_interval_seconds,
    mediumThreshold: updatedArea.medium_threshold,
    fullThreshold: updatedArea.full_threshold,
  });
});

// ==================== SENSORS (ADMIN) ====================
apiRouter.get('/sensors', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const { search, status, includeInactive } = req.query;
  const area = getAreaThresholds(req.auth!.areaId);
  let rows = db
    .prepare('SELECT * FROM sensors WHERE area_id = ? ORDER BY created_at DESC, id DESC')
    .all(req.auth!.areaId) as any[];

  rows = rows.map((r) => refreshSensorStatusRow(r, area.medium_threshold));

  if (includeInactive !== 'true') {
    // By default return all, or allow UI to filter active/inactive clearly
  }

  let list = rows.map(serializeSensor);

  if (typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(
      (s) => s.binId.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
    );
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
});

apiRouter.post('/sensors', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
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
});

apiRouter.get('/sensors/:id', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
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
});

apiRouter.put('/sensors/:id', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
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

  // Recalculate fill if height changed and we have last_distance_cm
  let nextFill = existing.last_fill_percent;
  if (nextHeight !== existing.bin_height_cm && existing.last_distance_cm !== null) {
    nextFill = calculateFillPercentage(nextHeight, existing.last_distance_cm);
  }
  const nextStatus = nextActive
    ? computeSensorStatus(nextFill, existing.last_seen_at, nextInterval, area.medium_threshold, nextThreshold)
    : 'OFFLINE';

  db.prepare(
    `UPDATE sensors
     SET bin_id = ?, label = ?, latitude = ?, longitude = ?, bin_height_cm = ?, interval_seconds = ?, full_threshold = ?, is_active = ?, last_fill_percent = ?, status = ?
     WHERE id = ?`
  ).run(nextBinId, nextLabel, nextLat, nextLng, nextHeight, nextInterval, nextThreshold, nextActive, nextFill, nextStatus, sensorId);

  const updated = serializeSensor(db.prepare('SELECT * FROM sensors WHERE id = ?').get(sensorId));
  broadcastToAreaAdmins(req.auth!.areaId, 'sensor:updated', updated);
  res.json({ sensor: updated });
});

apiRouter.post('/sensors/:id/regenerate-key', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
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
});

apiRouter.delete('/sensors/:id', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
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
});

// Shared ingestion function for both /api/device/reading and admin dev-simulator
function ingestReadingForSensor(sensor: any, distanceCm: number, recordedAtIso: string) {
  if (Number.isNaN(distanceCm) || distanceCm < 0 || distanceCm > sensor.bin_height_cm) {
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
    sensor.full_threshold
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

// ==================== DEVICE READING (ESP32) ====================
apiRouter.post('/device/reading', (req: Request, res: Response) => {
  const { binId, deviceKey, distanceCm, timestamp } = req.body || {};
  const headerKey = (req.headers['x-device-key'] as string) || deviceKey;

  if (!binId || !headerKey || distanceCm === undefined || distanceCm === null) {
    res.status(400).json({ error: 'binId, deviceKey, and distanceCm are required.' });
    return;
  }

  const binIdClean = String(binId).trim().toUpperCase();
  const keyStr = String(headerKey).trim();
  let matchedSensor: any = null;

  // O(1) lookup if key embeds sensor ID prefix (vr_<id>_...)
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
});

// Admin-authenticated hardware test simulator (clearly separated from ESP32 device auth)
apiRouter.post('/sensors/:id/simulate-reading', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
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
});

// ==================== DASHBOARD (ADMIN) ====================
apiRouter.get('/dashboard/summary', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const area = getAreaThresholds(req.auth!.areaId);
  let sensors = db.prepare('SELECT * FROM sensors WHERE area_id = ?').all(req.auth!.areaId) as any[];
  sensors = sensors.map((s) => refreshSensorStatusRow(s, area.medium_threshold));

  const employeeIdFilter = req.query.employeeId ? Number(req.query.employeeId) : null;
  const sensorIdFilter = req.query.sensorId ? Number(req.query.sensorId) : null;

  const filteredSensors = sensorIdFilter ? sensors.filter((s) => s.id === sensorIdFilter) : sensors;

  let fullBins = 0;
  let mediumBins = 0;
  let normalBins = 0;
  let offlineSensors = 0;

  for (const s of filteredSensors) {
    if (!s.is_active || s.status === 'OFFLINE') offlineSensors++;
    else if (s.status === 'FULL') fullBins++;
    else if (s.status === 'MEDIUM') mediumBins++;
    else normalBins++;
  }

  let taskWhere = 'WHERE area_id = ?';
  const taskParams: any[] = [req.auth!.areaId];
  if (employeeIdFilter) {
    taskWhere += ' AND assigned_to = ?';
    taskParams.push(employeeIdFilter);
  }
  if (sensorIdFilter) {
    taskWhere += ' AND id IN (SELECT task_id FROM task_bins WHERE sensor_id = ?)';
    taskParams.push(sensorIdFilter);
  }

  const taskRows = db.prepare(`SELECT status, completed_at FROM tasks ${taskWhere}`).all(...taskParams) as any[];
  const todayStr = new Date().toISOString().slice(0, 10);

  let pendingTasks = 0;
  let inProgressTasks = 0;
  let completedTasks = 0;
  let completedToday = 0;
  let cancelledTasks = 0;

  for (const t of taskRows) {
    if (t.status === 'ASSIGNED') pendingTasks++;
    else if (t.status === 'ACCEPTED') inProgressTasks++;
    else if (t.status === 'COMPLETED') {
      completedTasks++;
      if (t.completed_at && String(t.completed_at).slice(0, 10) === todayStr) {
        completedToday++;
      }
    } else if (t.status === 'CANCELLED') {
      cancelledTasks++;
    }
  }

  const binsByFill = [...filteredSensors]
    .sort((a, b) => (b.last_fill_percent ?? -1) - (a.last_fill_percent ?? -1))
    .map((s) => ({
      id: s.id,
      binId: s.bin_id,
      label: s.label,
      fillPercent: s.last_fill_percent ?? 0,
      hasReading: s.last_fill_percent !== null,
      status: s.status,
    }));

  const employeeCount = (
    db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE area_id = ? AND role = 'EMPLOYEE'").get(req.auth!.areaId) as any
  ).cnt;

  res.json({
    cards: {
      totalBins: filteredSensors.length,
      fullBins,
      mediumBins,
      normalBins,
      offlineSensors,
      pendingTasks,
      inProgressTasks,
      completedToday,
      completedTasks,
      cancelledTasks,
      employeeCount,
    },
    binStatusSplit: [
      { name: 'Normal', value: normalBins, color: '#16A34A' },
      { name: 'Medium', value: mediumBins, color: '#D97706' },
      { name: 'Full', value: fullBins, color: '#DC2626' },
      { name: 'Offline', value: offlineSensors, color: '#64748B' },
    ],
    taskStatusSplit: [
      { name: 'Pending', value: pendingTasks, color: '#D97706' },
      { name: 'Accepted', value: inProgressTasks, color: '#0284C7' },
      { name: 'Completed', value: completedTasks, color: '#16A34A' },
    ],
    binsByFill,
  });
});

apiRouter.get('/dashboard/fill-trends', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const sensorId = req.query.sensorId ? Number(req.query.sensorId) : null;
  const days = Math.min(90, Math.max(1, Number(req.query.days || 7)));

  let targetSensor: any = null;
  if (sensorId) {
    targetSensor = db
      .prepare('SELECT id, bin_id, label FROM sensors WHERE id = ? AND area_id = ?')
      .get(sensorId, req.auth!.areaId);
  } else {
    targetSensor = db
      .prepare('SELECT id, bin_id, label FROM sensors WHERE area_id = ? ORDER BY last_fill_percent DESC, id ASC LIMIT 1')
      .get(req.auth!.areaId);
  }

  if (!targetSensor) {
    res.json({ sensor: null, points: [] });
    return;
  }

  const rows = db
    .prepare(
      `SELECT fill_percent, distance_cm, recorded_at
       FROM sensor_readings
       WHERE sensor_id = ? AND datetime(recorded_at) >= datetime('now', ?)
       ORDER BY datetime(recorded_at) ASC
       LIMIT 300`
    )
    .all(targetSensor.id, `-${days} days`) as any[];

  res.json({
    sensor: { id: targetSensor.id, binId: targetSensor.bin_id, label: targetSensor.label },
    points: rows.map((r) => ({
      fillPercent: r.fill_percent,
      distanceCm: r.distance_cm,
      recordedAt: r.recorded_at,
    })),
  });
});

apiRouter.get('/dashboard/collections', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days || 14)));
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const sensorId = req.query.sensorId ? Number(req.query.sensorId) : null;

  let sql = `
    SELECT date(tb.collected_at) AS day, COUNT(*) AS count
    FROM task_bins tb
    JOIN tasks t ON t.id = tb.task_id
    WHERE t.area_id = ? AND tb.collected_at IS NOT NULL AND datetime(tb.collected_at) >= datetime('now', ?)
  `;
  const params: any[] = [req.auth!.areaId, `-${days} days`];
  if (employeeId) {
    sql += ' AND t.assigned_to = ?';
    params.push(employeeId);
  }
  if (sensorId) {
    sql += ' AND tb.sensor_id = ?';
    params.push(sensorId);
  }
  sql += ' GROUP BY date(tb.collected_at) ORDER BY day ASC';

  const rows = db.prepare(sql).all(...params) as Array<{ day: string; count: number }>;
  res.json({ collections: rows });
});

apiRouter.get('/dashboard/employee-stats', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

  let sql = `
    SELECT u.id AS employee_id, u.name,
           SUM(CASE WHEN t.status = 'COMPLETED' AND datetime(t.completed_at) >= datetime('now', ?) THEN 1 ELSE 0 END) AS completed_count,
           SUM(CASE WHEN t.status IN ('ASSIGNED', 'ACCEPTED') THEN 1 ELSE 0 END) AS open_count
    FROM users u
    LEFT JOIN tasks t ON t.assigned_to = u.id
    WHERE u.area_id = ? AND u.role = 'EMPLOYEE'
  `;
  const params: any[] = [`-${days} days`, req.auth!.areaId];
  if (employeeId) {
    sql += ' AND u.id = ?';
    params.push(employeeId);
  }
  sql += ' GROUP BY u.id, u.name ORDER BY completed_count DESC, u.name ASC';

  const rows = db.prepare(sql).all(...params) as any[];
  res.json({
    employees: rows.map((r) => ({
      employeeId: r.employee_id,
      name: r.name,
      completedCount: r.completed_count || 0,
      openCount: r.open_count || 0,
    })),
  });
});

// ==================== EMPLOYEES (ADMIN) ====================
apiRouter.get('/employees', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.mobile, u.status, u.last_lat, u.last_lng, u.last_location_at, u.created_at,
              SUM(CASE WHEN t.status IN ('ASSIGNED', 'ACCEPTED') THEN 1 ELSE 0 END) AS open_tasks,
              SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_tasks
       FROM users u
       LEFT JOIN tasks t ON t.assigned_to = u.id
       WHERE u.area_id = ? AND u.role = 'EMPLOYEE'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    )
    .all(req.auth!.areaId) as any[];

  res.json({
    employees: rows.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      mobile: e.mobile,
      status: e.status,
      openTasks: e.open_tasks || 0,
      completedTasks: e.completed_tasks || 0,
      lastLat: e.last_lat,
      lastLng: e.last_lng,
      lastLocationAt: e.last_location_at,
      createdAt: e.created_at,
    })),
  });
});

apiRouter.post('/employees', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const { name, email, mobile, password, status } = req.body || {};
  if (!name?.trim() || !email?.trim() || !mobile?.trim() || !password) {
    res.status(400).json({ error: 'Name, email, mobile, and password are required.' });
    return;
  }

  const emailNorm = String(email).trim().toLowerCase();
  const mobileNorm = String(mobile).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!/^[0-9+\-\s]{7,20}$/.test(mobileNorm)) {
    res.status(400).json({ error: 'Please enter a valid mobile number.' });
    return;
  }
  const pwdError = validatePasswordStrength(password);
  if (pwdError) {
    res.status(400).json({ error: pwdError });
    return;
  }

  const dup = db
    .prepare('SELECT id, email, mobile FROM users WHERE lower(email) = ? OR mobile = ?')
    .get(emailNorm, mobileNorm) as any;
  if (dup) {
    res.status(409).json({
      error: dup.email?.toLowerCase() === emailNorm ? 'Email already registered.' : 'Mobile number already registered.',
    });
    return;
  }

  const empStatus = status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const ins = db
    .prepare(
      `INSERT INTO users (area_id, name, email, mobile, password_hash, role, status)
       VALUES (?, ?, ?, ?, ?, 'EMPLOYEE', ?)`
    )
    .run(req.auth!.areaId, String(name).trim(), emailNorm, mobileNorm, hashPassword(password), empStatus);

  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ins.lastInsertRowid)) as any;
  const payload = {
    id: created.id,
    name: created.name,
    email: created.email,
    mobile: created.mobile,
    status: created.status,
    openTasks: 0,
    completedTasks: 0,
    lastLat: null,
    lastLng: null,
    lastLocationAt: null,
    createdAt: created.created_at,
  };
  broadcastToAreaAdmins(req.auth!.areaId, 'employee:updated', payload);
  res.status(201).json({ employee: payload });
});

apiRouter.put('/employees/:id', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const empId = Number(req.params.id);
  const existing = db
    .prepare("SELECT * FROM users WHERE id = ? AND area_id = ? AND role = 'EMPLOYEE'")
    .get(empId, req.auth!.areaId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Employee not found in your area.' });
    return;
  }

  const { name, email, mobile, status } = req.body || {};
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  const nextEmail = email !== undefined ? String(email).trim().toLowerCase() : existing.email;
  const nextMobile = mobile !== undefined ? String(mobile).trim() : existing.mobile;
  const nextStatus = status === 'INACTIVE' || status === 'ACTIVE' ? status : existing.status;

  if (!nextName || !nextEmail || !nextMobile) {
    res.status(400).json({ error: 'Name, email, and mobile are required.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!/^[0-9+\-\s]{7,20}$/.test(nextMobile)) {
    res.status(400).json({ error: 'Please enter a valid mobile number.' });
    return;
  }

  const dup = db
    .prepare('SELECT id FROM users WHERE (lower(email) = ? OR mobile = ?) AND id != ?')
    .get(nextEmail, nextMobile, empId);
  if (dup) {
    res.status(409).json({ error: 'Email or mobile number already in use by another account.' });
    return;
  }

  db.prepare('UPDATE users SET name = ?, email = ?, mobile = ?, status = ? WHERE id = ?').run(
    nextName,
    nextEmail,
    nextMobile,
    nextStatus,
    empId
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(empId) as any;
  broadcastToAreaAdmins(req.auth!.areaId, 'employee:updated', { id: updated.id, name: updated.name, status: updated.status });
  res.json({
    employee: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      mobile: updated.mobile,
      status: updated.status,
    },
  });
});

apiRouter.patch('/employees/:id/status', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const empId = Number(req.params.id);
  const { status } = req.body || {};
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE.' });
    return;
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE id = ? AND area_id = ? AND role = 'EMPLOYEE'")
    .get(empId, req.auth!.areaId);
  if (!existing) {
    res.status(404).json({ error: 'Employee not found in your area.' });
    return;
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, empId);
  broadcastToAreaAdmins(req.auth!.areaId, 'employee:updated', { id: empId, status });
  res.json({ success: true, status });
});

apiRouter.patch('/employees/:id/reset-password', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const empId = Number(req.params.id);
  const { newPassword } = req.body || {};
  const pwdError = validatePasswordStrength(newPassword);
  if (pwdError) {
    res.status(400).json({ error: pwdError });
    return;
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE id = ? AND area_id = ? AND role = 'EMPLOYEE'")
    .get(empId, req.auth!.areaId);
  if (!existing) {
    res.status(404).json({ error: 'Employee not found in your area.' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), empId);
  res.json({ success: true });
});

apiRouter.get('/employees/:id/history', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const empId = Number(req.params.id);
  const emp = db
    .prepare("SELECT id, name, email, mobile, status, created_at FROM users WHERE id = ? AND area_id = ? AND role = 'EMPLOYEE'")
    .get(empId, req.auth!.areaId) as any;
  if (!emp) {
    res.status(404).json({ error: 'Employee not found in your area.' });
    return;
  }

  const tasks = db
    .prepare(
      `SELECT t.id, t.status, t.total_distance_meters, t.estimated_time_seconds, t.created_at, t.accepted_at, t.completed_at,
              (SELECT COUNT(*) FROM task_bins tb WHERE tb.task_id = t.id) AS bin_count
       FROM tasks t
       WHERE t.assigned_to = ? AND t.area_id = ?
       ORDER BY t.created_at DESC
       LIMIT 50`
    )
    .all(empId, req.auth!.areaId) as any[];

  res.json({
    employee: emp,
    tasks: tasks.map((t) => ({
      id: t.id,
      status: t.status,
      totalDistanceMeters: t.total_distance_meters,
      estimatedTimeSeconds: t.estimated_time_seconds,
      binCount: t.bin_count,
      createdAt: t.created_at,
      acceptedAt: t.accepted_at,
      completedAt: t.completed_at,
    })),
  });
});

// ==================== ROUTES & TASKS (ADMIN) ====================
function resolveStartAndBins(areaId: number, startType: string, employeeId: number | undefined, sensorIds: number[]) {
  const area = db.prepare('SELECT * FROM areas WHERE id = ?').get(areaId) as any;
  let startLat = area.centre_lat;
  let startLng = area.centre_lng;
  let resolvedStartType = 'DEPOT';

  if (startType === 'EMPLOYEE_LAST_LOCATION' && employeeId) {
    const emp = db
      .prepare("SELECT last_lat, last_lng FROM users WHERE id = ? AND area_id = ? AND role = 'EMPLOYEE'")
      .get(employeeId, areaId) as any;
    if (emp && emp.last_lat !== null && emp.last_lng !== null) {
      startLat = emp.last_lat;
      startLng = emp.last_lng;
      resolvedStartType = 'EMPLOYEE_LAST_LOCATION';
    } else {
      throw new Error('Selected employee does not have a recent GPS location yet. Choose Area Depot instead.');
    }
  }

  const uniqueIds = Array.from(new Set(sensorIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  if (uniqueIds.length === 0) {
    throw new Error('Please select at least one bin.');
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const bins = db
    .prepare(`SELECT * FROM sensors WHERE area_id = ? AND id IN (${placeholders})`)
    .all(areaId, ...uniqueIds) as any[];

  if (bins.length !== uniqueIds.length) {
    throw new Error('One or more selected bins were not found in your area.');
  }

  return {
    startType: resolvedStartType,
    startPoint: {
      label: resolvedStartType === 'DEPOT' ? `${area.name} Depot` : 'Employee Last Location',
      latitude: startLat,
      longitude: startLng,
    },
    bins: bins.map((b) => ({
      sensorId: b.id,
      binId: b.bin_id,
      label: b.label,
      latitude: b.latitude,
      longitude: b.longitude,
      fillPercent: b.last_fill_percent,
    })),
  };
}

apiRouter.post('/routes/preview', requireAuth, requireRole('ADMIN'), async (req: AuthedRequest, res: Response) => {
  const { startType, employeeId, sensorIds } = req.body || {};
  if (!Array.isArray(sensorIds) || sensorIds.length === 0) {
    res.status(400).json({ error: 'Select at least one bin to generate an optimized route.' });
    return;
  }

  let resolved;
  try {
    resolved = resolveStartAndBins(req.auth!.areaId, startType || 'DEPOT', employeeId ? Number(employeeId) : undefined, sensorIds);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const optimized = await optimizeRoadRoute(resolved.startPoint, resolved.bins);
    res.json({
      startType: resolved.startType,
      startPoint: resolved.startPoint,
      ...optimized,
    });
  } catch (err: any) {
    res.status(503).json({
      error: err.message || 'Road routing service is temporarily unavailable. Please retry.',
      retryable: true,
    });
  }
});

apiRouter.post('/tasks', requireAuth, requireRole('ADMIN'), async (req: AuthedRequest, res: Response) => {
  const { employeeId, sensorIds, startType, note } = req.body || {};
  const empId = Number(employeeId);

  if (!empId || !Array.isArray(sensorIds) || sensorIds.length === 0) {
    res.status(400).json({ error: 'Employee and at least one bin are required.' });
    return;
  }

  const emp = db
    .prepare("SELECT id, name, status FROM users WHERE id = ? AND area_id = ? AND role = 'EMPLOYEE'")
    .get(empId, req.auth!.areaId) as any;
  if (!emp) {
    res.status(404).json({ error: 'Assigned employee not found in your area.' });
    return;
  }
  if (emp.status !== 'ACTIVE') {
    res.status(400).json({ error: 'Cannot assign tasks to an inactive employee.' });
    return;
  }

  let resolved;
  try {
    resolved = resolveStartAndBins(req.auth!.areaId, startType || 'DEPOT', empId, sensorIds);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  let optimized;
  try {
    optimized = await optimizeRoadRoute(resolved.startPoint, resolved.bins);
  } catch (err: any) {
    res.status(503).json({
      error: err.message || 'Road routing service temporarily unavailable. Please retry.',
      retryable: true,
    });
    return;
  }

  const taskId = withTransaction(() => {
    const ins = db
      .prepare(
        `INSERT INTO tasks (area_id, created_by, assigned_to, status, start_type, start_lat, start_lng, route_geometry, total_distance_meters, estimated_time_seconds, note)
         VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.auth!.areaId,
        req.auth!.userId,
        empId,
        resolved.startType,
        resolved.startPoint.latitude,
        resolved.startPoint.longitude,
        JSON.stringify(optimized.routeGeometry),
        optimized.totalDistanceMeters,
        optimized.estimatedTimeSeconds,
        note ? String(note).trim() : null
      );

    const newTaskId = Number(ins.lastInsertRowid);
    const binStmt = db.prepare(
      'INSERT INTO task_bins (task_id, sensor_id, stop_order, fill_at_assignment) VALUES (?, ?, ?, ?)'
    );
    for (const stop of optimized.orderedStops) {
      binStmt.run(newTaskId, stop.sensorId!, stop.stopOrder, stop.fillPercent ?? 0);
    }

    db.prepare(
      'INSERT INTO notifications (user_id, type, message, related_task_id) VALUES (?, ?, ?, ?)'
    ).run(
      empId,
      'TASK_ASSIGNED',
      `New collection task #${newTaskId} with ${optimized.orderedStops.length} bin(s) assigned to you.`,
      newTaskId
    );

    return newTaskId;
  });

  const detail = getFullTaskDetail(taskId, req.auth!.areaId);
  broadcastToAreaAdmins(req.auth!.areaId, 'task:created', detail);
  broadcastToUser(empId, req.auth!.areaId, 'task:assigned', detail);
  broadcastToUser(empId, req.auth!.areaId, 'notification:new', {
    type: 'TASK_ASSIGNED',
    relatedTaskId: taskId,
    message: `New collection task #${taskId} with ${optimized.orderedStops.length} bin(s) assigned to you.`,
  });

  res.status(201).json({ task: detail });
});

apiRouter.get('/tasks', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const { status, employeeId } = req.query;
  let sql = `
    SELECT t.id, t.status, t.total_distance_meters, t.estimated_time_seconds, t.note,
           t.created_at, t.accepted_at, t.completed_at, t.cancelled_at,
           u.id AS employee_id, u.name AS employee_name, u.mobile AS employee_mobile,
           (SELECT COUNT(*) FROM task_bins tb WHERE tb.task_id = t.id) AS bin_count,
           (SELECT COUNT(*) FROM task_bins tb WHERE tb.task_id = t.id AND tb.collected_at IS NOT NULL) AS collected_count
    FROM tasks t
    JOIN users u ON u.id = t.assigned_to
    WHERE t.area_id = ?
  `;
  const params: any[] = [req.auth!.areaId];
  if (typeof status === 'string' && status && status !== 'ALL') {
    sql += ' AND t.status = ?';
    params.push(status);
  }
  if (employeeId) {
    sql += ' AND t.assigned_to = ?';
    params.push(Number(employeeId));
  }
  sql += ' ORDER BY t.created_at DESC, t.id DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  res.json({
    tasks: rows.map((t) => ({
      id: t.id,
      status: t.status,
      totalDistanceMeters: t.total_distance_meters,
      estimatedTimeSeconds: t.estimated_time_seconds,
      note: t.note,
      createdAt: t.created_at,
      acceptedAt: t.accepted_at,
      completedAt: t.completed_at,
      cancelledAt: t.cancelled_at,
      binCount: t.bin_count,
      collectedCount: t.collected_count,
      assignedTo: {
        id: t.employee_id,
        name: t.employee_name,
        mobile: t.employee_mobile,
      },
    })),
  });
});

apiRouter.get('/tasks/:id', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const detail = getFullTaskDetail(Number(req.params.id), req.auth!.areaId);
  if (!detail) {
    res.status(404).json({ error: 'Task not found in your area.' });
    return;
  }
  res.json({ task: detail });
});

apiRouter.patch('/tasks/:id/cancel', requireAuth, requireRole('ADMIN'), (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.id);
  const task = db
    .prepare('SELECT id, status, assigned_to FROM tasks WHERE id = ? AND area_id = ?')
    .get(taskId, req.auth!.areaId) as any;

  if (!task) {
    res.status(404).json({ error: 'Task not found in your area.' });
    return;
  }
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    res.status(400).json({ error: `Cannot cancel a task that is already ${task.status.toLowerCase()}.` });
    return;
  }

  const now = new Date().toISOString();
  withTransaction(() => {
    db.prepare("UPDATE tasks SET status = 'CANCELLED', cancelled_at = ? WHERE id = ?").run(now, taskId);
    db.prepare('INSERT INTO notifications (user_id, type, message, related_task_id) VALUES (?, ?, ?, ?)').run(
      task.assigned_to,
      'TASK_CANCELLED',
      `Collection task #${taskId} has been cancelled by the admin.`,
      taskId
    );
  });

  const detail = getFullTaskDetail(taskId, req.auth!.areaId);
  broadcastToAreaAdmins(req.auth!.areaId, 'task:updated', detail);
  broadcastToUser(task.assigned_to, req.auth!.areaId, 'task:updated', detail);
  broadcastToUser(task.assigned_to, req.auth!.areaId, 'notification:new', {
    type: 'TASK_CANCELLED',
    relatedTaskId: taskId,
    message: `Collection task #${taskId} has been cancelled by the admin.`,
  });

  res.json({ task: detail });
});

apiRouter.post('/tasks/:id/reoptimize', requireAuth, requireRole('ADMIN'), async (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.id);
  const task = db
    .prepare('SELECT * FROM tasks WHERE id = ? AND area_id = ?')
    .get(taskId, req.auth!.areaId) as any;

  if (!task) {
    res.status(404).json({ error: 'Task not found in your area.' });
    return;
  }
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    res.status(400).json({ error: 'Only active tasks can be re-optimized.' });
    return;
  }

  const existingBins = db
    .prepare('SELECT sensor_id, collected_at, fill_at_assignment FROM task_bins WHERE task_id = ?')
    .all(taskId) as any[];
  const requestedSensorIds: number[] =
    Array.isArray(req.body?.sensorIds) && req.body.sensorIds.length > 0
      ? req.body.sensorIds
      : existingBins.map((b) => b.sensor_id);

  let resolved;
  try {
    resolved = resolveStartAndBins(
      req.auth!.areaId,
      req.body?.startType || task.start_type,
      task.assigned_to,
      requestedSensorIds
    );
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  let optimized;
  try {
    optimized = await optimizeRoadRoute(resolved.startPoint, resolved.bins);
  } catch (err: any) {
    res.status(503).json({
      error: err.message || 'Road routing service unavailable. Please retry.',
      retryable: true,
    });
    return;
  }

  const collectedMap = new Map<number, { collectedAt: string | null; fillAtAssignment: number | null }>();
  for (const b of existingBins) {
    collectedMap.set(b.sensor_id, { collectedAt: b.collected_at, fillAtAssignment: b.fill_at_assignment });
  }

  withTransaction(() => {
    db.prepare(
      `UPDATE tasks
       SET start_type = ?, start_lat = ?, start_lng = ?, route_geometry = ?, total_distance_meters = ?, estimated_time_seconds = ?
       WHERE id = ?`
    ).run(
      resolved.startType,
      resolved.startPoint.latitude,
      resolved.startPoint.longitude,
      JSON.stringify(optimized.routeGeometry),
      optimized.totalDistanceMeters,
      optimized.estimatedTimeSeconds,
      taskId
    );

    db.prepare('DELETE FROM task_bins WHERE task_id = ?').run(taskId);
    const insStop = db.prepare(
      'INSERT INTO task_bins (task_id, sensor_id, stop_order, fill_at_assignment, collected_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const stop of optimized.orderedStops) {
      const prev = collectedMap.get(stop.sensorId!);
      insStop.run(
        taskId,
        stop.sensorId!,
        stop.stopOrder,
        prev?.fillAtAssignment ?? stop.fillPercent ?? 0,
        prev?.collectedAt ?? null
      );
    }

    db.prepare('INSERT INTO notifications (user_id, type, message, related_task_id) VALUES (?, ?, ?, ?)').run(
      task.assigned_to,
      'TASK_ROUTE_UPDATED',
      `Route for task #${taskId} was re-optimized by the admin.`,
      taskId
    );
  });

  const detail = getFullTaskDetail(taskId, req.auth!.areaId);
  broadcastToAreaAdmins(req.auth!.areaId, 'task:updated', detail);
  broadcastToUser(task.assigned_to, req.auth!.areaId, 'task:updated', detail);
  broadcastToUser(task.assigned_to, req.auth!.areaId, 'notification:new', {
    type: 'TASK_ROUTE_UPDATED',
    relatedTaskId: taskId,
    message: `Route for task #${taskId} was re-optimized by the admin.`,
  });
  res.json({ task: detail });
});

// ==================== EMPLOYEE TASKS & GPS ====================
apiRouter.get('/employee/tasks', requireAuth, requireRole('EMPLOYEE'), (req: AuthedRequest, res: Response) => {
  const { status } = req.query;
  let sql = `
    SELECT t.id, t.status, t.total_distance_meters, t.estimated_time_seconds, t.note, t.completion_note,
           t.created_at, t.accepted_at, t.completed_at, t.cancelled_at,
           (SELECT COUNT(*) FROM task_bins tb WHERE tb.task_id = t.id) AS bin_count,
           (SELECT COUNT(*) FROM task_bins tb WHERE tb.task_id = t.id AND tb.collected_at IS NOT NULL) AS collected_count
    FROM tasks t
    WHERE t.assigned_to = ? AND t.area_id = ?
  `;
  const params: any[] = [req.auth!.userId, req.auth!.areaId];
  if (typeof status === 'string' && status && status !== 'ALL') {
    sql += ' AND t.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY t.created_at DESC, t.id DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  res.json({
    tasks: rows.map((t) => ({
      id: t.id,
      status: t.status,
      totalDistanceMeters: t.total_distance_meters,
      estimatedTimeSeconds: t.estimated_time_seconds,
      note: t.note,
      completionNote: t.completion_note,
      createdAt: t.created_at,
      acceptedAt: t.accepted_at,
      completedAt: t.completed_at,
      cancelledAt: t.cancelled_at,
      binCount: t.bin_count,
      collectedCount: t.collected_count,
    })),
  });
});

apiRouter.get('/employee/tasks/:id', requireAuth, requireRole('EMPLOYEE'), (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.id);
  const owned = db
    .prepare('SELECT id FROM tasks WHERE id = ? AND assigned_to = ? AND area_id = ?')
    .get(taskId, req.auth!.userId, req.auth!.areaId);
  if (!owned) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const detail = getFullTaskDetail(taskId, req.auth!.areaId);
  res.json({ task: detail });
});

apiRouter.patch('/employee/tasks/:id/accept', requireAuth, requireRole('EMPLOYEE'), (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.id);
  const task = db
    .prepare('SELECT id, status FROM tasks WHERE id = ? AND assigned_to = ? AND area_id = ?')
    .get(taskId, req.auth!.userId, req.auth!.areaId) as any;

  if (!task) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }
  if (task.status !== 'ASSIGNED') {
    res.status(400).json({ error: 'Only newly assigned tasks can be accepted.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = 'ACCEPTED', accepted_at = ? WHERE id = ?").run(now, taskId);

  const detail = getFullTaskDetail(taskId, req.auth!.areaId);
  broadcastToAreaAdmins(req.auth!.areaId, 'task:updated', detail);
  broadcastToUser(req.auth!.userId, req.auth!.areaId, 'task:updated', detail);
  res.json({ task: detail });
});

apiRouter.patch(
  '/employee/tasks/:id/bins/:taskBinId/collect',
  requireAuth,
  requireRole('EMPLOYEE'),
  (req: AuthedRequest, res: Response) => {
    const taskId = Number(req.params.id);
    const taskBinId = Number(req.params.taskBinId);

    const task = db
      .prepare('SELECT id, status FROM tasks WHERE id = ? AND assigned_to = ? AND area_id = ?')
      .get(taskId, req.auth!.userId, req.auth!.areaId) as any;
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    if (task.status !== 'ACCEPTED') {
      res.status(400).json({ error: 'Accept the task before marking bins collected.' });
      return;
    }

    const tb = db
      .prepare('SELECT id, sensor_id, collected_at FROM task_bins WHERE id = ? AND task_id = ?')
      .get(taskBinId, taskId) as any;
    if (!tb) {
      res.status(404).json({ error: 'Bin stop not found on this task.' });
      return;
    }

    const now = new Date().toISOString();
    withTransaction(() => {
      if (!tb.collected_at) {
        db.prepare('UPDATE task_bins SET collected_at = ? WHERE id = ?').run(now, taskBinId);
      }
      // Mark the bin as emptied immediately while preserving last_seen_at/offline behavior
      const sensor = db.prepare('SELECT * FROM sensors WHERE id = ?').get(tb.sensor_id) as any;
      if (sensor) {
        const nextStatus = sensor.status === 'OFFLINE' ? 'OFFLINE' : 'NORMAL';
        db.prepare('UPDATE sensors SET last_fill_percent = 0, last_distance_cm = ?, status = ? WHERE id = ?').run(
          sensor.bin_height_cm,
          nextStatus,
          sensor.id
        );
      }
    });

    const detail = getFullTaskDetail(taskId, req.auth!.areaId);
    const updatedSensor = serializeSensor(db.prepare('SELECT * FROM sensors WHERE id = ?').get(tb.sensor_id));
    broadcastToAreaAdmins(req.auth!.areaId, 'task:updated', detail);
    broadcastToAreaAdmins(req.auth!.areaId, 'sensor:updated', updatedSensor);
    broadcastToUser(req.auth!.userId, req.auth!.areaId, 'task:updated', detail);

    res.json({ task: detail });
  }
);

apiRouter.patch('/employee/tasks/:id/complete', requireAuth, requireRole('EMPLOYEE'), (req: AuthedRequest, res: Response) => {
  const taskId = Number(req.params.id);
  const { completionNote } = req.body || {};

  const task = db
    .prepare('SELECT id, status FROM tasks WHERE id = ? AND assigned_to = ? AND area_id = ?')
    .get(taskId, req.auth!.userId, req.auth!.areaId) as any;

  if (!task) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }
  if (task.status !== 'ACCEPTED') {
    res.status(400).json({ error: 'Only accepted tasks can be marked completed.' });
    return;
  }

  const now = new Date().toISOString();
  const updatedSensors: any[] = [];

  withTransaction(() => {
    db.prepare("UPDATE tasks SET status = 'COMPLETED', completed_at = ?, completion_note = ? WHERE id = ?").run(
      now,
      completionNote ? String(completionNote).trim() : null,
      taskId
    );

    // Ensure all stops are marked collected and sensors emptied
    const uncollected = db
      .prepare('SELECT id, sensor_id FROM task_bins WHERE task_id = ? AND collected_at IS NULL')
      .all(taskId) as any[];
    for (const row of uncollected) {
      db.prepare('UPDATE task_bins SET collected_at = ? WHERE id = ?').run(now, row.id);
    }

    const allTaskBins = db.prepare('SELECT sensor_id FROM task_bins WHERE task_id = ?').all(taskId) as any[];
    for (const tb of allTaskBins) {
      const sensor = db.prepare('SELECT * FROM sensors WHERE id = ?').get(tb.sensor_id) as any;
      if (sensor) {
        const nextStatus = sensor.status === 'OFFLINE' ? 'OFFLINE' : 'NORMAL';
        db.prepare('UPDATE sensors SET last_fill_percent = 0, last_distance_cm = ?, status = ? WHERE id = ?').run(
          sensor.bin_height_cm,
          nextStatus,
          sensor.id
        );
        updatedSensors.push(serializeSensor(db.prepare('SELECT * FROM sensors WHERE id = ?').get(sensor.id)));
      }
    }
  });

  const detail = getFullTaskDetail(taskId, req.auth!.areaId);
  broadcastToAreaAdmins(req.auth!.areaId, 'task:updated', detail);
  for (const s of updatedSensors) {
    broadcastToAreaAdmins(req.auth!.areaId, 'sensor:updated', s);
  }
  broadcastToUser(req.auth!.userId, req.auth!.areaId, 'task:updated', detail);

  res.json({ task: detail });
});

apiRouter.patch('/employee/location', requireAuth, requireRole('EMPLOYEE'), (req: AuthedRequest, res: Response) => {
  const { latitude, longitude } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: 'Valid GPS latitude and longitude required.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_lat = ?, last_lng = ?, last_location_at = ? WHERE id = ?').run(
    lat,
    lng,
    now,
    req.auth!.userId
  );

  res.json({ success: true, latitude: lat, longitude: lng, updatedAt: now });
});

// ==================== NOTIFICATIONS ====================
apiRouter.get('/notifications', requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT id, type, message, related_task_id, read_flag, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 30`
    )
    .all(req.auth!.userId) as any[];

  res.json({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      relatedTaskId: n.related_task_id,
      read: Boolean(n.read_flag),
      createdAt: n.created_at,
    })),
  });
});

apiRouter.patch('/notifications/read-all', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read_flag = 1 WHERE user_id = ?').run(req.auth!.userId);
  res.json({ success: true });
});

apiRouter.patch('/notifications/:id/read', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read_flag = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.auth!.userId
  );
  res.json({ success: true });
});
