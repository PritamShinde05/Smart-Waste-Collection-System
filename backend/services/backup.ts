import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, db } from '../database/db.ts';

export const backupDir = path.join(dataDir, 'backups');

export interface BackupMetadata {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  verified: boolean;
}

function getRetentionCount(): number {
  const raw = Number(process.env.DB_BACKUP_RETENTION_COUNT || 7);
  return Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 7;
}

export function ensureBackupDir(): void {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

export function verifySqliteFile(filePath: string): boolean {
  const checkDb = new DatabaseSync(filePath, { readOnly: true });
  try {
    const row = checkDb.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    return row?.integrity_check === 'ok';
  } finally {
    checkDb.close();
  }
}

export function pruneOldBackups(): void {
  ensureBackupDir();
  const retention = getRetentionCount();
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('smart_waste_') && f.endsWith('.db'))
    .sort()
    .reverse();

  for (const oldFile of files.slice(retention)) {
    try {
      fs.unlinkSync(path.join(backupDir, oldFile));
    } catch {
      // ignore cleanup errors
    }
  }
}

export function createVerifiedBackup(): BackupMetadata {
  ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `smart_waste_${stamp}.db`;
  const targetPath = path.join(backupDir, filename);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  const escaped = targetPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  const verified = verifySqliteFile(targetPath);
  if (!verified) {
    try {
      fs.unlinkSync(targetPath);
    } catch {
      // ignore
    }
    throw new Error('SQLite backup verification (PRAGMA integrity_check) failed.');
  }

  pruneOldBackups();
  const stat = fs.statSync(targetPath);

  return {
    filename,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    verified: true,
  };
}

export function listBackups(): BackupMetadata[] {
  ensureBackupDir();
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('smart_waste_') && f.endsWith('.db'))
    .sort()
    .reverse();

  return files.map((filename) => {
    const full = path.join(backupDir, filename);
    const stat = fs.statSync(full);
    return {
      filename,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
      verified: true,
    };
  });
}
