import fs from 'node:fs'
import path from 'node:path'

/** esbuild options for the standalone `alice` CLI: one file, every dependency bundled, skills embedded. */
export function cliBuildOptions(outdir, root = process.cwd()) {
  // ฝังทุก skill ใต้ skill/<name>/ (ไฟล์ markdown ระดับเดียว) — โครง { [skill]: { [file]: content } }
  const skillsRoot = path.join(root, 'skill')
  // skill/_shared/ ถูกใส่ลงในทุก skill (ไฟล์ของ skill เองชนะถ้าชื่อซ้ำ) — ตรงกับ skillFiles() ใน agent-setup
  const sharedDir = path.join(skillsRoot, '_shared')
  const shared = fs.existsSync(sharedDir) ? Object.fromEntries(fs.readdirSync(sharedDir).map((f) => [f, fs.readFileSync(path.join(sharedDir, f), 'utf8')])) : {}
  const skill = Object.fromEntries(
    fs
      .readdirSync(skillsRoot)
      .filter((name) => fs.existsSync(path.join(skillsRoot, name, 'SKILL.md')))
      .map((name) => {
        const dir = path.join(skillsRoot, name)
        return [name, { ...shared, ...Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')])) }]
      }),
  )
  return {
    entryPoints: { alice: path.join(root, 'src/cli/index.ts') },
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    minifySyntax: true,
    banner: { js: '#!/usr/bin/env node' },
    define: { __ALICE_SKILL_FILES__: JSON.stringify(skill) },
    logLevel: 'warning',
  }
}
