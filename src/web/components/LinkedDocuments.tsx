import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentSummary, Page } from '../../shared/contracts'
import { client } from '../api'
import { NewDocumentForm } from '../pages/DocumentsPage'
import { ErrorMessage } from './ui'
import { Button, TextField } from '../ui'

type Target = { taskId: string } | { projectId: string }

export function LinkedDocuments({ target, title = 'Documents' }: { target: Target; title?: string }) {
  const qc = useQueryClient()
  const key = 'taskId' in target ? target.taskId : target.projectId
  const linked = useQuery({ queryKey: ['documents', 'linked', key], queryFn: () => client.documents.list({ ...target, limit: 100 }) })
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<'none' | 'existing' | 'new'>('none')
  const candidates = useQuery({
    queryKey: ['documents', 'candidates', search],
    enabled: adding === 'existing',
    queryFn: () => client.documents.list({ q: search, limit: 8 }),
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['documents'] })
    void qc.invalidateQueries({ queryKey: ['task'] })
  }
  const link = useMutation({ mutationFn: (id: string) => client.documents.link(id, target), onSuccess: refresh })
  const unlink = useMutation({ mutationFn: (id: string) => client.documents.unlink(id, target), onSuccess: refresh })
  const items = linked.data?.items ?? []
  const linkedIds = new Set(items.map((d) => d.id))
  const headingId = `linked-docs-${key}`
  return (
    <section className="linked-docs" aria-labelledby={headingId}>
      <h2 id={headingId} className="task-section-title">
        {title}
      </h2>
      {items.length === 0 && <p className="ui-text-muted">No linked documents.</p>}
      <ul className="plain-list">
        {items.map((d) => (
          <li key={d.id} className="row spread">
            <Link to={`/documents/${d.id}`}>{d.title}</Link>
            <Button size="sm" variant="ghost" aria-label={`Unlink ${d.title}`} onClick={() => unlink.mutate(d.id)}>
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      <div className="row">
        <Button size="sm" onClick={() => setAdding(adding === 'existing' ? 'none' : 'existing')} aria-expanded={adding === 'existing'}>
          Link existing
        </Button>
        <Button size="sm" onClick={() => setAdding(adding === 'new' ? 'none' : 'new')} aria-expanded={adding === 'new'}>
          New document
        </Button>
      </div>
      {adding === 'existing' && (
        <div className="stack">
          <TextField label="Find a document" type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <ul className="plain-list">
            {candidates.data?.items
              .filter((d) => !linkedIds.has(d.id))
              .map((d) => (
                <li key={d.id} className="row spread">
                  <span>{d.title}</span>
                  <Button size="sm" aria-label={`Link ${d.title}`} onClick={() => link.mutate(d.id)}>
                    Link
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {adding === 'new' && <NewDocumentForm link={target} onCancel={() => setAdding('none')} />}
      <ErrorMessage error={link.error ?? unlink.error} />
    </section>
  )
}
