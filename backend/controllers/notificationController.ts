import type { Response } from 'express';
import { db } from '../database/db.ts';
import type { AuthedRequest } from '../middleware/auth.ts';

export function listNotifications(req: AuthedRequest, res: Response) {
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
}

export function markAllNotificationsRead(req: AuthedRequest, res: Response) {
  db.prepare('UPDATE notifications SET read_flag = 1 WHERE user_id = ?').run(req.auth!.userId);
  res.json({ success: true });
}

export function markNotificationRead(req: AuthedRequest, res: Response) {
  db.prepare('UPDATE notifications SET read_flag = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.auth!.userId
  );
  res.json({ success: true });
}
