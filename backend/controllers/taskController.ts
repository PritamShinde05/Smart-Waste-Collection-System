import type { Response } from 'express';
import { db, withTransaction } from '../database/db.ts';
import type { AuthedRequest } from '../middleware/auth.ts';
import { optimizeRoadRoute } from '../services/routing.ts';
import { serializeSensor } from '../services/status.ts';
import { broadcastToAreaAdmins, broadcastToUser } from '../services/ws.ts';

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

export async function previewRoute(req: AuthedRequest, res: Response) {
  const { startType, employeeId, sensorIds, returnToDepot } = req.body || {};
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
    const optimized = await optimizeRoadRoute(resolved.startPoint, resolved.bins, {
      returnToDepot: Boolean(returnToDepot),
    });
    res.json({
      startType: resolved.startType,
      startPoint: resolved.startPoint,
      ...optimized,
    });
  } catch (err: any) {
    const status = err?.message?.includes('Maximum') ? 400 : 503;
    res.status(status).json({
      error: err.message || 'Road routing service is temporarily unavailable. Please retry.',
      retryable: status === 503,
    });
  }
}

export async function createTask(req: AuthedRequest, res: Response) {
  const { employeeId, sensorIds, startType, note, returnToDepot } = req.body || {};
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
    optimized = await optimizeRoadRoute(resolved.startPoint, resolved.bins, {
      returnToDepot: Boolean(returnToDepot),
    });
  } catch (err: any) {
    const status = err?.message?.includes('Maximum') ? 400 : 503;
    res.status(status).json({
      error: err.message || 'Road routing service temporarily unavailable. Please retry.',
      retryable: status === 503,
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
}

export function listTasks(req: AuthedRequest, res: Response) {
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
}

export function getTaskDetail(req: AuthedRequest, res: Response) {
  const detail = getFullTaskDetail(Number(req.params.id), req.auth!.areaId);
  if (!detail) {
    res.status(404).json({ error: 'Task not found in your area.' });
    return;
  }
  res.json({ task: detail });
}

export function cancelTask(req: AuthedRequest, res: Response) {
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
}

export async function reoptimizeTask(req: AuthedRequest, res: Response) {
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
    optimized = await optimizeRoadRoute(resolved.startPoint, resolved.bins, {
      returnToDepot: Boolean(req.body?.returnToDepot),
    });
  } catch (err: any) {
    const status = err?.message?.includes('Maximum') ? 400 : 503;
    res.status(status).json({
      error: err.message || 'Road routing service unavailable. Please retry.',
      retryable: status === 503,
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
}

export function listMyTasks(req: AuthedRequest, res: Response) {
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
}

export function getMyTaskDetail(req: AuthedRequest, res: Response) {
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
}

export function acceptTask(req: AuthedRequest, res: Response) {
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
}

export function markBinCollected(req: AuthedRequest, res: Response) {
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

export function completeTask(req: AuthedRequest, res: Response) {
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
}

export function updateMyLocation(req: AuthedRequest, res: Response) {
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
}
