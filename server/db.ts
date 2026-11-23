import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'smart_waste.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      centre_lat REAL NOT NULL,
      centre_lng REAL NOT NULL,
      default_interval_seconds INTEGER NOT NULL DEFAULT 900,
      medium_threshold INTEGER NOT NULL DEFAULT 50,
      full_threshold INTEGER NOT NULL DEFAULT 80,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      mobile TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      last_lat REAL,
      last_lng REAL,
      last_location_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sensors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      bin_id TEXT NOT NULL,
      label TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      bin_height_cm REAL NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 900,
      full_threshold INTEGER NOT NULL DEFAULT 80,
      device_key_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('NORMAL', 'MEDIUM', 'FULL', 'OFFLINE')),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_fill_percent REAL,
      last_distance_cm REAL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (area_id, bin_id),
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id INTEGER NOT NULL,
      distance_cm REAL NOT NULL,
      fill_percent REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      assigned_to INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'ACCEPTED', 'COMPLETED', 'CANCELLED')),
      start_type TEXT NOT NULL DEFAULT 'DEPOT',
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      route_geometry TEXT NOT NULL,
      total_distance_meters REAL NOT NULL DEFAULT 0,
      estimated_time_seconds REAL NOT NULL DEFAULT 0,
      note TEXT,
      completion_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS task_bins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      sensor_id INTEGER NOT NULL,
      stop_order INTEGER NOT NULL,
      fill_at_assignment REAL,
      collected_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      related_task_id INTEGER,
      read_flag INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_area ON users(area_id);
    CREATE INDEX IF NOT EXISTS idx_sensors_area ON sensors(area_id);
    CREATE INDEX IF NOT EXISTS idx_readings_sensor_time ON sensor_readings(sensor_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_area_status ON tasks(area_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to, status);
    CREATE INDEX IF NOT EXISTS idx_task_bins_task ON task_bins(task_id, stop_order);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_flag, created_at);
  `);
}

export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
