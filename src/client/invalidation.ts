import type { ClientEvent } from '../shared/contracts'

/** Collection views to refetch when a resource of a kind changes (query-key prefixes). */
const LIST_KEYS: Record<string, string[][]> = {
  // task ที่อยู่ใน Pad แสดงข้อมูลจริงของ task จึงต้อง refetch block ด้วย
  task: [['tasks'], ['board'], ['pad-blocks'], ['pad-search'], ['pad-task-search']],
  project: [['projects'], ['board'], ['knowledge-topics'], ['knowledge-members'], ['document-topics']],
  document: [['documents'], ['knowledge-members'], ['document-topics'], ['document-backlinks'], ['document-relations']],
  comment: [['tasks']],
  actor: [['actors'], ['agents'], ['invites']],
  invite: [['invites']],
  client_session: [['client-sessions']],
  pad: [['pads'], ['pad-search']],
  pad_block: [['pad-search']],
  saved_view: [['saved-views']],
  approval: [['approvals']],
}

/**
 * Query keys affected by one invalidation. Events identify what changed; clients always refetch
 * canonical state rather than applying event data.
 */
export function invalidationKeys(event: Pick<ClientEvent, 'kind' | 'id'>): unknown[][] {
  // Pad เป็นข้อมูลส่วนตัว: ไม่กระทบ activity หรือ workspace search
  if (event.kind === 'pad') return [['pad', event.id], ['pad-blocks', event.id], ...LIST_KEYS.pad]
  if (event.kind === 'pad_block') return [[event.kind, event.id], ...LIST_KEYS.pad_block]
  // saved view เป็นของคนคนเดียว: ไม่กระทบ activity หรือ search
  if (event.kind === 'saved_view') return LIST_KEYS.saved_view
  return [['activity'], ['search'], [event.kind, event.id], ...(LIST_KEYS[event.kind] ?? [])]
}
