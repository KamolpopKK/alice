import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { alice, buildCli, cliHome } from '../helpers/cli'

const ROOT = path.resolve(import.meta.dirname, '../..')

/** Every `alice …` command shown in user documentation must be one the CLI recognises. */
function documentedCommands(file: string): string[][] {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
  return blocks
    .flatMap((b) => b.split('\n'))
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l.startsWith('alice '))
    .map((l) => l.split(/\s+/).slice(1))
}

describe('documentation examples', () => {
  for (const doc of ['docs/cli.md', 'README.md', 'docs/agents.md']) {
    it(`${doc}: every alice command and subcommand exists`, async () => {
      await buildCli()
      const commands = documentedCommands(doc)
      if (doc === 'docs/cli.md') expect(commands.length).toBeGreaterThan(20)
      const home = cliHome('docs')
      for (const argv of commands) {
        const words: string[] = []
        for (let i = 0; i < argv.length; i++) {
          if (argv[i] === '--profile' || argv[i] === '--server') i++
          else if (!argv[i].startsWith('-')) words.push(argv[i])
        }
        const [group, sub] = words
        const probe = sub && !/^(tsk|prj|doc)_|…|"/.test(sub) && ['profile', 'auth', 'project', 'task', 'doc', 'document', 'workspace', 'integration'].includes(group) ? [group, sub, '--help-check'] : [group, '--help-check']
        const res = await alice(home, probe)
        // คำสั่งที่รู้จักจะล้มเพราะ flag ทดสอบ ไม่ใช่เพราะ "Unknown … command"
        expect(res.stderr, `alice ${argv.join(' ')}`).not.toMatch(/Unknown (\w+ )?command/)
      }
    })
  }
})
