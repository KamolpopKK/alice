import type { DocumentKnowledgeStatus } from '../../shared/contracts'
import { useActors } from '../hooks'
import { SelectField } from '../ui'
import { AssigneeSelect } from './TaskFields'
import { LabelsInput } from './LabelsInput'

export const KNOWLEDGE_STATUS_LABELS: Record<DocumentKnowledgeStatus, string> = {
  unreviewed: 'Unreviewed',
  draft: 'Draft',
  current: 'Current',
  superseded: 'Superseded',
}

export type EditableDocumentStatus = Exclude<DocumentKnowledgeStatus, 'current'>

export function DocumentKnowledgeFields({
  tags,
  onTagsChange,
  searchKeywords,
  onSearchKeywordsChange,
  status,
  onStatusChange,
  ownerId,
  onOwnerChange,
}: {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  searchKeywords: string[]
  onSearchKeywordsChange: (keywords: string[]) => void
  status: DocumentKnowledgeStatus
  onStatusChange: (status: EditableDocumentStatus) => void
  ownerId: string | null
  onOwnerChange: (ownerId: string | null) => void
}) {
  const actors = useActors()
  return (
    <div className="document-knowledge-fields">
      <LabelsInput label="Tags" value={tags} onChange={onTagsChange} />
      <LabelsInput label="Search keywords" value={searchKeywords} onChange={onSearchKeywordsChange} />
      <SelectField
        label="Knowledge status"
        hint={status === 'current' ? 'Current is set by reviewing a specific revision. Choose another status only to move it out of current.' : undefined}
        value={status}
        onChange={(event) => onStatusChange(event.target.value as EditableDocumentStatus)}
        options={[
          { value: 'unreviewed', label: KNOWLEDGE_STATUS_LABELS.unreviewed },
          { value: 'draft', label: KNOWLEDGE_STATUS_LABELS.draft },
          ...(status === 'current' ? [{ value: 'current', label: 'Current (reviewed)', disabled: true }] : []),
          { value: 'superseded', label: KNOWLEDGE_STATUS_LABELS.superseded },
        ]}
      />
      <AssigneeSelect label="Knowledge owner" value={ownerId} actors={actors.data ?? []} onChange={onOwnerChange} />
    </div>
  )
}
