import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentDetail, DocumentRelation, DocumentRelationType } from '../../shared/contracts'
import { client } from '../api'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, Dialog, EmptyState, FieldMessage, SelectField, Skeleton, TextField } from '../ui'
import { KNOWLEDGE_STATUS_LABELS } from './DocumentKnowledgeFields'

const TYPE_LABELS: Record<DocumentRelationType, string> = { references: 'References', related: 'Related', supersedes: 'Supersedes' }

export function DocumentRelations({ doc }: { doc: DocumentDetail }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState('')
  const [type, setType] = useState<DocumentRelationType>('references')
  const [confirmation, setConfirmation] = useState<{ id: string; title: string } | null>(null)
  const candidates = useQuery({
    queryKey: ['documents', 'relation-candidates', query],
    enabled: adding,
    queryFn: () => client.documents.list({ q: query || undefined, archived: 'active', limit: 12 }),
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['document-relations', doc.id] })
    void qc.invalidateQueries({ queryKey: ['document', doc.id] })
    void qc.invalidateQueries({ queryKey: ['documents'] })
  }
  const create = useMutation({
    mutationFn: ({ id, relationType, acknowledgeSupersedes }: { id: string; relationType: DocumentRelationType; acknowledgeSupersedes?: boolean }) =>
      client.documents.relate(doc.id, { targetId: id, type: relationType, ...(acknowledgeSupersedes ? { acknowledgeSupersedes: true } : {}) }),
    onSuccess: () => {
      setAdding(false)
      setConfirmation(null)
      setTargetId('')
      refresh()
    },
  })
  const remove = useMutation({ mutationFn: (relation: DocumentRelation) => client.documents.unrelate(doc.id, { targetId: relation.document.id, type: relation.type }), onSuccess: refresh })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const target = candidates.data?.items.find((item) => item.id === targetId)
    if (!target) return
    if (type === 'supersedes') setConfirmation({ id: target.id, title: target.title })
    else create.mutate({ id: target.id, relationType: type })
  }
  return (
    <section className="task-section document-relations" aria-labelledby="document-relations-heading">
      <div className="row spread">
        <h2 id="document-relations-heading" className="task-section-title">Document relationships</h2>
        <Button size="sm" onClick={() => setAdding(true)} disabled={doc.archivedAt !== null}>Add relationship</Button>
      </div>
      <RelationList docId={doc.id} direction="outgoing" onRemove={(relation) => remove.mutate(relation)} removing={remove.isPending} />
      <RelationList docId={doc.id} direction="incoming" />
      {(create.error || remove.error) && <FieldMessage tone="error">{errorText(create.error ?? remove.error)}</FieldMessage>}
      <Dialog open={adding} onOpenChange={setAdding} title="Add document relationship" description="Choose a document and describe how this document connects to it." size="md">
        <form className="resource-form" onSubmit={submit}>
          <TextField label="Find a document" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setTargetId('') }} data-autofocus />
          {candidates.isLoading ? <Skeleton lines={2} /> : candidates.error ? <Banner tone="danger">{errorText(candidates.error)}</Banner> : (
            <SelectField
              label="Target document"
              required
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              options={[
                { value: '', label: 'Choose a document' },
                ...(candidates.data?.items ?? []).filter((item) => item.id !== doc.id).map((item) => ({ value: item.id, label: `${item.title} — ${KNOWLEDGE_STATUS_LABELS[item.status]}` })),
              ]}
            />
          )}
          <SelectField label="Relationship type" value={type} onChange={(event) => setType(event.target.value as DocumentRelationType)} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          <div className="resource-actions">
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!targetId}>Add relationship</Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
        title="Confirm supersedes relationship"
        description={confirmation ? `“${doc.title}” will supersede “${confirmation.title}”. The target document will be marked Superseded.` : undefined}
        actions={<>
          <Button onClick={() => setConfirmation(null)} data-autofocus>Cancel</Button>
          <Button variant="danger" loading={create.isPending} onClick={() => confirmation && create.mutate({ id: confirmation.id, relationType: 'supersedes', acknowledgeSupersedes: true })}>Confirm and mark superseded</Button>
        </>}
      />
    </section>
  )
}

function RelationList({ docId, direction, onRemove, removing = false }: { docId: string; direction: 'outgoing' | 'incoming'; onRemove?: (relation: DocumentRelation) => void; removing?: boolean }) {
  const relations = useInfiniteQuery({
    queryKey: ['document-relations', docId, direction],
    queryFn: ({ pageParam }) => client.documents.relations(docId, { direction, limit: 10, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
  const items = relations.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="document-relation-group">
      <h3>{direction === 'outgoing' ? 'From this document' : 'To this document'}</h3>
      {relations.isLoading ? <Skeleton lines={2} /> : relations.error ? (
        <Banner tone="danger" title="Relationships could not be loaded" action={<Button size="sm" onClick={() => void relations.refetch()}>Try again</Button>}>{errorText(relations.error)}</Banner>
      ) : items.length === 0 ? <EmptyState title={`No ${direction} relationships.`} /> : (
        <ul className="document-relation-list">
          {items.map((relation) => (
            <li key={`${relation.type}-${relation.document.id}`}>
              <span><Badge>{TYPE_LABELS[relation.type]}</Badge> <Link to={`/documents/${relation.document.id}`}>{relation.document.title}</Link> <span className="ui-text-muted">({KNOWLEDGE_STATUS_LABELS[relation.document.status]})</span></span>
              {onRemove && <Button size="sm" variant="ghost" disabled={removing} aria-label={`Remove ${TYPE_LABELS[relation.type].toLowerCase()} relationship with ${relation.document.title}`} onClick={() => onRemove(relation)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {relations.hasNextPage && <Button size="sm" loading={relations.isFetchingNextPage} onClick={() => void relations.fetchNextPage()}>More {direction} relationships</Button>}
    </div>
  )
}
