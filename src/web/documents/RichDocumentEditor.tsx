import { DocumentLinkPicker } from './DocumentLinkPicker'
import { useCapability } from '../hooks'
import type { Editor } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from '@tiptap/react'
import {
  Bold,
  Code,
  FileCode,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Strikethrough,
  Table2,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useDeferredValue, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react'
import { MermaidDiagram } from '../components/MermaidDiagram'
import { Button, FieldMessage, Icon } from '../ui'
import { MarkdownConversionError, documentEditorExtensions, exportMarkdown, importMarkdown, type MarkdownSession } from './markdown'
import { RawMarkdownBlock } from './rawMarkdownBlock'

/** Imperative handle the surrounding editor uses to read the current Markdown before switching or saving. */
export interface RichEditorHandle {
  /** The current Markdown, or an error that explains why it could not be produced (the content is kept). */
  flush: () => { ok: true; markdown: string } | { ok: false; error: string }
}

function RawBlockView({ node, extension }: NodeViewProps) {
  const openSource = (extension.options as { onEditSource?: () => void }).onEditSource
  return (
    <NodeViewWrapper className="doc-raw-block" data-raw-markdown="">
      <div className="doc-raw-block-head" contentEditable={false}>
        <span>Markdown kept as written</span>
        {openSource && (
          <button type="button" className="doc-raw-block-edit" onClick={openSource}>
            Edit in Markdown
          </button>
        )}
      </div>
      {/* แสดงเป็นข้อความเท่านั้น: HTML ข้างในไม่ถูกตีความ */}
      <pre contentEditable={false}>{node.attrs.source as string}</pre>
    </NodeViewWrapper>
  )
}

function CodeBlockView({ node }: NodeViewProps) {
  const isMermaid = node.attrs.language === 'mermaid'
  // วาด diagram ตามหลังการพิมพ์ ไม่ขวางการพิมพ์
  const source = useDeferredValue(node.textContent)
  return (
    <NodeViewWrapper className="doc-code-block">
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
      {isMermaid && source.trim() && (
        <div className="doc-code-preview" contentEditable={false} aria-label="Diagram preview">
          <MermaidDiagram source={source} />
        </div>
      )}
    </NodeViewWrapper>
  )
}

function editorExtensions(onEditSource: () => void) {
  return documentEditorExtensions.map((ext) => {
    if (ext.name === RawMarkdownBlock.name) return RawMarkdownBlock.extend({ addOptions: () => ({ onEditSource }), addNodeView: () => ReactNodeViewRenderer(RawBlockView) })
    if (ext.name === CodeBlock.name) return CodeBlock.extend({ addNodeView: () => ReactNodeViewRenderer(CodeBlockView) })
    return ext
  })
}

type ToolButton = { label: string; icon: LucideIcon; active?: (e: Editor) => boolean; run: (e: Editor) => void }

const TOOLS: ToolButton[][] = [
  [
    { label: 'Heading 2', icon: Heading2, active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', icon: Heading3, active: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { label: 'Bold', icon: Bold, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
    { label: 'Inline code', icon: Code, active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  ],
  [
    { label: 'Bulleted list', icon: List, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', icon: ListOrdered, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: 'Checklist', icon: ListChecks, active: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run() },
    { label: 'Code block', icon: FileCode, active: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { label: 'Table', icon: Table2, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ],
]

// อนุญาตเฉพาะลิงก์ที่ปลอดภัย; javascript:, data: ฯลฯ ถูกปฏิเสธ
const SAFE_LINK = /^(https?:\/\/|mailto:|\/|#)/i

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const knowledge = useCapability('project-knowledge')
  const [url, setUrl] = useState((editor.getAttributes('link').href as string | undefined) ?? '')
  const [error, setError] = useState('')
  const apply = (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const href = url.trim()
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (!SAFE_LINK.test(href)) return setError('Use a web address (https://…), a mailto: link or a path.')
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    onClose()
  }
  return (
    <div className="doc-link-form" role="group" aria-label="Link">
      <label>
        Link address
        <input
          type="url"
          value={url}
          autoFocus
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply(e)
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
              editor.commands.focus()
            }
          }}
        />
      </label>
      <Button size="sm" onClick={apply}>
        {url.trim() ? 'Apply' : 'Remove link'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { onClose(); editor.commands.focus() }}>
        Cancel
      </Button>
      {error && <FieldMessage tone="error">{error}</FieldMessage>}
      {knowledge && <DocumentLinkPicker editor={editor} onClose={onClose} />}
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      raw: e.isActive('rawMarkdownBlock'),
      active: TOOLS.flat().map((t) => t.active?.(e) ?? false),
      link: e.isActive('link'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  })
  let i = 0
  return (
    <>
      <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLS.map((group, g) => (
          <div className="doc-toolbar-group" key={g}>
            {group.map((tool) => {
              const index = i++
              return (
                <button
                  key={tool.label}
                  type="button"
                  className="doc-tool"
                  aria-label={tool.label}
                  title={tool.label}
                  aria-pressed={tool.active ? state.active[index] : undefined}
                  // raw block แก้ได้ทาง Markdown เท่านั้น: toolbar เปลี่ยนชนิดมันไม่ได้
                  disabled={state.raw}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => tool.run(editor)}
                >
                  <Icon icon={tool.icon} size="sm" />
                </button>
              )
            })}
          </div>
        ))}
        <div className="doc-toolbar-group">
          <button type="button" className="doc-tool" aria-label="Link" title="Link" aria-pressed={state.link} aria-expanded={linking} disabled={state.raw} onMouseDown={(e) => e.preventDefault()} onClick={() => setLinking((v) => !v)}>
            <Icon icon={Link2} size="sm" />
          </button>
          <button type="button" className="doc-tool" aria-label="Undo" title="Undo" disabled={!state.undo} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().undo().run()}>
            <Icon icon={Undo2} size="sm" />
          </button>
          <button type="button" className="doc-tool" aria-label="Redo" title="Redo" disabled={!state.redo} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().redo().run()}>
            <Icon icon={Redo2} size="sm" />
          </button>
        </div>
      </div>
      {linking && <LinkForm editor={editor} onClose={() => setLinking(false)} />}
    </>
  )
}

/**
 * The rich-text pane. Loaded on demand; the Markdown stays the stored format. Edits are converted back to
 * Markdown a moment after typing stops, when the editor loses focus, and before switching or saving.
 */
export default function RichDocumentEditor({
  labelId,
  initial,
  onChange,
  onEditSource,
  handle,
}: {
  labelId: string
  initial: string
  onChange: (markdown: string) => void
  onEditSource: () => void
  handle: Ref<RichEditorHandle>
}) {
  const session = useRef<MarkdownSession>(importMarkdown(initial))
  const dirty = useRef(false)
  // Markdown ล่าสุดที่แปลงได้: ยังไม่แก้เลย = ข้อความเดิมทุกตัวอักษร
  const last = useRef(initial)
  const timer = useRef<number | undefined>(undefined)
  const [error, setError] = useState('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editSourceRef = useRef(onEditSource)
  editSourceRef.current = onEditSource

  const editor = useEditor({
    extensions: editorExtensions(() => editSourceRef.current()),
    content: session.current.doc,
    immediatelyRender: true,
    editorProps: {
      attributes: { 'aria-labelledby': labelId, 'aria-multiline': 'true', role: 'textbox', class: 'doc-editor-content markdown' },
      // ไม่รับลิงก์อันตรายจากการวาง
      transformPastedHTML: (html) => html.replace(/\s(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, ''),
    },
    onUpdate: () => {
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => flush(), 400)
    },
    onBlur: () => flush(),
  })

  function flush(): { ok: true; markdown: string } | { ok: false; error: string } {
    window.clearTimeout(timer.current)
    if (!editor) return { ok: false, error: 'The editor is not ready yet.' }
    if (!dirty.current) {
      setError('')
      return { ok: true, markdown: last.current }
    }
    try {
      const markdown = exportMarkdown(editor.getJSON(), session.current)
      dirty.current = false
      last.current = markdown
      setError('')
      onChangeRef.current(markdown)
      return { ok: true, markdown }
    } catch (e) {
      const message = e instanceof MarkdownConversionError ? e.message : 'The document could not be converted to Markdown.'
      setError(message)
      return { ok: false, error: message }
    }
  }

  useImperativeHandle(handle, () => ({ flush }))
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!editor) return null
  return (
    <div className="doc-rich">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="doc-editor" />
      {error && (
        <FieldMessage tone="error">
          {error}
        </FieldMessage>
      )}
    </div>
  )
}
