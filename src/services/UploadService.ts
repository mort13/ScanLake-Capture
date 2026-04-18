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
}

export async function uploadBatch(payload: UploadPayload): Promise<boolean> {
  const formData = new FormData()
  formData.append('userId', payload.userId)
  formData.append('sessionId', payload.sessionId)
  formData.append('batchNumber', String(payload.batchNumber))
  formData.append('isFinal', String(payload.isFinal))
  formData.append(
    'scans',
    new Blob([payload.scansParquet], { type: 'application/octet-stream' }),
    `${payload.userId}_scans_${payload.sessionId}_batch${payload.batchNumber}.parquet`,
  )
  formData.append(
    'compositions',
    new Blob([payload.compositionsParquet], { type: 'application/octet-stream' }),
    `${payload.userId}_compositions_${payload.sessionId}_batch${payload.batchNumber}.parquet`,
  )
  formData.append(
    'confidences',
    new Blob([payload.confidencesParquet], { type: 'application/octet-stream' }),
    `${payload.userId}_confidences_${payload.sessionId}_batch${payload.batchNumber}.parquet`,
  )

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
