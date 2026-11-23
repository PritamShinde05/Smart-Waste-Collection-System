import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase } from './server/db.ts';
import { apiRouter } from './server/routes.ts';
import { computeSensorStatus } from './server/status.ts';
import { broadcastToAreaAdmins, setupWebSocketServer } from './server/ws.ts';

async function startServer() {
  initDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);

  const server = http.createServer(app);
  setupWebSocketServer(server);

  // Periodic background sweep to mark timed-out sensors OFFLINE (> 2x configured interval)
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
            nowMs
          );
          if (next === 'OFFLINE') {
            db.prepare("UPDATE sensors SET status = 'OFFLINE' WHERE id = ?").run(s.id);
            broadcastToAreaAdmins(area.id, 'sensor:updated', {
              id: s.id,
              areaId: s.area_id,
              binId: s.bin_id,
              label: s.label,
              latitude: s.latitude,
              longitude: s.longitude,
              binHeightCm: s.bin_height_cm,
              intervalSeconds: s.interval_seconds,
              fullThreshold: s.full_threshold,
              status: 'OFFLINE',
              isActive: Boolean(s.is_active),
              lastFillPercent: s.last_fill_percent,
              lastDistanceCm: s.last_distance_cm,
              lastSeenAt: s.last_seen_at,
              createdAt: s.created_at,
            });
          }
        }
      }
    } catch {
      // Ignore background sweep errors
    }
  }, 20_000);

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
