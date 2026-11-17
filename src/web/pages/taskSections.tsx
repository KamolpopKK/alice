import type { ComponentType } from 'react'
import type { Task } from '../../shared/contracts'
import { LinkedDocuments } from '../components/LinkedDocuments'
import { CompleteTask, Comments } from '../components/Comments'
import { Relations } from '../components/Relations'

// ส่วนเพิ่มเติมของหน้า task detail ที่ task ถัด ๆ ไปเพิ่ม (relationships, documents, comments)
export interface TaskSection {
  key: string
  Component: ComponentType<{ task: Task }>
}
export const TASK_MAIN_SECTIONS: TaskSection[] = [{ key: 'comments', Component: Comments }]
export const TASK_SIDE_SECTIONS: TaskSection[] = [
  { key: 'complete', Component: CompleteTask },
  { key: 'relations', Component: Relations },
  { key: 'documents', Component: ({ task }) => <LinkedDocuments target={{ taskId: task.id }} /> }]
