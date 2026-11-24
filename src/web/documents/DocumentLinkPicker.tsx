import { useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { Editor } from '@tiptap/core'
import { client } from '../api'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, EmptyState, SelectField, Skeleton, TextField } from '../ui'

export function DocumentLinkPicker({ editor, onClose }: {
  editor: Editor
  onClose: () => void
}) {
  const selection = useRef({ from: editor.state.selection.from, to: editor.state.selection.to })
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState('')
  const results = useInfiniteQuery({
    queryKey: ['documents', 'link-picker', q], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.documents.list({ q: q || undefined, archived: 'active', limit: 20, cursor: pageParam }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const documents = results.data?.pages.flatMap((p) => p.items) ?? []
  const search = () => {
    setQ(draft.trim())
    setSelected('')
  }
  const insert = () => {
    const doc = documents.find((d) => d.id === selected)
    if (!doc) return
    const href = `/documents/${doc.id}`
    const chain = editor.chain().focus().setTextSelection(selection.current)
    if (selection.current.from === selection.current.to) chain.insertContent({ type: 'text', text: doc.title, marks: [{ type: 'link', attrs: { href } }] }).command(({ tr }) => {
      tr.setStoredMarks([])
      return true
    }).run()
    else chain.extendMarkRange('link').setLink({ href }).run()
    onClose()
  }
  return <section aria-label="Choose document link">
    <TextField label="Find document to link" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        search()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        editor.commands.focus()
      }
    }} />
    <Button size="sm" onClick={search}>Search link targets</Button>
    {results.isLoading ? <Skeleton lines={2} /> : results.error ? <Banner tone="danger" title="Link targets could not be loaded" action={<Button onClick={() => void results.refetch()}>Retry link targets</Button>}>{errorText(results.error)}</Banner> : <>
      {!documents.length ? <EmptyState title="No matching link targets">Try different words. You can still enter a link address.</EmptyState> : <SelectField label="Document to link" value={selected} onChange={(e) => setSelected(e.target.value)} options={[{ value: '', label: 'Choose a document' }, ...documents.map((d) => ({ value: d.id, label: `${d.title} · ${d.status}` }))]} />}
      {results.hasNextPage && <Button size="sm" loading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>More link targets</Button>}
      <Button size="sm" disabled={!selected} onClick={insert}>Insert document link</Button>
    </>}
  </section>
}
