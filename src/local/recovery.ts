// อ่านสถานะกู้คืนที่ daemon เขียนไว้เมื่อเปิด workspace ไม่ได้ (integrity, migration) — ไม่เปิด SQLite
import fs from 'node:fs'
import path from 'node:path'
import { workspacePaths } from './paths'

export interface RecoveryRecord {
  state: 'integrity' | 'migration-failed' | 'outbox' | 'credential-store'
  message: string
  at: string
  backup?: string | null
}

export function readRecoveryRecord(root: string, workspaceId: string): RecoveryRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspacePaths(root, workspaceId).dir, 'recovery.json'), 'utf8')) as RecoveryRecord
  } catch {
    return null
  }
}
