import { DOCUMENT_KNOWLEDGE_STATUSES } from '../../shared/contracts'
import { useActors } from '../hooks'
import { useProjects } from '../pages/ProjectsPage'
import { Button, SelectField, TextField } from '../ui'
import { KNOWLEDGE_STATUS_LABELS } from './DocumentKnowledgeFields'

export type DocumentFilterKey = 'tag' | 'status' | 'ownerId' | 'projectId'

export function DocumentFilters({ values, onChange, onClear }: { values: Partial<Record<DocumentFilterKey, string>>; onChange: (key: DocumentFilterKey, value: string) => void; onClear: () => void }) {
  const actors = useActors()
  const projects = useProjects('all')
  return (
    <div className="document-filter-grid">
      <TextField label="Tag" placeholder="e.g. operations" value={values.tag ?? ''} onChange={(event) => onChange('tag', event.target.value)} />
      <SelectField
        label="Knowledge status"
        value={values.status ?? ''}
        onChange={(event) => onChange('status', event.target.value)}
        options={[{ value: '', label: 'Any status' }, ...DOCUMENT_KNOWLEDGE_STATUSES.map((status) => ({ value: status, label: KNOWLEDGE_STATUS_LABELS[status] }))]}
      />
      <SelectField
        label="Knowledge owner"
        value={values.ownerId ?? ''}
        onChange={(event) => onChange('ownerId', event.target.value)}
        options={[
          { value: '', label: 'Any owner' },
          { value: 'none', label: 'Unassigned' },
          ...(actors.data ?? []).map((actor) => ({ value: actor.id, label: actor.kind === 'agent' ? `${actor.displayName} (agent)` : actor.displayName })),
        ]}
      />
      <SelectField
        label="Linked project"
        value={values.projectId ?? ''}
        onChange={(event) => onChange('projectId', event.target.value)}
        options={[{ value: '', label: 'Any project' }, ...(projects.data?.items ?? []).map((project) => ({ value: project.id, label: project.name }))]}
      />
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear document filters
      </Button>
    </div>
  )
}
