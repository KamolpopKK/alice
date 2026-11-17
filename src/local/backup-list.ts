// รายการ backup ของ Local workspace แบบอ่านไฟล์อย่างเดียว (ใช้ได้ทั้ง CLI และ server โดยไม่เปิด SQLite)
import fs from 'node:fs'
import path from 'node:path'
import { workspacePaths } from './paths'

export interface BackupListing {
  name: string
  dir: string
  kind: string
  createdAt: string
  bytes: number
  schemaVersion: number
}

export function listBackupDirs(root: string, workspaceId: string): BackupListing[] {
  const dir = workspacePaths(root, workspaceId).backups
  if (!fs.existsSync(dir)) return []
  const out: BackupListing[] = []
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, name, 'manifest.json'), 'utf8')) as { kind?: string; createdAt: string; schemaVersion: number; database: { bytes: number } }
      out.push({ name, dir: path.join(dir, name), kind: m.kind ?? name.replace(/-\d.*$/, ''), createdAt: m.createdAt, bytes: m.database.bytes, schemaVersion: m.schemaVersion })
    } catch {
      /* incomplete */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
