import { afterAll } from 'vitest'
import { removeTestDirs, testDir } from './tmp'

// HOME ชั่วคราวต่อ test file: CLI/doctor/integration ลง skill และ launcher ไว้ใต้ HOME
// (~/.claude/skills, ~/.codex/skills, ~/.local/bin) ห้ามไปเขียนทับของจริงบนเครื่องคนรัน test
process.env.HOME = testDir('home-')

// hook ของ setup file รันหลัง afterAll ของ test file (hooks แบบ stack) จึงลบหลัง server/daemon ถูกหยุดแล้ว
afterAll(removeTestDirs)
