import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project } from '../../shared/contracts'
import { client } from '../api'
import { LabelsInput, Labels } from '../components/LabelsInput'
import { MarkdownEditor } from '../components/Markdown'
import { ErrorMessage, Loading, TextInput, Empty } from '../components/ui'
import { IllustratedState } from '../brand'

export function useProjects(archived: 'active' | 'archived' | 'all' = 'active') {
  return useQuery({ queryKey: ['projects', archived], queryFn: () => client.projects.list(archived).then((items) => ({ items })) })
}

export function ProjectsPage() {
  const [showArchived, setShowArchived] = useState(false)
  const projects = useProjects(showArchived ? 'archived' : 'active')
  const location = useLocation()
  const [creating, setCreating] = useState(() => (location.state as { create?: boolean } | null)?.create === true)
  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <div className="row">
          <button type="button" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
            {showArchived ? 'Show active' : 'Show archived'}
          </button>
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            New project
          </button>
        </div>
      </div>
      {creating && <CreateProject onClose={() => setCreating(false)} />}
      {/* ยังไม่มี project ของทีม (มีแค่ Untitled ของระบบ) → Alice ชวนเริ่ม; ปุ่ม New project ด้านบนยังเป็น action หลัก */}
      {!showArchived && !creating && projects.data && projects.data.items.every((p) => p.isSystem) && (
        <IllustratedState pose="curious" copy="projectsEmpty" title="Your projects will appear here" />
      )}
      {projects.isLoading ? (
        <Loading />
      ) : projects.data?.items.length === 0 ? (
        <Empty>{showArchived ? 'No archived projects.' : 'No projects yet.'}</Empty>
      ) : (
        <ul className="card-list">
          {projects.data?.items.map((p) => (
            <li key={p.id} className="card">
              <Link to={`/projects/${p.id}`} className="card-title">
                {p.name}
              </Link>
              {p.isSystem && <span className="pill">system</span>}
              {p.archivedAt && <span className="pill pill-archived">archived</span>}
              <p className="muted clamp">{p.description || 'No description.'}</p>
              <Labels labels={p.labels} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CreateProject({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const create = useMutation({
    mutationFn: () => client.projects.create({ name, description, labels }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/projects/${res.project.id}`)
    },
  })
  return (
    <form
      className="panel stack"
      aria-label="New project"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <TextInput label="Project name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      <MarkdownEditor id="new-project-description" label="Description (Markdown)" value={description} onChange={setDescription} rows={5} />
      <LabelsInput value={labels} onChange={setLabels} />
      <ErrorMessage error={create.error} />
      <div className="row">
        <button className="primary" type="submit" disabled={create.isPending}>
          Create project
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  )
}
