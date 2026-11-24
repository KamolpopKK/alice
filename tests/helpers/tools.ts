// The documented MCP v1 tool set, in contract order.
export const ALL_TOOLS = [
  'whoami', 'list_actors', 'list_projects', 'get_project', 'get_project_plan', 'create_project', 'update_project', 'archive_project', 'restore_project',
  'list_tasks', 'get_task', 'create_task', 'update_task', 'archive_task', 'restore_task', 'claim_task', 'search',
  'search_documents', 'get_document', 'create_document', 'update_document', 'review_document', 'clear_document_review',
  'list_document_relations', 'link_document_relation', 'unlink_document_relation', 'archive_document', 'restore_document',
  'list_document_revisions', 'restore_document_revision', 'link_document', 'unlink_document',
  'get_task_context', 'add_comment', 'list_comments', 'complete_task',
  'request_approval', 'get_approval', 'list_approvals', 'cancel_approval',
  'get_task_relations', 'set_task_parent', 'add_task_blocker', 'remove_task_blocker',
  'get_knowledge_context', 'list_topic_documents', 'put_topic_document', 'remove_topic_document',
  'list_knowledge_topics', 'get_knowledge_topic', 'create_knowledge_topic', 'update_knowledge_topic', 'archive_knowledge_topic', 'restore_knowledge_topic',
  'get_document_outline', 'get_document_preview', 'list_document_backlinks', 'list_document_topics',
]
