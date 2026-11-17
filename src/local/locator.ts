// Locator ของ daemon: metadata สำหรับเชื่อมต่อ (ไม่มี secret) — client ต้องตรวจกับ health ก่อนใช้เสมอ
import fs from 'node:fs'
import { isProcessAlive } from './paths'

export const LOCATOR_VERSION = 1

export interface Locator {
  locatorVersion: typeof LOCATOR_VERSION
  workspaceId: string
  pid: number
  port: number
  /** Random per daemon start; a reused port with another generation is a different instance. */
  generation: string
  version: string
  startedAt: string
}

export interface LocalHealth {
  status: 'ok' | 'stopping'
  workspaceId: string
  generation: string
  version: string
}

export function readLocator(file: string): Locator | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Locator
    if (parsed.locatorVersion !== LOCATOR_VERSION || !Number.isInteger(parsed.port) || !Number.isInteger(parsed.pid)) return null
    return parsed
  } catch {
    return null
  }
}

export function locatorProcessAlive(locator: Locator): boolean {
  return isProcessAlive(locator.pid)
}
