// ที่เก็บ capability ของ Local workspace ใน OS credential store (Keychain / Secret Service / DPAPI)
// ค่า secret ส่งผ่าน stdin/stdout ของ OS tool เท่านั้น ไม่เคยอยู่ใน argv, registry, locator หรือ log
import path from 'node:path'
import { selectCredentialStore, type CredentialStore } from '../cli/credentials'
import type { LocalAgentClient } from './registry'

export const LOCAL_CREDENTIAL_SERVICE = 'alice-local'
export const CAPABILITY_PREFIX = 'alice_lc_'

export type CapabilityHolder = 'owner' | LocalAgentClient

export const capabilityAccount = (workspaceId: string, holder: CapabilityHolder) => `${workspaceId}/${holder}`

export function localCredentialStore(root: string, env: NodeJS.ProcessEnv = process.env): CredentialStore {
  return selectCredentialStore(path.join(root, 'credentials'), env, LOCAL_CREDENTIAL_SERVICE)
}
