import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProjectFilesError, readProjectFiles } from '../../src/cli/project-files'
import { testDir } from '../helpers/tmp'

function board(files: Record<string, string>): string {
  const dir = testDir('alice-project-files-')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  return dir
}

describe('project files front matter', () => {
  it('reads the YAML subset agents write: quotes, comments, inline and block lists', () => {
    const dir = board({
      'tasks/T-2-b.md': '---\nid: T-2\ntitle: "Fix #12: login" # issue link\nlabels:\n  - ui\n  - "plan:auth"\nblocked_by: [T-1]  # waits\nassignee: none\nparent: ~\n---\nBody\n',
      'tasks/T-1-a.md': "---\nid: T-1\ntitle: 'It''s first'\nstatus: done\n---\n",
    })
    const files = readProjectFiles(dir)
    expect(files.tasks.map((t) => [t.id, t.title])).toEqual([['T-1', "It's first"], ['T-2', 'Fix #12: login']])
    expect(files.tasks[1]).toMatchObject({ title: 'Fix #12: login', labels: ['ui', 'plan:auth'], blockedBy: ['T-1'], assignee: null, parent: null, description: 'Body' })
  })

  it('creates parents before their children whatever the file order', () => {
    const dir = board({
      'tasks/T-1-child.md': '---\nid: T-1\ntitle: Child\nparent: T-3\n---\n',
      'tasks/T-2-grandchild.md': '---\nid: T-2\ntitle: Grandchild\nparent: T-1\n---\n',
      'tasks/T-3-root.md': '---\nid: T-3\ntitle: Root\n---\n',
    })
    expect(readProjectFiles(dir).tasks.map((t) => t.id)).toEqual(['T-3', 'T-1', 'T-2'])
  })

  it('keeps the Activity section out of the description, even when other sections follow it', () => {
    const dir = board({ 'tasks/T-1-a.md': '---\nid: T-1\ntitle: A\n---\n## Outcome\nDone.\n\n## Activity\n- one\n- two\n\n## Notes\nKeep.\n' })
    expect(readProjectFiles(dir).tasks[0]).toMatchObject({ description: '## Outcome\nDone.\n\n## Notes\nKeep.', activity: ['one', 'two'] })
  })

  it('reports a parent loop instead of looping', () => {
    const dir = board({ 'tasks/T-1-a.md': '---\nid: T-1\ntitle: A\nparent: T-2\n---\n', 'tasks/T-2-b.md': '---\nid: T-2\ntitle: B\nparent: T-1\n---\n' })
    expect(() => readProjectFiles(dir)).toThrow(ProjectFilesError)
    expect(() => readProjectFiles(dir)).toThrow(/parent chain loops/)
  })
})
