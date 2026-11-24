import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { client } from '../api'
import { useCapability } from '../hooks'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, Dialog, IconButton, Skeleton } from '../ui'

/** The same bounded preview is used by content links, backlinks and curated discovery. */
export function DocumentPreview({ documentId, href, label }: {
  documentId: string
  href: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const supported = useCapability('project-knowledge')
  const preview = useQuery({
    queryKey: ['document-preview', documentId], enabled: supported && open,
    queryFn: () => client.documents.preview(documentId), staleTime: 0,
  })
  if (!supported) return null
  // Never substitute previously cached body text while refreshing or after an error.
  const data = !preview.isFetching && !preview.error ? preview.data : undefined
  return <Dialog open={open} onOpenChange={setOpen} title="Document preview" description="A bounded view of the original document. Curation is separate from review." size="lg"
    trigger={<IconButton icon={Eye} size="sm" label={`Preview ${label}`} />}
    actions={<><Button onClick={() => setOpen(false)} data-autofocus>Close preview</Button><Link className="ui-button ui-button--primary ui-button--md" to={href} onClick={() => setOpen(false)}>Open document</Link></>}>
    {preview.isPending || preview.isFetching ? <div role="status"><p>Loading current document preview…</p><Skeleton lines={3} /></div> : preview.error ? <Banner tone="danger" title="Preview could not be loaded" action={<Button onClick={() => void preview.refetch()}>Retry preview</Button>}>{errorText(preview.error)} Open the document or retry to check its actual state.</Banner> : data && <>
      {data.state === 'unavailable' ? <Banner tone="warning" title="Document unavailable">This reference cannot be resolved in the active workspace. No content is shown.</Banner> : <>
        <h3>{data.document!.title}</h3>
        <p><Badge>{data.document!.status}</Badge> · Revision {data.document!.revision}</p>
        <p>Reviewed revision: {data.document!.reviewedRevision ?? 'Not reviewed'}{data.document!.reviewedAt ? ` · ${data.document!.reviewedAt}` : ''}{data.document!.reviewedBy ? ` by ${data.document!.reviewedBy.displayName}` : ''}</p>
        {data.document!.status === 'unreviewed' && <Banner tone="warning">This document is unreviewed. Check the source before treating it as authoritative.</Banner>}
        {data.document!.status === 'draft' && <Banner tone="warning">This is a draft.</Banner>}
        {data.document!.status === 'superseded' && <Banner tone="danger">This document is superseded. Open its relationships to find a newer source.</Banner>}
        {data.state === 'archived' ? <Banner tone="warning" title="Document archived">This reference is retained. Archived content is not included in previews.</Banner> : <>
          <pre className="document-preview-text" aria-label="Document content preview">{data.body}</pre>
          <p>{data.bodyWindow?.returnedChars ?? 0} of {data.bodyWindow?.totalChars ?? 0} characters{data.bodyWindow?.truncated ? ' · Open the document to read more.' : ''}</p>
        </>}
      </>}
    </>}
  </Dialog>
}
