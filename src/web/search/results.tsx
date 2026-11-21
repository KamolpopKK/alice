import { FileText, MessageSquare, SquareCheck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { SearchResult } from '../../shared/contracts'
import { Highlight } from '../components/Highlight'
import { ActorBadge } from '../components/ui'
import { KNOWLEDGE_STATUS_LABELS } from '../components/DocumentKnowledgeFields'
import { Badge, ResourceItem } from '../ui'

/** One vocabulary for quick search (command palette) and full Search. */
export const SEARCH_KIND: Record<SearchResult['kind'], { label: string; plural: string; icon: LucideIcon }> = {
  task: { label: 'Task', plural: 'Tasks', icon: SquareCheck },
  document: { label: 'Document', plural: 'Documents', icon: FileText },
  comment: { label: 'Comment', plural: 'Comments', icon: MessageSquare },
}

/** Where a result opens: the task, the document, or the comment inside its task. */
export function searchResultLink(r: Pick<SearchResult, 'kind' | 'id'> & { taskId?: string | null }): string {
  if (r.kind === 'document') return `/documents/${r.id}`
  if (r.kind === 'comment') return `/tasks/${r.taskId}#comment-${r.id}`
  return `/tasks/${r.id}`
}

export function SearchResultItem({ result }: { result: SearchResult }) {
  const kind = SEARCH_KIND[result.kind]
  const text = result.kind === 'document' ? result.match.excerpt : result.snippet
  return (
    <ResourceItem
      icon={kind.icon}
      title={<Link to={searchResultLink(result)}>{result.title}</Link>}
      text={text ? <Highlight text={text} /> : undefined}
      meta={
        <>
          <Badge>{kind.label}</Badge>
          {result.archived && <Badge>archived</Badge>}
          {result.kind === 'document' && (
            <>
              <Badge>{KNOWLEDGE_STATUS_LABELS[result.status]}</Badge>
              <span>Matched {result.match.field}{result.match.value ? `: ${result.match.value}` : ''}</span>
              <span>Owner: {result.owner ? <ActorBadge actor={result.owner} /> : 'Unassigned'}</span>
              {result.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
              {result.projectContext.items.map((project) => <span key={project.id}>{project.name}</span>)}
              {result.projectContext.total > result.projectContext.items.length && <span>+{result.projectContext.total - result.projectContext.items.length} more projects</span>}
              {result.status === 'unreviewed' && <span>Unreviewed — verify before use</span>}
              {result.status === 'superseded' && <span>Superseded — check for a newer document</span>}
            </>
          )}
        </>
      }
    />
  )
}
