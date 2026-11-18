import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderClosed, Plus } from 'lucide-react'
import { client } from '../api'
import { IllustratedState } from '../brand'
import { LabelsInput, Labels } from '../components/LabelsInput'
import { MarkdownEditor } from '../components/Markdown'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, Dialog, EmptyState, FieldMessage, ResourceItem, ResourceList, SegmentedControl, Skeleton, TextField } from '../ui'

export function useProjects(archived: 'active' | 'archived' | 'all' = 'active') {
  return useQuery({ queryKey: ['projects', archived], queryFn: () => client.projects.list(archived).then((items) => ({ items })) })
}

/** Projects: active projects as summary cards, archived ones one switch away. */
export function ProjectsPage() {
  const [show, setShow] = useState<'active' | 'archived'>('active')
  const projects = useProjects(show)
  const location = useLocation()
  const [creating, setCreating] = useState(() => (location.state as { create?: boolean } | null)?.create === true)
  const items = projects.data?.items ?? []
  return (
    <div className="page resource-page">
      <div className="resource-head">
        <h1>Projects</h1>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          New project
        </Button>
      </div>
      <SegmentedControl
        label="Show projects"
        value={show}
        onValueChange={(v) => setShow(v as 'active' | 'archived')}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      <CreateProject open={creating} onClose={() => setCreating(false)} />
      {projects.isLoading ? (
        <Skeleton lines={4} />
      ) : projects.error ? (
        <Banner tone="danger" title="Projects could not be loaded" action={<Button size="sm" onClick={() => void projects.refetch()}>Try again</Button>}>
          {errorText(projects.error)}
        </Banner>
      ) : (
        <>
          {/* ยังไม่มี project ของทีม (มีแค่ Untitled ของระบบ) → Alice ชวนเริ่ม; ปุ่ม New project ยังเป็น action หลัก */}
          {show === 'active' && items.every((p) => p.isSystem) && <IllustratedState pose="curious" copy="projectsEmpty" title="Your projects will appear here" />}
          {items.length === 0 ? (
            <EmptyState title={show === 'archived' ? 'No archived projects' : 'No projects yet'} />
          ) : (
            <ResourceList label={show === 'archived' ? 'Archived projects' : 'Active projects'}>
              {items.map((p) => (
                <ResourceItem
                  key={p.id}
                  icon={FolderClosed}
                  title={<Link to={`/projects/${p.id}`}>{p.name}</Link>}
                  text={p.description ? p.description.replace(/[#*_`>-]/g, '').slice(0, 160) : 'No description.'}
                  meta={
                    <>
                      {p.isSystem && <Badge>Default for new tasks</Badge>}
                      {p.archivedAt && <Badge>archived</Badge>}
                      <Labels labels={p.labels} />
                    </>
                  }
                />
              ))}
            </ResourceList>
          )}
        </>
      )}
    </div>
  )
}

function CreateProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const create = useMutation({
    mutationFn: () => client.projects.create({ name, description, labels }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      onClose()
      navigate(`/projects/${res.project.id}`)
    },
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="New project" size="lg">
      <form
        className="resource-form"
        aria-label="New project"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} data-autofocus />
        <MarkdownEditor id="new-project-description" label="Description (Markdown)" value={description} onChange={setDescription} rows={5} />
        <LabelsInput value={labels} onChange={setLabels} />
        {create.error && <FieldMessage tone="error">{errorText(create.error)}</FieldMessage>}
        <div className="resource-actions">
          <Button variant="primary" type="submit" loading={create.isPending}>
            Create project
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}
