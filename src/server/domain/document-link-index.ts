import { setImmediate } from 'node:timers/promises'
import type { FastifyBaseLogger } from 'fastify'
import { DOCUMENT_LINK_PARSER_VERSION, parseDocumentMarkdown } from '../../shared/document-links'
import type { DB } from '../db/database'

type Source = {
  id: string
  body: string
  revision: number
}
function fault(stage: string, id?: string) {
  if (process.env.NODE_ENV === 'test' && process.env.ALICE_TEST_LINK_INDEX_FAILURE === stage && (!process.env.ALICE_TEST_LINK_INDEX_DOCUMENT || process.env.ALICE_TEST_LINK_INDEX_DOCUMENT === id)) throw new Error(`Injected document link ${stage} failure`)
}
function targets(source: Source) {
  fault('parser', source.id)
  return parseDocumentMarkdown(source.body, source.id).targets
}
function writeProjection(db: DB, source: Source, links: string[]) {
  db.prepare('DELETE FROM document_inline_links WHERE source_document_id = ?').run(source.id)
  const insert = db.prepare('INSERT INTO document_inline_links (source_document_id, target_document_id) VALUES (?, ?)')
  for (const target of links) insert.run(source.id, target)
  fault('index', source.id)
  writeState(db, source)
}
function writeState(db: DB, source: Source) {
  db.prepare(`INSERT INTO document_link_index_state (source_document_id, content_revision, parser_version) VALUES (?, ?, ?)
    ON CONFLICT(source_document_id) DO UPDATE SET content_revision = excluded.content_revision, parser_version = excluded.parser_version`).run(source.id, source.revision, DOCUMENT_LINK_PARSER_VERSION)
}

/** Caller owns the source/history/activity transaction. Title/source URL edits only advance state. */
export function indexDocumentLinks(db: DB, source: Source, bodyChanged = true) {
  const state = db.prepare('SELECT parser_version FROM document_link_index_state WHERE source_document_id = ?').get(source.id) as { parser_version: number } | undefined
  if (!bodyChanged && state?.parser_version === DOCUMENT_LINK_PARSER_VERSION) writeState(db, source)
  else writeProjection(db, source, targets(source))
}
const PENDING = `FROM documents d LEFT JOIN document_link_index_state s ON s.source_document_id = d.id
  WHERE s.source_document_id IS NULL OR s.content_revision <> d.revision OR s.parser_version <> ?`
export function documentLinksReady(db: DB): boolean {
  return !db.prepare(`SELECT 1 ${PENDING} LIMIT 1`).get(DOCUMENT_LINK_PARSER_VERSION)
}

/** Resumable batches; no listener/readiness is exposed until every current body is prepared. */
export async function prepareDocumentLinks(db: DB, log?: FastifyBaseLogger): Promise<void> {
  let completed = 0
  let batches = 0
  log?.info({ parserVersion: DOCUMENT_LINK_PARSER_VERSION }, 'alice.knowledge.preparing')
  try {
    for (; ;) {
      const rows = db.prepare(`SELECT d.id, d.body, d.revision ${PENDING} ORDER BY d.id LIMIT 100`).all(DOCUMENT_LINK_PARSER_VERSION) as Source[]
      if (!rows.length) break
      const parsed = rows.map((source) => ({ source, links: targets(source) }))
      db.transaction(() => {
        for (const { source, links } of parsed) {
          const current = db.prepare('SELECT revision FROM documents WHERE id = ?').get(source.id) as { revision: number } | undefined
          if (current?.revision !== source.revision) continue
          writeProjection(db, source, links)
          completed++
        }
      }).immediate()
      batches++
      log?.info({ completed, batches, parserVersion: DOCUMENT_LINK_PARSER_VERSION }, 'alice.knowledge.prepared_batch')
      if (process.env.NODE_ENV === 'test' && Number(process.env.ALICE_TEST_LINK_PREP_FAIL_AFTER_BATCHES) === batches) throw new Error('Injected document link preparation interruption')
      await setImmediate()
    }
    log?.info({ completed, batches, parserVersion: DOCUMENT_LINK_PARSER_VERSION, pending: 0 }, 'alice.knowledge.ready')
  } catch (error) {
    log?.error({ completed, batches, parserVersion: DOCUMENT_LINK_PARSER_VERSION }, 'alice.knowledge.preparation_failed')
    throw error
  }
}
