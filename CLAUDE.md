# CLAUDE.md

คำแนะนำสำหรับ Claude Code เมื่อทำงานกับ repository นี้

## ภาพรวม

**Alice** คือ taskboard แบบ self-hosted (AGPL-3.0) ที่คนและ AI agent ทำงานบนบอร์ดเดียวกัน
- คนใช้ web dashboard (React), agent ใช้ remote MCP (Streamable HTTP) หรือ stdio adapter + skill ที่ติดตั้งได้
- ทุก mutation บันทึก activity event พร้อม actor ใน transaction เดียวกัน
- เอกสารผู้ใช้/operator อยู่ใน `docs/` และ README — งานที่อยู่นอกขอบเขตของงานที่ได้รับ ให้บันทึกเป็น follow-up แทนการเพิ่มเอง
- Commit message บอกผลลัพธ์ของงาน ไม่ใส่ ID ของ spec/task ภายใน

## Stack และโครงสร้าง

TypeScript แพ็กเกจเดียว (deployable unit เดียว), Node 24, SQLite (better-sqlite3, WAL)

```
src/shared/   contract ที่ใช้ร่วมกัน: zod schemas, enums, error codes, version
src/client/   AliceClient + Transport interface ของ Client API v1 (ใช้ร่วมกันโดย Web, CLI, Desktop — ห้าม import โค้ด server)
src/server/   Fastify server, db/migrations, domain services, http routes, mcp, ops (backup/restore/export/purge), cli.ts
src/cli/      `alice` CLI (remote human client; bundle ไฟล์เดียว ห้าม import server runtime/SQLite — ยกเว้น agent-setup ที่เป็น fs ล้วน)
src-tauri/    Alice Desktop (Tauri 2, Rust core ถือ credential + network ทั้งหมด; WebView เรียกได้เฉพาะคำสั่งใน build.rs/capabilities) — ดู docs/desktop.md
src/stdio/    stdio MCP adapter (forward ไป remote MCP ไม่เก็บข้อมูล)
src/web/      React + Vite + react-router + react-query
skill/alice/  agent skill ที่แจกจ่าย (version ต้องตรงกับ server)
tests/system/ system tests — boot server จริงกับ SQLite ชั่วคราว แล้วทดสอบผ่าน HTTP / MCP / SSE
tests/unit/   เฉพาะ algorithm ที่แยกได้ (cycle detection, context budget, crypto, path sanitize, config)
tests/e2e/    Playwright browser tests
```

หลักการสำคัญ:
- **Domain services** (`src/server/domain/`) คือที่เดียวที่แก้ข้อมูล — ทั้ง HTTP และ MCP เรียกผ่านชั้นนี้ ทุก mutation ต้องอยู่ใน `db.transaction` และเขียน activity event ในนั้นด้วย แล้ว publish invalidation ไป SSE bus หลัง commit
- ID สาธารณะเป็น opaque string มี prefix (`tsk_`, `prj_`, `doc_`, `act_`, ...) ห้ามใช้ rowid เป็น id สาธารณะ
- Schema เปลี่ยนได้ทาง migration ใหม่ต่อท้ายใน `src/server/db/migrations.ts` เท่านั้น ห้ามแก้ migration เก่า
- เปลี่ยน schema หรือ MCP contract ต้องแก้ migration + zod contract + tests + เอกสารใน task เดียวกัน
- Error ใช้ code คงที่จาก `src/shared/errors.ts`
- Human route เขียนแบบไม่มี prefix แล้ว mount ทั้ง `/client/v1` (contract ที่รองรับ) และ `/api` (compat window) — client ฝั่งคนต้องใช้ `/client/v1` ผ่าน `AliceClient` เท่านั้น ดู [docs/client-api.md](docs/client-api.md)
- ห้าม log secret (password, token, cookie, bootstrap code)

## คำสั่ง

```bash
npm install
npm run dev          # server (tsx watch) + vite dev
npm run build        # build web + bundle server/cli/stdio ไป dist/
npm run typecheck
npm test             # unit + system tests (vitest)
npm run test:e2e     # Playwright (ต้อง build ก่อน)
npm run test:desktop # cargo test ของ Rust core กับ server จริง (ต้องมี Rust)
npm run desktop:dev  # หน้าต่าง Tauri สำหรับพัฒนา
node dist/alice-server.js serve | migrate | backup | restore | export | purge
node dist/alice.js profile|auth|...   # CLI ฝั่งคน (ดู docs/cli.md)
```

## สไตล์โค้ด

- TypeScript strict, ESM, 2-space indent, ไม่ใช้ semicolon, single quote
- ชื่อฟังก์ชัน/ตัวแปร/เอกสารผู้ใช้เป็นภาษาอังกฤษ, comment อธิบายเพิ่มเป็นภาษาไทยได้
- ทดสอบผ่าน system seam เป็นหลัก ไม่ assert รายละเอียดภายใน (ชื่อตาราง ฯลฯ) ถ้าทำผ่าน public interface ได้
- โฟลเดอร์ชั่วคราวใน test สร้างผ่าน `testDir(prefix)` จาก `tests/helpers/tmp.ts` เท่านั้น (ห้ามเรียก `mkdtemp` เอง): ถูกลบอัตโนมัติเมื่อไฟล์ test/worker จบ ไม่ต้องลบเอง ตั้ง `ALICE_KEEP_TEST_DIRS=1` ถ้าต้องเก็บไว้ debug — unit test `tests/unit/test-temp-dirs.test.ts` บังคับกติกานี้
