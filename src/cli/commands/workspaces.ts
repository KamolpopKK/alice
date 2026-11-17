// `alice workspace …`: Local และ Remote workspace ในคำสั่งเดียว
import fs from 'node:fs'
import path from 'node:path'
import { probeDaemon } from '../../local/daemon-client'
import { createWorkspace, prepareDelete, renameWorkspace, setWorkspaceAlias, unregisterWorkspace, type LocalWorkspace } from '../../local/registry'
import { capabilityAccount, localCredentialStore } from '../../local/capabilities'
import { acquireWorkspaceLock } from '../../local/lock'
import { workspacePaths } from '../../local/paths'
import { moveToTrash } from '../../local/trash'
import { listBackupDirs } from '../../local/backup-list'
import { LocalSession } from '../local-session'
import { runServer, stopDaemon } from '../local-ops'
import { confirm } from '../output'
import { saveConfig } from '../config'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { BINDING_DIR, LOCAL_BINDING, PORTABLE_BINDING, findBinding, looksLikeWorkspaceId, targetRef, writeBinding, type Target, type WorkspaceRef } from '../workspaces'
import { maintenanceNotice } from '../maintenance'

export const WORKSPACE_HELP = `alice workspace — choose where commands run

  list                               Local and Remote workspaces with id, alias, name, kind and state
  current                            The workspace commands use here, and why
  use ALIAS|ID                       Make it the CLI's active workspace (independent of Alice Desktop)
  create [NAME] [--alias ALIAS]      New Local workspace (default name "Personal" for the first)
  rename ALIAS|ID NAME               Change the display name; the id and alias stay
  alias ALIAS|ID NEW_ALIAS           Change the alias; the id stays
  bind ALIAS|ID [--portable]         Bind this directory: .alice/workspace.local.json (this machine only)
                                     or, with --portable, .alice/workspace.json for a Remote alias you may commit
  unbind [--portable]                Remove that binding file
  status [ALIAS|ID]                  Daemon and maintenance state of a Local workspace
  backup [ALIAS|ID]                  Verified backup now (daily and pre-migration backups are automatic)
  backups [ALIAS|ID]                 List backups (7 daily and 3 pre-migration are kept)
  restore --from DIR                 Restore a backup as a NEW workspace (new id and alias)
  restore ID --latest|--from DIR --replace --confirm NAME
                                     Replace a workspace (exact id); its current data is backed up first
  delete ALIAS|ID --confirm NAME     Stop it and move its data to the Trash

Selection order: --workspace, ALICE_WORKSPACE, .alice/workspace.local.json, .alice/workspace.json,
the active workspace (per human or --as agent), then the only workspace. Otherwise Alice stops and lists them.`

type Row = WorkspaceRef & { active: boolean; state: string }

export async function workspaceCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub = 'help', ...rest] = args
  const { out } = ctx
  ctx.out.useEnvelope(null)
  const resolver = ctx.resolver
  const reserved = () => Object.keys(ctx.config.profiles)
  const describe = (w: LocalWorkspace): WorkspaceRef => ({ id: w.id, name: w.name, alias: w.alias, kind: 'local' })

  switch (sub) {
    case 'list':
    case 'ls': {
      parseCommand(rest, {})
      let current: string | null = null
      try {
        current = targetRef(resolver.resolve(ctx.flags.workspace, ctx.agent)).id
      } catch {
        /* nothing selected */
      }
      const rows: Row[] = []
      for (const w of resolver.registry().workspaces) {
        const probe = await probeDaemon(resolver.root, w.id)
        rows.push({ ...describe(w), active: w.id === current, state: w.state !== 'active' ? w.state : probe.ok ? 'running' : 'stopped' })
      }
      for (const p of Object.values(ctx.config.profiles)) {
        const id = `profile:${p.name}`
        rows.push({ id, name: p.name, alias: p.name, kind: 'remote', active: id === current, state: p.session ? `signed in (${p.server})` : `signed out (${p.server})` })
      }
      out.list(rows, [
        { header: '', value: (r) => (r.active ? '*' : '') },
        { header: 'ID', value: (r) => r.id },
        { header: 'ALIAS', value: (r) => r.alias },
        { header: 'NAME', value: (r) => r.name, max: 30 },
        { header: 'KIND', value: (r) => r.kind },
        { header: 'STATE', value: (r) => r.state, max: 50 },
      ], 'No workspaces yet. Create one with: alice workspace create')
      return 0
    }
    case 'current': {
      parseCommand(rest, {})
      const target = ctx.target()
      const ref = targetRef(target)
      out.value({ ...ref, source: target.source }, () => out.line(`${ref.name} (${ref.alias}, ${ref.kind}) — selected by ${target.source.replace('-', ' ')}`))
      return 0
    }
    case 'use': {
      const { positionals } = parseCommand(rest, {}, 1)
      if (!positionals[0]) throw new CliError('Usage: alice workspace use ALIAS|ID')
      const target = resolver.select(positionals[0], 'option')
      const agent = ctx.agent
      if (agent) {
        if (target.kind !== 'local') throw new CliError('Agents work in Local workspaces only')
        ctx.config.agentWorkspaces = { ...ctx.config.agentWorkspaces, [agent]: target.workspace.id }
      } else if (target.kind === 'local') {
        ctx.config.activeWorkspace = target.workspace.id
      } else {
        ctx.config.activeProfile = target.profile.name
        ctx.config.activeWorkspace = null
      }
      saveConfig(ctx.config, ctx.configDir)
      const ref = targetRef(target)
      out.useEnvelope(ref)
      out.value({ active: ref, for: agent ?? 'human' }, () => out.line(`Active workspace${agent ? ` for ${agent}` : ''}: ${ref.name} (${ref.alias}, ${ref.kind})`))
      return 0
    }
    case 'create': {
      const { values, positionals } = parseCommand(rest, { alias: { type: 'string' } }, 1)
      const name = positionals[0] ?? (resolver.registry().workspaces.length === 0 ? 'Personal' : 'Workspace')
      const ws = createWorkspace(resolver.root, { name, alias: values.alias, reservedAliases: reserved() })
      out.useEnvelope(describe(ws))
      out.value(ws, () => out.line(`Created Local workspace ${out.bold(ws.name)} (alias ${ws.alias}, id ${ws.id})`))
      return 0
    }
    case 'rename': {
      const { positionals } = parseCommand(rest, {}, 2)
      if (positionals.length < 2) throw new CliError('Usage: alice workspace rename ALIAS|ID NAME')
      const target = resolver.select(positionals[0], 'option')
      if (target.kind !== 'local') throw new CliError('Rename Remote workspaces on their server')
      const ws = renameWorkspace(resolver.root, target.workspace.id, positionals[1])
      out.useEnvelope(describe(ws))
      out.value(ws, () => out.line(`Renamed ${ws.alias} to ${out.bold(ws.name)}`))
      return 0
    }
    case 'alias': {
      const { positionals } = parseCommand(rest, {}, 2)
      if (positionals.length < 2) throw new CliError('Usage: alice workspace alias ALIAS|ID NEW_ALIAS')
      const target = resolver.select(positionals[0], 'option')
      if (target.kind !== 'local') throw new CliError('A Remote workspace alias is its profile name; rename the profile instead')
      if (ctx.config.profiles[positionals[1]]) throw new CliError(`The alias "${positionals[1]}" is already a Remote profile name`)
      const ws = setWorkspaceAlias(resolver.root, target.workspace.id, positionals[1], reserved())
      out.useEnvelope(describe(ws))
      out.value(ws, () => out.line(`Workspace ${ws.name} is now ${out.bold(ws.alias)}`))
      return 0
    }
    case 'bind': {
      const { values, positionals } = parseCommand(rest, { portable: { type: 'boolean' } }, 1)
      if (!positionals[0]) throw new CliError('Usage: alice workspace bind ALIAS|ID [--portable]')
      const target = resolver.select(positionals[0], 'option')
      if (values.portable && target.kind === 'local') {
        throw new CliError('Portable bindings name a shared Remote workspace; bind a Local workspace without --portable', 'usage')
      }
      const value = target.kind === 'local' ? target.workspace.id : target.profile.name
      const file = writeBinding(process.cwd(), values.portable ? PORTABLE_BINDING : LOCAL_BINDING, value)
      out.useEnvelope(targetRef(target))
      out.value({ file, workspace: value, portable: !!values.portable }, () => {
        out.line(`Bound ${path.relative(process.cwd(), file)} → ${targetRef(target).name}`)
        if (!values.portable) out.info(`Keep ${BINDING_DIR}/${LOCAL_BINDING} out of version control (it is specific to this machine).`)
      })
      return 0
    }
    case 'unbind': {
      const { values } = parseCommand(rest, { portable: { type: 'boolean' } })
      const name = values.portable ? PORTABLE_BINDING : LOCAL_BINDING
      const found = findBinding(process.cwd(), name)
      if (!found) throw new CliError(`No ${BINDING_DIR}/${name} binding here or in a parent directory`, 'not_found')
      fs.rmSync(found.file)
      out.value({ removed: found.file }, () => out.line(`Removed ${found.file}`))
      return 0
    }
    case 'status': {
      const { positionals } = parseCommand(rest, {}, 1)
      const target: Target = positionals[0] ? resolver.select(positionals[0], 'option') : ctx.target()
      out.useEnvelope(targetRef(target))
      if (target.kind !== 'local') {
        out.value({ kind: 'remote', server: target.profile.server, signedIn: !!target.profile.session }, () =>
          out.line(`${target.profile.name}: Remote workspace at ${target.profile.server}`),
        )
        return 0
      }
      const probe = await probeDaemon(target.root, target.workspace.id)
      const notice = maintenanceNotice(target.root, ctx.env)
      const result = {
        workspace: target.workspace,
        daemon: probe.ok ? { running: true, pid: probe.locator.pid, version: probe.locator.version, startedAt: probe.locator.startedAt } : { running: false, reason: probe.reason },
        managedUpdates: notice === null,
        notice,
      }
      out.value(result, () => {
        out.details([
          ['Workspace', `${target.workspace.name} (${target.workspace.alias})`],
          ['Id', target.workspace.id],
          ['Daemon', probe.ok ? `running (pid ${probe.locator.pid}, ${probe.locator.version})` : `stopped (${probe.reason})`],
          ['Updates', notice ? 'not managed — Alice Desktop is missing' : 'managed by Alice Desktop'],
        ])
        if (notice) out.warn(notice)
      })
      return 0
    }
    case 'backup': {
      const { positionals } = parseCommand(rest, {}, 1)
      const target: Target = positionals[0] ? resolver.select(positionals[0], 'option') : ctx.target()
      if (target.kind !== 'local') throw new CliError('Back up Remote workspaces on their server (alice-server backup)')
      out.useEnvelope(targetRef(target))
      const session = new LocalSession(target.workspace, target.root, null, ctx.env, out)
      const { backup } = await session.local<{ backup: { name: string; createdAt: string; bytes: number } }>('POST', '/backups', {})
      out.value(backup, () => out.line(`Backed up ${target.workspace.alias} to ${backup.name} (${backup.bytes} bytes)`))
      return 0
    }
    case 'backups': {
      const { positionals } = parseCommand(rest, {}, 1)
      const target: Target = positionals[0] ? resolver.select(positionals[0], 'option') : ctx.target()
      if (target.kind !== 'local') throw new CliError('Remote backups live on their server')
      out.useEnvelope(targetRef(target))
      // อ่านจากโฟลเดอร์โดยตรง: ไม่ต้องสตาร์ท daemon เพื่อดูรายการ
      const backups = listBackupDirs(target.root, target.workspace.id)
      out.list(backups, [
        { header: 'NAME', value: (b) => b.name },
        { header: 'KIND', value: (b) => b.kind },
        { header: 'CREATED', value: (b) => b.createdAt },
        { header: 'SCHEMA', value: (b) => b.schemaVersion },
        { header: 'BYTES', value: (b) => b.bytes },
      ], 'No backups yet.')
      return 0
    }
    case 'restore': {
      const { values, positionals } = parseCommand(rest, { from: { type: 'string' }, latest: { type: 'boolean' }, replace: { type: 'boolean' }, confirm: { type: 'string' }, yes: { type: 'boolean' } }, 1)
      if (!values.replace) {
        // ค่าเริ่มต้น: clone เป็น workspace ใหม่ ไม่แตะของเดิม
        if (!values.from) throw new CliError('Usage: alice workspace restore --from BACKUP_DIR   (or: restore ID --latest|--from DIR --replace --confirm NAME)')
        const result = runServer<{ workspace: LocalWorkspace }>(resolver.root, ctx.env, ['local-restore', '--from', path.resolve(values.from), ...reserved().flatMap((r) => ['--reserved', r])])
        out.useEnvelope(describe(result.workspace))
        out.value({ mode: 'clone', workspace: result.workspace }, () => out.line(`Restored into a new workspace ${out.bold(result.workspace.name)} (alias ${result.workspace.alias}, id ${result.workspace.id})`))
        return 0
      }
      const id = positionals[0]
      if (!id || !looksLikeWorkspaceId(id)) throw new CliError('Replace restore needs the exact workspace id as an argument (wsp_…); an alias or the active workspace is not enough')
      const target = resolver.select(id, 'option')
      if (target.kind !== 'local') throw new CliError('Only Local workspaces can be restored here')
      if (values.confirm !== target.workspace.name) throw new CliError(`Type the workspace name to confirm: --confirm "${target.workspace.name}"`)
      let from = values.from ? path.resolve(values.from) : null
      if (values.latest) from = listBackupDirs(target.root, id).find((b) => b.kind !== 'pre-restore')?.dir ?? null
      if (!from) throw new CliError(`No backup to restore from for ${target.workspace.alias}`, 'not_found')
      await confirm(out, `Replace ${target.workspace.name} (${target.workspace.alias}) with the backup in ${path.basename(from)}? The current data is backed up first.`, !!values.yes)
      out.useEnvelope(targetRef(target))
      await stopDaemon(target.root, target.workspace, ctx.env)
      const result = runServer<{ workspace: LocalWorkspace; safetyBackup: string | null; previous: string | null }>(target.root, ctx.env, ['local-restore', '--from', from, '--replace', id])
      out.value({ mode: 'replace', ...result }, () => {
        out.line(`Replaced ${target.workspace.name} with ${path.basename(from!)}`)
        if (result.safetyBackup) out.info(`The previous data was backed up as ${result.safetyBackup}.`)
      })
      return 0
    }
    case 'delete': {
      const { values, positionals } = parseCommand(rest, { confirm: { type: 'string' }, yes: { type: 'boolean' } }, 1)
      if (!positionals[0]) throw new CliError('Deleting needs the workspace as an argument: alice workspace delete ALIAS|ID --confirm "NAME"')
      const target = resolver.select(positionals[0], 'option')
      if (target.kind !== 'local') throw new CliError('Remove Remote workspaces with: alice profile remove NAME')
      const ws = target.workspace
      if (values.confirm !== ws.name) throw new CliError(`Type the workspace name to confirm: --confirm "${ws.name}"`)
      await confirm(out, `Move ${ws.name} (${ws.alias}) and all its data to the Trash?`, !!values.yes)
      out.useEnvelope(targetRef(target))
      await stopDaemon(target.root, ws, ctx.env)
      const checked = prepareDelete(target.root, ws.id, values.confirm)
      const paths = workspacePaths(target.root, checked.id)
      const release = acquireWorkspaceLock(paths)
      let trashed: ReturnType<typeof moveToTrash>
      try {
        // ย้ายทั้งโฟลเดอร์ขณะถือ lock (lock ติดไปกับโฟลเดอร์): ไม่มีช่วงที่ daemon จะเปิดได้
        fs.rmSync(paths.locator, { force: true })
        trashed = moveToTrash(paths.dir, `Alice workspace ${ws.name} (${ws.alias})`, path.join(target.root, 'deleted'), ctx.env)
      } catch (err) {
        release()
        throw err
      }
      unregisterWorkspace(target.root, ws.id)
      const store = localCredentialStore(target.root, ctx.env)
      for (const holder of ['owner', 'codex', 'claude-code'] as const) store.delete(capabilityAccount(ws.id, holder))
      if (ctx.config.activeWorkspace === ws.id) {
        ctx.config.activeWorkspace = null
        saveConfig(ctx.config, ctx.configDir)
      }
      out.value({ deleted: ws, location: trashed.location, osTrash: trashed.osTrash }, () =>
        out.line(trashed.osTrash ? `Moved ${ws.name} to the Trash (${trashed.location}). Empty the Trash to remove it permanently.` : `Moved ${ws.name} aside to ${trashed.location}.`),
      )
      return 0
    }
    case 'help':
    case '--help':
      out.line(WORKSPACE_HELP)
      return sub === 'help' ? 0 : 2
    default:
      if (sub.startsWith('-')) throw new CliError(`Usage: alice workspace <command> [options] (unexpected ${sub})`, 'usage', 'See: alice workspace help')
      throw new CliError(`Unknown workspace command: ${sub}`, 'usage', 'See: alice workspace help')
  }
}
