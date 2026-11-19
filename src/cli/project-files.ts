import fs from 'node:fs'
import path from 'node:path'
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../shared/contracts'

// Alice "project files": บอร์ดที่เก็บเป็น markdown ใน .alice/ ของโปรเจกต์ (ใช้ได้โดยไม่ต้องมี app)
// รูปแบบอธิบายใน docs/project-files.md — ไฟล์นี้อ่านและตรวจอย่างเดียว ไม่แก้ไฟล์

export type FileTask = {
  id: string
  file: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string | null
  due: string | null
  parent: string | null
  blockedBy: string[]
  labels: string[]
  docs: string[]
  description: string
  activity: string[]
}

export type FileDocument = { id: string; file: string; title: string; sourceUrl: string | null; body: string }

export type ProjectFiles = { dir: string; name: string | null; tasks: FileTask[]; documents: FileDocument[] }

export class ProjectFilesError extends Error {
  constructor(readonly problems: string[]) {
    super(`${problems.length} problem${problems.length === 1 ? '' : 's'} in the project files:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
}

const TASK_ID = /^T-\d+$/
const DOC_ID = /^D-\d+$/

/** A scalar from front matter: quotes removed, `null`/`~`/empty is null. */
function scalar(raw: string): string | null {
  const quoted = /^\s*("([^"]*)"|'((?:[^']|'')*)')\s*(#.*)?$/.exec(raw)
  if (quoted) return quoted[2] ?? quoted[3].replace(/''/g, "'")
  const v = raw.replace(/\s+#.*$/, '').trim()
  return v === '' || v === 'null' || v === '~' ? null : v
}

/**
 * Front matter in the small YAML subset the format uses: `key: value`, inline lists `[a, b]` and block
 * lists (`key:` then `- a` lines). Anything else is reported instead of guessed.
 */
function parseFrontMatter(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  let listKey: string | null = null
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = /^\s+-\s*(.*)$/.exec(line) ?? (listKey ? /^-\s*(.*)$/.exec(line) : null)
    if (item && listKey) {
      const v = scalar(item[1])
      if (v !== null) (data[listKey] as string[]).push(v)
      continue
    }
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) throw new Error(`front matter line ${i + 1} is not "key: value"`)
    const [, key, rest] = m
    listKey = null
    const value = rest.trim()
    if (value === '' || value.startsWith('#')) {
      data[key] = []
      listKey = key
    } else if (/^\[.*\](\s+#.*)?$/.test(value)) {
      data[key] = value
        .slice(1, value.lastIndexOf(']'))
        .split(',')
        .map(scalar)
        .filter((v): v is string => v !== null)
    } else data[key] = scalar(value)
  }
  return data
}

/** Splits `---` front matter from the Markdown body. */
function frontMatter(text: string): { data: Record<string, unknown>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ''))
  if (!m) return null
  return { data: parseFrontMatter(m[1]), body: m[2] }
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' || Array.isArray(v) ? null : String(v).trim() || null)
const list = (v: unknown): string[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : String(v).split(',').map((x) => x.trim()).filter(Boolean))

/** The `## Activity` section is history, not part of the description. */
function splitActivity(body: string): { description: string; activity: string[] } {
  const m = /^## Activity[ \t]*$/m.exec(body)
  if (!m) return { description: body.trim(), activity: [] }
  const rest = body.slice(m.index + m[0].length)
  const next = /^## /m.exec(rest)
  const section = next ? rest.slice(0, next.index) : rest
  const after = next ? rest.slice(next.index) : ''
  const activity = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
  return { description: `${body.slice(0, m.index)}${after}`.trim(), activity }
}

function readDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
}

/** Reads and checks `.alice/` (board.md, tasks/*.md, docs/*.md). Collects every problem before failing. */
export function readProjectFiles(dir: string): ProjectFiles {
  const root = path.resolve(dir)
  if (!fs.existsSync(path.join(root, 'tasks')) && !fs.existsSync(path.join(root, 'docs'))) {
    throw new ProjectFilesError([`${dir} has no tasks/ or docs/ folder`])
  }
  const problems: string[] = []
  let name: string | null = null
  const boardFile = path.join(root, 'board.md')
  if (fs.existsSync(boardFile)) {
    try {
      name = str(frontMatter(fs.readFileSync(boardFile, 'utf8'))?.data.name)
    } catch (err) {
      problems.push(`board.md: ${(err as Error).message.split('\n')[0]}`)
    }
  }

  const documents: FileDocument[] = []
  for (const f of readDir(path.join(root, 'docs'))) {
    const file = `docs/${f}`
    try {
      const fm = frontMatter(fs.readFileSync(path.join(root, file), 'utf8'))
      if (!fm) {
        problems.push(`${file}: missing front matter (--- … ---)`)
        continue
      }
      const id = str(fm.data.id)
      const title = str(fm.data.title)
      if (!id || !DOC_ID.test(id)) problems.push(`${file}: id must look like D-1`)
      if (!title) problems.push(`${file}: title is required`)
      if (id && title) documents.push({ id, file, title, sourceUrl: str(fm.data.source_url), body: fm.body.trim() })
    } catch (err) {
      problems.push(`${file}: ${(err as Error).message.split('\n')[0]}`)
    }
  }

  const tasks: FileTask[] = []
  for (const f of readDir(path.join(root, 'tasks'))) {
    const file = `tasks/${f}`
    try {
      const fm = frontMatter(fs.readFileSync(path.join(root, file), 'utf8'))
      if (!fm) {
        problems.push(`${file}: missing front matter (--- … ---)`)
        continue
      }
      const d = fm.data
      const id = str(d.id)
      const title = str(d.title)
      const status = (str(d.status) ?? 'backlog') as TaskStatus
      const priority = (str(d.priority) ?? 'none') as TaskPriority
      if (!id || !TASK_ID.test(id)) problems.push(`${file}: id must look like T-1`)
      if (!title) problems.push(`${file}: title is required`)
      if (!TASK_STATUSES.includes(status)) problems.push(`${file}: status must be one of ${TASK_STATUSES.join(', ')}`)
      if (!TASK_PRIORITIES.includes(priority)) problems.push(`${file}: priority must be one of ${TASK_PRIORITIES.join(', ')}`)
      const assignee = str(d.assignee)
      const parent = str(d.parent)
      const due = str(d.due)
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) problems.push(`${file}: due must be YYYY-MM-DD`)
      const { description, activity } = splitActivity(fm.body)
      if (id && title) {
        tasks.push({
          id,
          file,
          title,
          status,
          priority,
          assignee: assignee === 'none' ? null : assignee,
          due,
          parent: parent === 'none' ? null : parent,
          blockedBy: list(d.blocked_by),
          labels: list(d.labels),
          docs: list(d.docs),
          description,
          activity,
        })
      }
    } catch (err) {
      problems.push(`${file}: ${(err as Error).message.split('\n')[0]}`)
    }
  }

  // อ้างอิงข้ามไฟล์ต้องมีจริง และ id ต้องไม่ซ้ำ
  const seen = new Map<string, string>()
  for (const item of [...tasks, ...documents]) {
    const other = seen.get(item.id)
    if (other) problems.push(`${item.file}: id ${item.id} is also used by ${other}`)
    seen.set(item.id, item.file)
  }
  const taskIds = new Set(tasks.map((t) => t.id))
  const docIds = new Set(documents.map((d) => d.id))
  for (const t of tasks) {
    if (t.parent && !taskIds.has(t.parent)) problems.push(`${t.file}: parent ${t.parent} is not a task file`)
    for (const b of t.blockedBy) if (!taskIds.has(b)) problems.push(`${t.file}: blocked_by ${b} is not a task file`)
    for (const doc of t.docs) if (!docIds.has(doc)) problems.push(`${t.file}: docs ${doc} is not a document file`)
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const t of tasks) {
    const chain = new Set<string>()
    for (let cur: FileTask | undefined = t; cur?.parent; cur = byId.get(cur.parent)) {
      if (chain.has(cur.id)) {
        problems.push(`${t.file}: parent chain loops back to ${cur.id}`)
        break
      }
      chain.add(cur.id)
    }
  }
  if (problems.length) throw new ProjectFilesError(problems)
  return { dir: root, name, tasks: orderParentsFirst(tasks), documents }
}

/** Parents before children, so each task is created with its parent id. */
function orderParentsFirst(tasks: FileTask[]): FileTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const done = new Set<string>()
  const out: FileTask[] = []
  const visit = (t: FileTask) => {
    if (done.has(t.id)) return
    done.add(t.id)
    const parent = t.parent ? byId.get(t.parent) : undefined
    if (parent) visit(parent)
    out.push(t)
  }
  for (const t of [...tasks].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))) visit(t)
  return out
}
