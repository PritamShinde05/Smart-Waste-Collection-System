import type { Response } from 'express';
import { db } from '../database/db.ts';
import type { AuthedRequest } from '../middleware/auth.ts';
import { getAreaThresholds, refreshSensorStatusRow } from '../services/status.ts';

export function getDashboardSummary(req: AuthedRequest, res: Response) {
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
}

export function getFillTrends(req: AuthedRequest, res: Response) {
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
}

export function getCollectionsStats(req: AuthedRequest, res: Response) {
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
}

export function getEmployeeStats(req: AuthedRequest, res: Response) {
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
}
