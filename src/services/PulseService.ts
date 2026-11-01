const FRONTDESK_URL = import.meta.env.VITE_FRONTDESK_URL ?? 'https://scanlake.rocks'

export type PingKind = 'open' | 'discard'

/**
 * Tells the landing page (ScanLake FrontDesk) that a session was opened or resumed,
 * or dropped without uploading, so it can show the open sessions live. Closing is
 * reported by the Store once the upload has landed. Fire-and-forget: never throws.
 */
export function pingSession(sessionId: string, kind: PingKind): void {
  fetch(`${FRONTDESK_URL}/api/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, source: 'capture', kind }),
    keepalive: true,
  }).catch(() => {
    // The landing page is optional; capturing works without it.
  })
}
