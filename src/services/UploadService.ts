// TODO: Add Bearer token auth once ScanLake Store worker implements /api/session
const STORE_API_BASE = import.meta.env.VITE_STORE_API_BASE ?? ''
const UPLOAD_URL = STORE_API_BASE ? `${STORE_API_BASE}/api/upload` : ''

export interface UploadPayload {
  userId: string
  sessionId: string
  batchNumber: number
  isFinal: boolean
  scansParquet: ArrayBuffer
  compositionsParquet: ArrayBuffer
}

export async function uploadBatch(payload: UploadPayload): Promise<boolean> {
  if (!UPLOAD_URL) {
    console.info('VITE_STORE_API_BASE not set — skipping upload, data flushed locally only.')
    return true
  }

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

  try {
    const res = await fetch(UPLOAD_URL, { method: 'POST', body: formData })
    if (res.ok) {
      console.log(`Batch ${payload.batchNumber} uploaded successfully`)
      return true
    }
    console.warn(`Upload failed: HTTP ${res.status}`)
  } catch (err) {
    console.warn(`Upload to ${UPLOAD_URL} failed. Data flushed locally.`, err)
  }
  // Return true so local state advances — parquet is already generated
  return true
}
