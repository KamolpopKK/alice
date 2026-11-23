import { KNOWLEDGE_TOOLS } from './knowledge-tools'
import { CORE_TOOLS } from './core-tools'
import { DOCUMENT_TOOLS } from './document-tools'
import { COLLABORATION_TOOLS } from './collaboration-tools'
import { RELATIONSHIP_TOOLS } from './relationship-tools'
import type { ToolDefinition } from './registry'

// รายการ tool ทั้งหมดของ MCP contract (ลำดับคงที่ — เพิ่มต่อท้ายเมื่อเพิ่ม tool)
export const TOOLS: ToolDefinition[] = [...KNOWLEDGE_TOOLS, ...CORE_TOOLS, ...DOCUMENT_TOOLS, ...COLLABORATION_TOOLS, ...RELATIONSHIP_TOOLS]
