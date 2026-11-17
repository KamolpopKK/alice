import readline from 'node:readline/promises'
import { CliError } from './errors'

export interface OutputOptions {
  json: boolean
  jsonl: boolean
  color: boolean
  quiet: boolean
}

export interface Column<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
  /** Truncate in table view (machine output is never truncated). */
  max?: number
}

const ESC = '\u001b['
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

/** Workspace identity carried by every enveloped JSON result. */
export interface EnvelopeWorkspace {
  id: string
  name: string
  alias: string
  kind: 'local' | 'remote'
}

/** stdout carries data only; diagnostics, warnings and prompts go to stderr. */
export class Output {
  /**
   * When set, machine output uses the stable envelope `{ok, workspace, data | error}`. It is on for
   * Local workspaces, agent mode, workspace commands and ALICE_JSON_ENVELOPE=1; Remote output keeps
   * its earlier shape otherwise.
   */
  private envelope: { workspace: EnvelopeWorkspace | null } | null = null

  useEnvelope(workspace: EnvelopeWorkspace | null) {
    this.envelope = { workspace }
  }

  get enveloped() {
    return this.envelope !== null
  }

  /** Machine-readable failure on stdout (envelope mode only); the human message still goes to stderr. */
  machineError(code: string, message: string, extra: Record<string, unknown> = {}) {
    if (!this.envelope || !this.machine) return
    const body = { ok: false, workspace: this.envelope.workspace, error: { code, message, ...extra } }
    this.line(this.opts.json ? JSON.stringify(body, null, 2) : JSON.stringify(body))
  }

  private wrap(data: unknown) {
    return this.envelope ? { ok: true, workspace: this.envelope.workspace, data } : data
  }

  constructor(
    readonly opts: OutputOptions,
    private readonly stdout: NodeJS.WritableStream = process.stdout,
    private readonly stderr: NodeJS.WritableStream = process.stderr,
  ) {}

  get machine() {
    return this.opts.json || this.opts.jsonl
  }

  private paint(code: string, text: string) {
    return this.opts.color ? `${ESC}${code}m${text}${ESC}0m` : text
  }
  bold = (t: string) => this.paint('1', t)
  dim = (t: string) => this.paint('2', t)
  green = (t: string) => this.paint('32', t)
  yellow = (t: string) => this.paint('33', t)
  red = (t: string) => this.paint('31', t)

  /** Raw line to stdout. */
  line(text = '') {
    this.stdout.write(text + '\n')
  }

  /** Progress or confirmation for humans; suppressed by --quiet. */
  info(text: string) {
    if (!this.opts.quiet) this.stderr.write(text + '\n')
  }
  warn(text: string) {
    if (!this.opts.quiet) this.stderr.write(this.yellow(text) + '\n')
  }
  error(text: string, hint?: string) {
    this.stderr.write(this.red(`alice: ${text}`) + '\n')
    if (hint) this.stderr.write(this.dim(hint) + '\n')
  }

  /** One value: pretty JSON, one JSONL line, or the human renderer. */
  value(value: unknown, human: () => void) {
    if (this.opts.json) this.line(JSON.stringify(this.wrap(value), null, 2))
    else if (this.opts.jsonl) this.line(JSON.stringify(this.wrap(value)))
    else human()
  }

  /** A collection: JSON array, one object per line, or an aligned table. */
  list<T>(items: T[], columns: Column<T>[], empty = 'Nothing to show.') {
    if (this.opts.json) return this.line(JSON.stringify(this.wrap(items), null, 2))
    if (this.opts.jsonl) {
      for (const item of items) this.line(JSON.stringify(this.wrap(item)))
      return
    }
    if (items.length === 0) return this.info(empty)
    const cells = items.map((row) =>
      columns.map((c) => {
        const raw = c.value(row)
        let text = raw === null || raw === undefined || raw === '' ? '—' : String(raw).replace(/\s+/g, ' ')
        if (c.max && text.length > c.max) text = text.slice(0, c.max - 1) + '…'
        return text
      }),
    )
    const widths = columns.map((c, i) => Math.max(c.header.length, ...cells.map((r) => strip(r[i]).length)))
    const fmt = (parts: string[]) => parts.map((p, i) => (i === parts.length - 1 ? p : p + ' '.repeat(widths[i] - strip(p).length))).join('  ')
    this.line(this.bold(fmt(columns.map((c) => c.header))))
    for (const row of cells) this.line(fmt(row))
  }

  /** Key/value detail view. */
  details(rows: Array<[string, string | number | boolean | null | undefined]>) {
    const width = Math.max(...rows.map(([k]) => k.length))
    for (const [k, v] of rows) this.line(`${this.dim(k.padEnd(width))}  ${v === null || v === undefined || v === '' ? '—' : v}`)
  }
}

export function isInteractive(): boolean {
  return !!process.stdin.isTTY && !!process.stderr.isTTY
}

/** Asks before destructive work; non-interactive callers must pass --yes explicitly. */
export async function confirm(out: Output, question: string, yes: boolean): Promise<void> {
  if (yes) return
  if (!isInteractive()) throw new CliError(`${question.replace(/\?$/, '')} needs confirmation`, 'usage', 'Re-run with --yes to confirm in non-interactive use')
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') throw new CliError('Cancelled', 'usage')
  } finally {
    rl.close()
  }
  void out
}
