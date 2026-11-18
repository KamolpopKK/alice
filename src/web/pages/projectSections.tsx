import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useTaskPages } from '../tasks/hooks'
import { TaskTable } from '../tasks/views'
import type { Project } from '../../shared/contracts'
import { LinkedDocuments } from '../components/LinkedDocuments'

// ส่วนเพิ่มเติมในหน้า project (tasks, linked documents) ที่ task ถัดไปเพิ่มเข้ามา
function ProjectTasks({ project }: { project: Project }) {
  const query = useTaskPages(`project-${project.id}`, { projectId: project.id, sort: 'priority' }, 50)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <section className="section" aria-labelledby="project-tasks-heading">
      <div className="page-head">
        <h2 id="project-tasks-heading">Tasks</h2>
        <Link className="button" to={`/tasks/new?projectId=${project.id}`}>
          New task in project
        </Link>
      </div>
      {tasks.length === 0 ? <p className="muted">No active tasks.</p> : <TaskTable tasks={tasks} showProject={false} caption={`Tasks in ${project.name}`} />}
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()}>
          Load more
        </button>
      )}
    </section>
  )
}

function ProjectDocuments({ project }: { project: Project }) {
  return (
    <section className="section panel">
      <LinkedDocuments target={{ projectId: project.id }} title="Project documents" />
    </section>
  )
}

export const PROJECT_DETAIL_SECTIONS: ComponentType<{ project: Project }>[] = [ProjectTasks, ProjectDocuments]
