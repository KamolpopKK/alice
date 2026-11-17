// alice://open/<kind>/<id>?profile=<name>      (Remote profile ของเครื่องนั้น)
// alice://open/<kind>/<id>?workspace=<wsp_id>  (Local workspace — id ไม่เปลี่ยนแม้เปลี่ยนชื่อ)
// ลิงก์มีแค่ตัวเลือก workspace + ชนิด + id แบบ opaque — ไม่มี URL ของ server หรือ credential

export const DEEP_LINK_SCHEME = 'alice'
export const DEEP_LINK_KINDS = ['task', 'project', 'document'] as const
export type DeepLinkKind = (typeof DEEP_LINK_KINDS)[number]

const ID_PREFIX: Record<DeepLinkKind, string> = { task: 'tsk_', project: 'prj_', document: 'doc_' }
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/
const OPAQUE_ID = /^[a-z]{3}_[0-9a-z]{4,60}$/
const MAX_LENGTH = 256

const WORKSPACE_ID = /^wsp_[0-9a-z]{4,60}$/

/** Exactly one of `profile` (Remote) or `workspace` (Local, immutable id) selects the context. */
export type DeepLink = { kind: DeepLinkKind; id: string } & ({ profile: string; workspace?: undefined } | { workspace: string; profile?: undefined })

export class DeepLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepLinkError'
  }
}

export function isValidProfileName(name: string): boolean {
  return PROFILE.test(name)
}

export function formatDeepLink(link: DeepLink): string {
  const parsed = validate(link)
  const selector = parsed.workspace !== undefined ? `workspace=${parsed.workspace}` : `profile=${encodeURIComponent(parsed.profile)}`
  return `${DEEP_LINK_SCHEME}://open/${parsed.kind}/${parsed.id}?${selector}`
}

function validate(link: DeepLink): DeepLink {
  if (link.workspace !== undefined) {
    if (link.profile !== undefined || !WORKSPACE_ID.test(link.workspace)) throw new DeepLinkError('Invalid workspace id')
  } else if (!isValidProfileName(link.profile)) throw new DeepLinkError('Invalid profile name')
  if (!(DEEP_LINK_KINDS as readonly string[]).includes(link.kind)) throw new DeepLinkError('Unsupported resource kind')
  if (!OPAQUE_ID.test(link.id) || !link.id.startsWith(ID_PREFIX[link.kind])) throw new DeepLinkError(`Invalid ${link.kind} id`)
  return link
}

/**
 * Strict parser: rejects anything other than the documented shape, including embedded credentials,
 * server URLs, extra parameters, fragments and unknown kinds.
 */
export function parseDeepLink(raw: string): DeepLink {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) throw new DeepLinkError('Link is empty or too long')
  if (/[\s\u0000-\u001f\\]/.test(raw)) throw new DeepLinkError('Link contains invalid characters')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DeepLinkError('Not a URL')
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) throw new DeepLinkError('Not an alice:// link')
  if (url.username || url.password) throw new DeepLinkError('Links must not contain credentials')
  if (url.port) throw new DeepLinkError('Links must not contain a port')
  if (url.hash) throw new DeepLinkError('Links must not contain a fragment')
  if (url.hostname !== 'open') throw new DeepLinkError('Unknown link action')
  const parts = url.pathname.split('/').filter((p, i) => i > 0 || p !== '')
  if (parts.length !== 2 || parts.some((p) => p === '')) throw new DeepLinkError('Expected alice://open/<kind>/<id>')
  const keys = [...url.searchParams.keys()]
  if (keys.length !== 1 || (keys[0] !== 'profile' && keys[0] !== 'workspace') || url.searchParams.getAll(keys[0]).length !== 1) {
    throw new DeepLinkError('Links take exactly one parameter: profile or workspace')
  }
  const base = { kind: parts[0] as DeepLinkKind, id: parts[1] }
  return validate(keys[0] === 'workspace' ? { ...base, workspace: url.searchParams.get('workspace')! } : { ...base, profile: url.searchParams.get('profile')! })
}

/** Path of the resource in the Web dashboard (same routes on every server). */
export function webPath(link: Pick<DeepLink, 'kind' | 'id'>): string {
  return `/${link.kind === 'document' ? 'documents' : `${link.kind}s`}/${link.id}`
}
