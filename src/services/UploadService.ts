import { getSessionToken, clearToken } from './AuthService'

const STORE_API_BASE = import.meta.env.VITE_STORE_API_BASE ?? 'https://scanlake-store.mo-55d.workers.dev'
const UPLOAD_URL = `${STORE_API_BASE}/api/upload`

export interface UploadPayload {
  userId: string
  sessionId: string
  batchNumber: number
  isFinal: boolean
  scansParquet: ArrayBuffer
  compositionsParquet: ArrayBuffer
  confidencesParquet: ArrayBuffer
  /** The optional ship positions file (null when no scan of the batch has a position) ... */
  positionsParquet?: ArrayBuffer | null
  /** ... sent only when the player opted in (Settings → Upload ship positions) */
  uploadPositions?: boolean
}

/**
 * The multipart body of an upload. The `positions` field is there only when the player opted in
 * and the batch has positions.
 */
export function uploadForm(payload: UploadPayload): FormData {
  const formData = new FormData()
  formData.append('userId', payload.userId)
  formData.append('sessionId', payload.sessionId)
  formData.append('batchNumber', String(payload.batchNumber))
  formData.append('isFinal', String(payload.isFinal))
  const files: [string, ArrayBuffer | null | undefined][] = [
    ['scans', payload.scansParquet],
    ['compositions', payload.compositionsParquet],
    ['confidences', payload.confidencesParquet],
    ['positions', payload.uploadPositions ? payload.positionsParquet : null],
  ]
  for (const [kind, data] of files) {
    if (!data) continue
    formData.append(
      kind,
      new Blob([data], { type: 'application/octet-stream' }),
      `${payload.userId}_${kind}_${payload.sessionId}_batch${payload.batchNumber}.parquet`,
    )
  }
  return formData
}

export async function uploadBatch(payload: UploadPayload): Promise<boolean> {
  const formData = uploadForm(payload)

  try {
    const token = await getSessionToken(payload.userId, payload.sessionId)
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    if (res.ok) {
      console.log(`Batch ${payload.batchNumber} uploaded successfully`)
      return true
    }
    if (res.status === 401) {
      clearToken()
    }
  } catch (err) {
    console.warn(`Upload to ${UPLOAD_URL} failed. Data still flushed locally.`, err)
  }
  // Return true anyway so local state progresses - data is already exported to parquet
  return true
}
