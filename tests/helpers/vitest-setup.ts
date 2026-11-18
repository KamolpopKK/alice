import { afterAll } from 'vitest'
import { removeTestDirs } from './tmp'

// hook ของ setup file รันหลัง afterAll ของ test file (hooks แบบ stack) จึงลบหลัง server/daemon ถูกหยุดแล้ว
afterAll(removeTestDirs)
