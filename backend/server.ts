import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase } from './database/db.ts';
import { apiRouter } from './routes/apiRoutes.ts';
import { computeSensorStatus, serializeSensor } from './services/status.ts';
import { broadcastToAreaAdmins, setupWebSocketServer } from './services/ws.ts';
import { createVerifiedBackup, listBackups } from './services/backup.ts';

function startOfflineMonitor() {
  setInterval(() => {
    try {
      const areas = db.prepare('SELECT id, medium_threshold FROM areas').all() as Array<{
        id: number;
        medium_threshold: number;
      }>;
      const nowMs = Date.now();
      for (const area of areas) {
        const activeOnline = db
          .prepare("SELECT * FROM sensors WHERE area_id = ? AND is_active = 1 AND status != 'OFFLINE'")
          .all(area.id) as any[];
        for (const s of activeOnline) {
          const next = computeSensorStatus(
            s.last_fill_percent,
            s.last_seen_at,
            s.interval_seconds,
            area.medium_threshold,
            s.full_threshold,
            nowMs,
            Boolean(s.is_active)
          );
          if (next === 'OFFLINE') {
            db.prepare("UPDATE sensors SET status = 'OFFLINE' WHERE id = ?").run(s.id);
            s.status = 'OFFLINE';
            broadcastToAreaAdmins(area.id, 'sensor:updated', serializeSensor(s));
          }
        }
      }
    } catch {
      // Ignore transient sweep errors
    }
  }, 20_000);
}

function startAutomatedBackups() {
  if (process.env.DB_BACKUP_ENABLED === 'false') {
    return;
  }
  const intervalHours = Math.max(1, Number(process.env.DB_BACKUP_INTERVAL_HOURS || 24));
  const intervalMs = intervalHours * 60 * 60 * 1000;

  try {
    const existing = listBackups();
    if (existing.length === 0) {
      createVerifiedBackup();
    }
  } catch (err) {
    console.warn('[backup] Initial SQLite backup skipped:', err);
  }

  setInterval(() => {
    try {
      createVerifiedBackup();
    } catch (err) {
      console.error('[backup] Scheduled SQLite backup failed:', err);
    }
  }, intervalMs);
}

export async function startServer() {
  initDatabase();
  startOfflineMonitor();
  startAutomatedBackups();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);

  const server = http.createServer(app);
  setupWebSocketServer(server);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server } : false,
        ws: { server, path: '/__vite_ws' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VerdantRoute server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
