import type { Response } from 'express';
import { db, withTransaction } from '../database/db.ts';
import type { AuthedRequest } from '../middleware/auth.ts';
import { computeSensorStatus, serializeSensor } from '../services/status.ts';
import { broadcastToAreaAdmins } from '../services/ws.ts';
import { createVerifiedBackup, listBackups } from '../services/backup.ts';

export function getArea(req: AuthedRequest, res: Response) {
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
}

export function updateArea(req: AuthedRequest, res: Response) {
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

  const areaDto = {
    id: updatedArea.id,
    name: updatedArea.name,
    city: updatedArea.city,
    centreLat: updatedArea.centre_lat,
    centreLng: updatedArea.centre_lng,
    defaultIntervalSeconds: updatedArea.default_interval_seconds,
    mediumThreshold: updatedArea.medium_threshold,
    fullThreshold: updatedArea.full_threshold,
  };

  broadcastToAreaAdmins(req.auth!.areaId, 'area:updated', {
    area: areaDto,
    sensors: updatedSensors,
  });

  res.json(areaDto);
}

export function getAdminBackups(_req: AuthedRequest, res: Response) {
  res.json({ backups: listBackups() });
}

export function triggerAdminBackup(_req: AuthedRequest, res: Response) {
  try {
    const backup = createVerifiedBackup();
    res.status(201).json({ backup, backups: listBackups() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Database backup failed.' });
  }
}
