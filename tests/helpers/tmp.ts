// Temporary directories ของ test: สร้างผ่าน helper นี้เท่านั้น เพื่อให้ลบทิ้งได้เมื่อ test file / worker จบ
// (runtime หนึ่งชุด copy ไบนารี Node ไปด้วย ~240 MB ถ้าไม่ลบ disk เต็มได้ใน run ไม่กี่รอบ)
// ตั้ง ALICE_KEEP_TEST_DIRS=1 เพื่อเก็บไว้ debug
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const created: string[] = []

export const keepTestDirs = process.env.ALICE_KEEP_TEST_DIRS === '1'

/** Creates a unique directory (`<parent>/<prefix>XXXXXX`) that is removed when the test file or worker finishes. */
export function testDir(prefix: string, parent = os.tmpdir()): string {
  fs.mkdirSync(parent, { recursive: true })
  const dir = fs.mkdtempSync(path.join(parent, prefix))
  created.push(dir)
  return dir
}

/** Removes every directory created through `testDir` in this process, unless ALICE_KEEP_TEST_DIRS=1. */
export function removeTestDirs(): void {
  if (keepTestDirs) return
  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch {
      // daemon ที่ยังปิดไม่เสร็จอาจเขียนไฟล์ระหว่างลบ: ไม่ให้ cleanup ทำ test fail
    }
  }
}

// fallback สำหรับ worker ที่ไม่ผ่าน afterAll ของ vitest (เช่น Playwright worker)
process.once('exit', removeTestDirs)
