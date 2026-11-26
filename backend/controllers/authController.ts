import type { Request, Response } from 'express';
import { db, withTransaction } from '../database/db.ts';
import {
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  signToken,
  validatePasswordStrength,
  verifyPassword,
  type AuthedRequest,
} from '../middleware/auth.ts';

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

export function registerAdmin(req: Request, res: Response) {
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
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: 'Valid area coordinates are required.' });
    return;
  }

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
}

export function login(req: Request, res: Response) {
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
}

export function logout(req: Request, res: Response) {
  clearSessionCookie(req, res);
  res.json({ success: true });
}

export function getMe(req: AuthedRequest, res: Response) {
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
}

export function changePassword(req: AuthedRequest, res: Response) {
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
}
