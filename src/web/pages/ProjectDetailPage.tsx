import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project } from '../../shared/contracts'
import { FullPageError, isRecoverable } from '../brand'
import { client } from '../api'
import { Labels, LabelsInput } from '../components/LabelsInput'
import { Markdown, MarkdownEditor } from '../components/Markdown'
import { ActorBadge, ErrorMessage, Loading, TextInput, formatDate } from '../components/ui'
import { PROJECT_DETAIL_SECTIONS } from './projectSections'

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => client.projects.get(id) })
}

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const project = useProject(id)
  const [editing, setEditing] = useState(false)
  const qc = useQueryClient()
  const archive = useMutation({
    mutationFn: (archived: boolean) => (archived ? client.projects.archive(id) : client.projects.restore(id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  if (project.isLoading) return <Loading />
  if (project.error && isRecoverable(project.error)) return <FullPageError error={project.error} onRetry={() => void project.refetch()} />
  if (project.error || !project.data) return <ErrorMessage error={project.error ?? 'Project not found'} />
  const p = project.data
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {p.name} {p.isSystem && <span className="pill">system</span>} {p.archivedAt && <span className="pill pill-archived">archived</span>}
          </h1>
          <Labels labels={p.labels} />
        </div>
        <div className="row">
          <button type="button" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close editor' : 'Edit'}
          </button>
          {!p.isSystem &&
            (p.archivedAt ? (
              <button type="button" onClick={() => archive.mutate(false)}>
                Restore
              </button>
            ) : (
              <button type="button" onClick={() => archive.mutate(true)}>
                Archive
              </button>
            ))}
        </div>
      </div>
      <ErrorMessage error={archive.error} />
      {editing ? <EditProject project={p} onDone={() => setEditing(false)} /> : <Markdown source={p.description} />}
      <p className="muted small">
        Created {formatDate(p.createdAt)} {p.createdBy && <>by <ActorBadge actor={p.createdBy} /></>} · Updated {formatDate(p.updatedAt)}
        {p.updatedBy && <> by <ActorBadge actor={p.updatedBy} /></>}
      </p>
      {PROJECT_DETAIL_SECTIONS.map((Section, i) => (
        <Section key={i} project={p} />
      ))}
    </div>
  )
}

function EditProject({ project, onDone }: { project: Project; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [labels, setLabels] = useState(project.labels)
  const save = useMutation({
    mutationFn: () => client.projects.update(project.id, { ...(project.isSystem ? {} : { name }), description, labels }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', project.id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
      onDone()
    },
  })
  return (
    <form
      className="panel stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <TextInput
        label="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={project.isSystem}
        hint={project.isSystem ? 'The Untitled project cannot be renamed.' : undefined}
        required
      />
      <MarkdownEditor id="project-description" label="Description (Markdown)" value={description} onChange={setDescription} />
      <LabelsInput value={labels} onChange={setLabels} />
      <ErrorMessage error={save.error} />
      <div className="row">
        <button className="primary" type="submit" disabled={save.isPending}>
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
