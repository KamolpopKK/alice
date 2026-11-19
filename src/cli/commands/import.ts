import fs from 'node:fs'
import path from 'node:path'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { ProjectFilesError, readProjectFiles, type ProjectFiles } from '../project-files'
import { resolveActor, resolveProject } from './shared'

export const IMPORT_HELP = `Usage: alice import [DIR] [--project ID|NAME] [--dry-run] [--force]

Imports a board kept as Markdown files (DIR defaults to .alice: board.md, tasks/*.md, docs/*.md) into the
selected workspace. Tasks keep their status, priority, due date, labels, parent, blockers and linked
documents; each task's Activity becomes one comment. See docs/project-files.md for the file format.

  --project ID|NAME   Import into this existing project (default: a new project named after board.md)
  --dry-run           Check the files and show what would be created; change nothing
  --force             Import again although DIR/imported.json records an earlier import`

const MAPPING = 'imported.json'

type Created = { project: { id: string; name: string } | null; tasks: Record<string, string>; documents: Record<string, string> }

export async function importCommand(ctx: CliContext, args: string[]): Promise<number> {
  if (args[0] === 'help') {
    ctx.out.line(IMPORT_HELP)
    return 0
  }
  const { values, positionals } = parseCommand(args, { project: { type: 'string' }, 'dry-run': { type: 'boolean' }, force: { type: 'boolean' } }, 1)
  const { out } = ctx
  const dir = positionals[0] ?? '.alice'
  let files: ProjectFiles
  try {
    files = readProjectFiles(dir)
  } catch (err) {
    if (err instanceof ProjectFilesError) throw new CliError(err.message, 'usage', 'Fix the files above, then run alice import again. Nothing was imported.')
    throw err
  }
  const mappingFile = path.join(files.dir, MAPPING)
  if (fs.existsSync(mappingFile) && !values.force) {
    throw new CliError(`${path.join(dir, MAPPING)} shows these files were already imported`, 'not_found', 'Pass --force to import them again as new tasks.')
  }

  const client = ctx.client()
  // agent สร้าง task ที่ done ไม่ได้ (ต้อง complete พร้อม summary): ตรวจก่อนสร้างอะไร
  const doneTasks = files.tasks.filter((t) => t.status === 'done')
  if (doneTasks.length && (await client.auth.me()).actor.kind === 'agent') {
    throw new CliError(`Agents cannot import done tasks (${doneTasks.map((t) => t.id).join(', ')})`, 'usage', 'Run alice import as a person, without --as. Nothing was imported.')
  }
  const projectName = files.name ?? path.basename(path.dirname(files.dir))
  let projectId: string | null = null
  if (values.project) projectId = await resolveProject(client, values.project)
  else {
    const existing = (await client.projects.list('active')).filter((p) => p.name.toLowerCase() === projectName.toLowerCase())
    if (existing.length) throw new CliError(`A project named "${projectName}" already exists`, 'usage', `Pass --project "${projectName}" to import into it, or set another name in ${path.join(dir, 'board.md')}.`)
  }

  // คนที่ assign ไว้ในไฟล์: หาไม่เจอก็ไม่ assign และเตือน (ไม่ทำให้ import ล้ม)
  const warnings: string[] = []
  const assignees = new Map<string, string | null>()
  for (const name of new Set(files.tasks.map((t) => t.assignee).filter((a): a is string => !!a))) {
    try {
      assignees.set(name, await resolveActor(client, name))
    } catch {
      assignees.set(name, null)
      warnings.push(`No person or agent named "${name}" in this workspace; their tasks are imported unassigned.`)
    }
  }

  const plan = {
    dir: files.dir,
    project: values.project ? { id: projectId } : { name: projectName, new: true },
    tasks: files.tasks.length,
    documents: files.documents.length,
    blockers: files.tasks.reduce((n, t) => n + t.blockedBy.length, 0),
    warnings,
  }
  if (values['dry-run']) {
    out.value({ dryRun: true, ...plan }, () => {
      out.line(`Would import ${plan.tasks} task${plan.tasks === 1 ? '' : 's'} and ${plan.documents} document${plan.documents === 1 ? '' : 's'} into ${values.project ? `project ${projectId}` : `a new project "${projectName}"`}.`)
      for (const w of warnings) out.warn(w)
      out.info('Nothing was changed (--dry-run).')
    })
    return 0
  }

  const created: Created = { project: null, tasks: {}, documents: {} }
  try {
    if (!projectId) {
      const res = await client.projects.create({ name: projectName, description: `Imported from ${path.relative(process.cwd(), files.dir) || '.'}`, labels: [] })
      projectId = res.project.id
      created.project = { id: res.project.id, name: res.project.name }
    } else {
      const p = await client.projects.get(projectId)
      created.project = { id: p.id, name: p.name }
    }
    for (const d of files.documents) {
      const res = await client.documents.create({ title: d.title, body: d.body, sourceUrl: d.sourceUrl })
      created.documents[d.id] = res.document.id
      await client.documents.link(res.document.id, { projectId })
    }
    for (const t of files.tasks) {
      const res = await client.tasks.create({
        title: t.title,
        description: t.description,
        projectId,
        status: t.status,
        priority: t.priority,
        dueAt: t.due,
        assigneeId: t.assignee ? (assignees.get(t.assignee) ?? null) : null,
        labels: t.labels,
        parentId: t.parent ? created.tasks[t.parent] : null,
      })
      created.tasks[t.id] = res.task.id
    }
    for (const t of files.tasks) {
      const id = created.tasks[t.id]
      for (const b of t.blockedBy) await client.tasks.addBlocker(id, created.tasks[b])
      for (const d of t.docs) await client.documents.link(created.documents[d], { taskId: id })
      const unresolved = t.assignee && !assignees.get(t.assignee) ? `\nAssignee in the file: ${t.assignee}` : ''
      const history = t.activity.length ? `\n\nActivity:\n${t.activity.map((a) => `- ${a}`).join('\n')}` : ''
      await client.tasks.comment(id, `Imported from ${t.file} (${t.id}).${unresolved}${history}`)
    }
  } catch (err) {
    const made = Object.keys(created.tasks).length + Object.keys(created.documents).length
    const hint = created.project && !values.project ? `Archive project "${created.project.name}" (${created.project.id}) and run alice import again.` : made ? 'Some tasks or documents were created before the failure; check the project before importing again.' : undefined
    // คง error เดิมไว้ (exit code ตามชนิด) แต่บอกก่อนว่าทำอะไรไปแล้วบ้าง
    out.error('Import stopped part way.', hint)
    throw err
  }

  const result = { ...created, warnings }
  fs.writeFileSync(mappingFile, `${JSON.stringify({ importedAt: new Date().toISOString(), ...created }, null, 2)}\n`)
  out.value(result, () => {
    out.line(`Imported ${files.tasks.length} task${files.tasks.length === 1 ? '' : 's'} and ${files.documents.length} document${files.documents.length === 1 ? '' : 's'} into "${created.project!.name}" (${created.project!.id}).`)
    for (const w of warnings) out.warn(w)
    out.info(`Recorded the new ids in ${path.join(dir, MAPPING)}.`)
  })
  return 0
}
