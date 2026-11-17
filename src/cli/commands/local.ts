// `alice local …`: คำสั่งภายในที่ Alice Desktop เรียกผ่าน runtime (ไม่อยู่ใน help ของผู้ใช้)
// connect ส่ง capability กลับทาง stdout ของ pipe ที่ Desktop ถือ — ไม่ผ่าน argv, ไฟล์ หรือ log
import { capabilityAccount, localCredentialStore } from '../../local/capabilities'
import { ensureDaemon } from '../../local/daemon-client'
import { ensureDefaultWorkspace, findWorkspace, readRegistry } from '../../local/registry'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { runtimeServerCommand } from '../local-session'
import { readRecoveryRecord } from '../../local/recovery'
import { activateRuntime, installRuntime } from '../../local/activation'
import { installLauncher } from '../../local/runtime-install'
import { refreshSkills } from './integration'
import path from 'node:path'

export async function localCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  const root = ctx.resolver.root
  switch (sub) {
    case 'connect': {
      // --workspace เป็น global option ของ CLI จึงรับ id เป็น positional หรือจาก --workspace ก็ได้
      const { positionals } = parseCommand(rest, {}, 1)
      const selector = positionals[0] ?? ctx.flags.workspace
      if (!selector) throw new CliError('Usage: alice local connect WORKSPACE_ID --json')
      const ws = findWorkspace(readRegistry(root), selector)
      ctx.out.useEnvelope({ id: ws.id, name: ws.name, alias: ws.alias, kind: 'local' })
      let endpoint
      try {
        endpoint = await ensureDaemon(root, ws, { env: ctx.env, command: runtimeServerCommand(ctx.env) })
      } catch (err) {
        // daemon เขียน recovery.json เมื่อหยุดเพราะ integrity/migration: ส่งสถานะนั้นให้ Desktop แสดงหน้ากู้คืน
        const recovery = readRecoveryRecord(root, ws.id)
        if (recovery) throw Object.assign(new CliError(`${recovery.state}: ${recovery.message}`, 'internal'), { code: recovery.state === 'integrity' ? 'WORKSPACE_DAMAGED' : 'MIGRATION_FAILED' })
        throw err
      }
      const capability = localCredentialStore(root, ctx.env).get(capabilityAccount(ws.id, 'owner'))
      if (!capability) throw new CliError('The Local owner capability is missing from the credential store', 'auth', 'Run: alice doctor')
      ctx.out.value({ baseUrl: endpoint.baseUrl, generation: endpoint.locator.generation, version: endpoint.locator.version, pid: endpoint.locator.pid, capability }, () => {
        throw new CliError('alice local connect is for Alice Desktop; use --json')
      })
      return 0
    }
    case 'first-run': {
      parseCommand(rest, {})
      const { workspace, created } = ensureDefaultWorkspace(root)
      ctx.out.useEnvelope({ id: workspace.id, name: workspace.name, alias: workspace.alias, kind: 'local' })
      ctx.out.value({ workspace, created }, () => ctx.out.line(`${created ? 'Created' : 'Using'} ${workspace.name}`))
      return 0
    }
    case 'install-runtime': {
      // Desktop เรียกด้วย runtime ที่มากับแอป: คัดลอกแบบตรวจ checksum แล้วสลับเป็น current อย่างปลอดภัย
      const { values } = parseCommand(rest, { from: { type: 'string' }, node: { type: 'string' }, 'no-activate': { type: 'boolean' } })
      if (!values.from) throw new CliError('--from RUNTIME_DIR is required')
      ctx.out.useEnvelope(null)
      const manifest = installRuntime(root, path.resolve(values.from), values.node ? path.resolve(values.node) : undefined)
      const result = values['no-activate'] ? { status: 'installed', to: manifest.version } : await activateRuntime(root, manifest.version, { env: ctx.env })
      // อัปเดตสำเร็จ: skill ของ agent ที่เลือกไว้ต้องตรงกับรุ่นใหม่ (ไม่แตะ agent ที่ปิดอยู่)
      if (result.status === 'activated') refreshSkills(root)
      ctx.out.value(result, () => ctx.out.line(`Runtime ${manifest.version}: ${result.status}`))
      return result.status === 'rolled-back' ? 1 : 0
    }
    case 'activate': {
      const { positionals } = parseCommand(rest, {}, 1)
      if (!positionals[0]) throw new CliError('Usage: alice local activate VERSION')
      ctx.out.useEnvelope(null)
      const result = await activateRuntime(root, positionals[0], { env: ctx.env })
      ctx.out.value(result, () => ctx.out.line(`Runtime ${positionals[0]}: ${result.status}`))
      return result.status === 'rolled-back' ? 1 : 0
    }
    case 'install-launcher': {
      parseCommand(rest, {})
      ctx.out.useEnvelope(null)
      const file = installLauncher(root, ctx.env)
      ctx.out.value({ launcher: file }, () => ctx.out.line(`Installed the alice launcher at ${file}`))
      return 0
    }
    default:
      throw new CliError(`Unknown local command: ${sub ?? ''}`, 'usage')
  }
}
