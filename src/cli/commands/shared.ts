import fs from 'node:fs'
import type { AliceClient } from '../../client'
import type { Page, Project, PublicActor } from '../../shared/contracts'
import { CliError } from '../errors'
import type { Output } from '../output'

/** Markdown from a flag, a file, or stdin (`-`). File/stdin content is passed through byte-for-byte. */
export function readMarkdown(inline: string | undefined, file: string | undefined, what: string): string | undefined {
  if (inline !== undefined && file !== undefined) throw new CliError(`Use either --${what} or --${what}-file, not both`)
  if (file === undefined) return inline
  try {
    return file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')
  } catch {
    throw new CliError(file === '-' ? 'Could not read from stdin' : `Could not read ${file}`)
  }
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 10_000

/** --limit N (default 50) or --all; returns the item budget. */
export function itemBudget(limit: string | undefined, all: boolean | undefined): number {
  if (all) return MAX_LIMIT
  if (limit === undefined) return DEFAULT_LIMIT
  const n = Number(limit)
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw new CliError(`--limit must be between 1 and ${MAX_LIMIT}`)
  return n
}

/** Follows keyset cursors until `budget` items are collected; tells the human (stderr) when more exist. */
export async function collect<T>(out: Output, budget: number, fetchPage: (cursor: string | null, limit: number) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = []
  let cursor: string | null = null
  for (;;) {
    const page: Page<T> = await fetchPage(cursor, Math.min(200, budget - items.length))
    items.push(...page.items)
    cursor = page.nextCursor
    if (!cursor || items.length >= budget) break
  }
  if (cursor && items.length >= budget) out.info(`Showing the first ${items.length}; use --limit N or --all for more.`)
  return items
}

const ID = /^[a-z]{3}_[0-9a-z]+$/

/**
 * Accepts an opaque id, or an exact (case-insensitive) project name that matches exactly one project.
 * Ambiguous or unknown names fail instead of guessing.
 */
export async function resolveProject(client: AliceClient, value: string): Promise<string> {
  if (ID.test(value)) return value
  const all = await client.projects.list('all')
  const matches = all.filter((p: Project) => p.name.toLowerCase() === value.trim().toLowerCase())
  if (matches.length === 1) return matches[0].id
  if (matches.length === 0) throw new CliError(`No project named "${value}"`, 'not_found', 'List projects with: alice project list --archived all')
  throw new CliError(`"${value}" matches ${matches.length} projects: ${matches.map((p) => p.id).join(', ')}`, 'usage', 'Use the project id instead')
}

/** `me`, `none`, an actor id, or an exact username / display name that matches one actor. */
export async function resolveActor(client: AliceClient, value: string): Promise<string | null> {
  if (value === 'none') return null
  if (value === 'me') return (await client.auth.me()).actor.id
  if (ID.test(value)) return value
  const actors = await client.actors.list()
  const v = value.trim().toLowerCase()
  const matches = actors.filter((a: PublicActor) => a.username?.toLowerCase() === v || a.displayName.toLowerCase() === v)
  if (matches.length === 1) return matches[0].id
  if (matches.length === 0) throw new CliError(`No person or agent named "${value}"`, 'not_found', 'List actors with: alice actor list')
  throw new CliError(`"${value}" matches ${matches.length} actors: ${matches.map((a) => a.id).join(', ')}`, 'usage', 'Use the actor id instead')
}

export function requireId(value: string | undefined, what: string): string {
  if (!value) throw new CliError(`${what} id is required`)
  return value
}

/** Splits repeatable/comma-separated flag values. */
export function listValues(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined
  return values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
}

export const shortDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')
