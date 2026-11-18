import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskPriority, TaskStatus } from '../../shared/contracts'
import { client } from '../api'
import { LabelsInput } from '../components/LabelsInput'
import { MarkdownEditor } from '../components/Markdown'
import { AssigneeSelect, PrioritySelect, ProjectSelect, StatusSelect } from '../components/TaskFields'
import { ErrorMessage } from '../components/ui'
import { Button, TextField } from '../ui'
import { useActors } from '../hooks'
import { useProjects } from './ProjectsPage'

export function NewTaskPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projects = useProjects()
  const actors = useActors()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState<string | null>(params.get('projectId'))
  const [status, setStatus] = useState<TaskStatus>((params.get('status') as TaskStatus) || 'backlog')
  const [priority, setPriority] = useState<TaskPriority>('none')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [dueAt, setDueAt] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const create = useMutation({
    mutationFn: () =>
      client.tasks.create({ title, description, projectId, status, priority, assigneeId, dueAt: dueAt || null, labels, parentId: params.get('parentId') }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      navigate(`/tasks/${res.task.id}`)
    },
  })
  return (
    <div className="page resource-page new-task-page">
      <h1>New task</h1>
      <form
        className="resource-panel resource-form"
        aria-label="New task"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
        <MarkdownEditor id="new-task-description" label="Description (Markdown)" value={description} onChange={setDescription} rows={6} />
        <div className="new-task-grid">
          <ProjectSelect value={projectId} projects={projects.data?.items ?? []} onChange={setProjectId} allowDefault />
          <StatusSelect value={status} onChange={setStatus} />
          <PrioritySelect value={priority} onChange={setPriority} />
          <AssigneeSelect value={assigneeId} actors={actors.data ?? []} onChange={setAssigneeId} />
          <TextField label="Due date" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <LabelsInput value={labels} onChange={setLabels} />
        </div>
        <ErrorMessage error={create.error} />
        <div className="resource-actions">
          <Button variant="primary" type="submit" loading={create.isPending}>
            Create task
          </Button>
          <Button onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  )
}
