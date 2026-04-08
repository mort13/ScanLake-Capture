const STORE_API_BASE = import.meta.env.VITE_STORE_API_BASE ?? ''

let cachedToken: string | null = null
let tokenExpiresAt = 0

export async function getSessionToken(userId: string, sessionId: string): Promise<string> {
  if (cachedToken && tokenExpiresAt > Date.now() + 300_000) {
    return cachedToken
  }

  const res = await fetch(`${STORE_API_BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, sessionId }),
  })

  if (!res.ok) {
    throw new Error(`Session token request failed: ${res.status}`)
  }

  const data = (await res.json()) as { token: string; expiresAt: string }
  cachedToken = data.token
  tokenExpiresAt = new Date(data.expiresAt).getTime()
  return cachedToken
}

export function clearToken(): void {
  cachedToken = null
  tokenExpiresAt = 0
}
