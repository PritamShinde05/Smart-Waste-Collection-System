import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './db.ts';
import { parseCookies, SESSION_COOKIE_NAME, verifyToken, type AuthPayload } from './auth.ts';

interface ClientMeta {
  ws: WebSocket;
  auth: AuthPayload;
}

const clients = new Set<ClientMeta>();

export function setupWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      // Let Vite HMR or other upgrade paths pass if unhandled, or close non-ws
      return;
    }

    const tokenParam = url.searchParams.get('token');
    const cookies = parseCookies(request.headers.cookie);
    const token = tokenParam || cookies[SESSION_COOKIE_NAME] || null;
    const auth = token ? verifyToken(token) : null;

    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify user is still active in DB
    const user = db
      .prepare('SELECT id, area_id, role, status FROM users WHERE id = ?')
      .get(auth.userId) as { id: number; area_id: number; role: 'ADMIN' | 'EMPLOYEE'; status: string } | undefined;

    if (!user || user.status !== 'ACTIVE') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, { ...auth, areaId: user.area_id, role: user.role });
    });
  });

  wss.on('connection', (ws: WebSocket, auth: AuthPayload) => {
    const meta: ClientMeta = { ws, auth };
    clients.add(meta);

    ws.send(
      JSON.stringify({
        event: 'connected',
        payload: { userId: auth.userId, areaId: auth.areaId, role: auth.role },
      })
    );

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 25000);

    ws.on('close', () => {
      clearInterval(pingInterval);
      clients.delete(meta);
    });

    ws.on('error', () => {
      clearInterval(pingInterval);
      clients.delete(meta);
    });
  });

  return wss;
}

export function broadcastToAreaAdmins(areaId: number, event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (
      client.auth.areaId === areaId &&
      client.auth.role === 'ADMIN' &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(message);
    }
  }
}

export function broadcastToUser(userId: number, areaId: number, event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (
      client.auth.userId === userId &&
      client.auth.areaId === areaId &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(message);
    }
  }
}
