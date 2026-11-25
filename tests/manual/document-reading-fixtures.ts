// Fixtures for document reading checks (native smoke and performance), ไม่ใช้ข้อมูลจริงของผู้ใช้
// usage: node --import tsx tests/manual/document-reading-fixtures.ts reading|table|diagram|draft [> file.md]
import { pathToFileURL } from 'node:url'

export const READING_LIMIT = 100_000

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``

/** A 20-column table with Thai text, a long URL and a long English cell. */
export function wideTable(rows = 3): string {
  const head = Array.from({ length: 20 }, (_, i) => `Column ${i + 1}`)
  const row = (r: number) =>
    head.map((_, c) =>
      c === 1
        ? 'รายละเอียดภาษาไทยที่ยาวพอสมควรเพื่อทดสอบการตัดบรรทัดภายในเซลล์ของตาราง'
        : c === 2
          ? `https://example.com/${'very-long-path-segment-'.repeat(8)}${r}`
          : c === 3
            ? 'A longer explanation that should wrap inside its own cell rather than stretching the column. '.repeat(2)
            : `R${r}C${c + 1}`,
    )
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...Array.from({ length: rows }, (_, r) => `| ${row(r + 1).join(' | ')} |`)].join('\n')
}

/** A flowchart with exactly 100 nodes, laid out in branches so it is both wide and tall. */
export function bigFlowchart(nodes = 100): string {
  const lines = ['flowchart LR']
  for (let i = 1; i < nodes; i++) lines.push(`  N${Math.floor((i - 1) / 3)}[Step ${Math.floor((i - 1) / 3)}] --> N${i}[Step ${i}]`)
  return lines.join('\n')
}

/**
 * The agreed performance/smoke fixture: one document at the 100,000-character limit that contains a
 * 20-column table and a 100-node Mermaid diagram near the top, then headings and ordinary paragraphs.
 */
export function readingFixture(): string {
  const head = ['# Reading fixture', 'Opening paragraph for the reading checks. ภาษาไทยปนกับ English.', '## Wide table', wideTable(), '## Large diagram', fence('mermaid', bigFlowchart()), '## Sections'].join('\n\n')
  let out = head + '\n\n'
  let n = 1
  const unit = (i: number) => `### Section ${i}\n\nParagraph ${i} with **bold**, a [link](https://example.com/docs) and ภาษาไทย. ${'Readable reading text keeps a comfortable measure. '.repeat(8)}\n\n`
  while (out.length + unit(n).length <= READING_LIMIT) out += unit(n++)
  return out.trimEnd()
}

/** A short draft for the Read draft check: headings, a table and a diagram. */
export function draftFixture(): string {
  return ['# Draft check', '## Details', 'Detail text.', wideTable(1), fence('mermaid', 'flowchart LR\n  A[Draft] --> B[Read]')].join('\n\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const which = process.argv[2] ?? 'reading'
  const out = { reading: readingFixture, table: () => wideTable(), diagram: () => fence('mermaid', bigFlowchart()), draft: draftFixture }[which]
  if (!out) {
    console.error('usage: document-reading-fixtures.ts reading|table|diagram|draft')
    process.exit(2)
  }
  process.stdout.write(out() + '\n')
}
