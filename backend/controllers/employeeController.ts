import type { Response } from 'express';
import { db } from '../database/db.ts';
import { hashPassword, validatePasswordStrength, type AuthedRequest } from '../middleware/auth.ts';
import { broadcastToAreaAdmins } from '../services/ws.ts';

export function listEmployees(req: AuthedRequest, res: Response) {
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
}

export function createEmployee(req: AuthedRequest, res: Response) {
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
}

export function updateEmployee(req: AuthedRequest, res: Response) {
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
}

export function updateEmployeeStatus(req: AuthedRequest, res: Response) {
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
}

export function resetEmployeePassword(req: AuthedRequest, res: Response) {
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
}

export function getEmployeeHistory(req: AuthedRequest, res: Response) {
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
}
