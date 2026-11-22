import { useAuth } from '../auth'
import { useShellWorkspace } from '../shell/workspace'
import type { DocumentKnowledgeStatus } from '../../shared/contracts'

/** What a person has typed into a document's Create or Edit page and not saved yet. */
export interface DocumentDraft {
  title: string
  body: string
  sourceUrl: string
  tags: string[]
  searchKeywords: string[]
  status: DocumentKnowledgeStatus
  ownerId: string | null
  /** Revision the edit started from (Edit only). */
  baseRevision?: number
}

// เก็บใน RAM เท่านั้น (ไม่ลง localStorage หรือ server) และอยู่นอก React tree จึงไม่หายเมื่อ shell/Desktop
// ถูก mount ใหม่ คีย์รวม workspace/server และผู้ใช้ เพื่อไม่ให้ draft ไปโผล่ในบัญชีหรือ workspace อื่น
const drafts = new Map<string, DocumentDraft>()

/** Identifies the workspace (Local alias or Remote server) and the signed-in actor. */
export function useDraftScope(): string | null {
  const ws = useShellWorkspace()
  const { actor } = useAuth()
  if (!actor) return null
  return [ws.kind, ws.detail ?? ws.name, actor.id].join('|')
}

/** `new:` plus the link target for Create, `doc:<id>` for Edit. */
export function draftKey(scope: string, target: string): string {
  return `${scope}::${target}`
}

export function readDraft(key: string): DocumentDraft | undefined {
  return drafts.get(key)
}

export function writeDraft(key: string, draft: DocumentDraft): void {
  drafts.set(key, draft)
}

export function clearDraft(key: string): void {
  drafts.delete(key)
}
