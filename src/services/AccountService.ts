import type { AccountInfo } from '../types'

const AUTH_BASE = import.meta.env.VITE_AUTH_URL ?? 'https://auth.scanlake.rocks'

/** Thrown by linkUserId() when another Discord account already owns the ID (HTTP 409). */
export class UserIdConflictError extends Error {
  constructor(message = 'This ID is already linked to another Discord account') {
    super(message)
    this.name = 'UserIdConflictError'
  }
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${AUTH_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readMe(res: Response, what: string): Promise<AccountInfo> {
  if (!res.ok) {
    throw new Error(`${what} failed: ${res.status}`)
  }
  return (await res.json()) as AccountInfo
}

export function accountDisplayName(account: AccountInfo): string {
  return account.discord.globalName || account.discord.username
}

/** Returns the logged-in account, or null when logged out. Throws on network errors. */
export async function fetchMe(): Promise<AccountInfo | null> {
  const res = await fetch(`${AUTH_BASE}/api/me`, { credentials: 'include' })
  if (res.status === 401) return null
  return readMe(res, 'Account request')
}

/** Full-page navigation target: Discord login, then back to the current page. */
export function loginUrl(): string {
  return `${AUTH_BASE}/login?return_to=${encodeURIComponent(location.href)}`
}

export async function logout(): Promise<void> {
  const res = await send('POST', '/logout')
  if (!res.ok) {
    throw new Error(`Logout failed: ${res.status}`)
  }
}

export async function linkUserId(userId: string): Promise<AccountInfo> {
  const res = await send('POST', '/api/me/user-ids', { userId })
  if (res.status === 409) {
    throw new UserIdConflictError()
  }
  return readMe(res, 'Linking user ID')
}

export async function pushProfile(userName: string, org: string): Promise<AccountInfo> {
  const res = await send('PUT', '/api/me/profile', { userName, org })
  return readMe(res, 'Profile update')
}

/** Deletes the Discord account, its user-ID links and all its sessions. */
export async function unlink(): Promise<void> {
  const res = await send('DELETE', '/api/me')
  if (!res.ok) {
    throw new Error(`Unlink failed: ${res.status}`)
  }
}
