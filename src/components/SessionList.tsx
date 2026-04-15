import { useState } from 'react'
import { useSession } from '../store/SessionStore'
import { IndexedDBCache } from '../store/IndexedDBCache'
import { UserStore } from '../store/UserStore'
import { buildScansParquet, buildCompositionsParquet, buildConfidencesParquet, downloadBlob } from '../services/ParquetExporter'
import type { Material } from '../types'
import { Autocomplete } from './Autocomplete'
import { SYSTEMS, GRAVITY_WELLS } from '../data/deposits'
import { REGIONS_BY_GRAVITY_WELL } from '../data/regions'

interface Props {
  onOpenSession: (sessionId: string) => void
}

export function SessionList({ onOpenSession }: Props) {
  const { state, createSession, closeSession, archiveSession, deleteSessionWithoutUploading } = useSession()
  const [showCreate, setShowCreate] = useState(false)
  const [system, setSystem] = useState('')
  const [gravityWell, setGravityWell] = useState('')
  const [region, setRegion] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function handleCreate() {
    if (!system || !gravityWell) return
    const session = await createSession(system, gravityWell, region)
    setShowCreate(false)
    setSystem('')
    setGravityWell('')
    setRegion('')
    onOpenSession(session.sessionId)
  }

  async function handleDownload(sessionId: string) {
    const profile = UserStore.loadProfile()
    const scans = await IndexedDBCache.getScansForSession(sessionId)
    if (scans.length === 0) return
    const allMats: Material[] = []
    for (const scan of scans) {
      const mats = await IndexedDBCache.getMaterialsForScan(scan.captureId)
      allMats.push(...mats)
    }
    const scansBuffer = buildScansParquet(scans, profile)
    const compsBuffer = buildCompositionsParquet(scans, allMats)
    const confsBuffer = buildConfidencesParquet(scans)
    downloadBlob(scansBuffer, `${profile.userId}_scans_${sessionId}.parquet`)
    downloadBlob(compsBuffer, `${profile.userId}_compositions_${sessionId}.parquet`)
    downloadBlob(confsBuffer, `${profile.userId}_confidences_${sessionId}.parquet`)
  }

  async function handleDelete(sessionId: string) {
    await deleteSessionWithoutUploading(sessionId)
    setDeleteConfirm(null)
  }

  const gwOptions = GRAVITY_WELLS[system] || []

  return (
    <div className="session-list">
      <div className="session-list-header">
        <h2>Sessions</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary">+ New Session</button>
      </div>

      {showCreate && (
        <div className="create-session">
          <Autocomplete suggestions={SYSTEMS} value={system} onChange={setSystem} placeholder="System" />
          <Autocomplete suggestions={gwOptions} value={gravityWell} onChange={setGravityWell} placeholder="Gravity Well" />
          <Autocomplete suggestions={REGIONS_BY_GRAVITY_WELL[gravityWell] ?? []} value={region} onChange={setRegion} placeholder="Region (optional)" />
          <button onClick={handleCreate} className="btn-primary" disabled={!system || !gravityWell}>
            Create
          </button>
          <button onClick={() => setShowCreate(false)} className="btn-cancel">Cancel</button>
        </div>
      )}

      {state.sessions.length === 0 && <p className="empty-state">No sessions yet. Create one to start scanning.</p>}

      {state.sessions.map(session => (
        <div key={session.sessionId} className={`session-card ${session.status}`}>
          <div className="session-info">
            <strong>{session.system} / {session.gravityWell}</strong>
            <span className="session-date">{new Date(session.createdAt).toLocaleDateString()}</span>
            <span className={`session-status status-${session.status}`}>{session.status}</span>
            <span className="session-scans">{session.scanCount} scans</span>
          </div>
          <div className="session-actions">
            {session.status === 'active' && (
              <>
                <button onClick={() => onOpenSession(session.sessionId)} className="btn-sm">Open</button>
                <button onClick={() => closeSession(session.sessionId)} className="btn-sm btn-warning">Close & Upload</button>
                <button onClick={() => setDeleteConfirm(session.sessionId)} className="btn-sm btn-danger">Delete</button>
              </>
            )}
            {session.status !== 'active' && (
              <button onClick={() => handleDownload(session.sessionId)} className="btn-sm">Download</button>
            )}
            {session.status === 'closed' && (
              <button onClick={() => archiveSession(session.sessionId)} className="btn-sm btn-danger">Archive</button>
            )}
          </div>

          {deleteConfirm === session.sessionId && (
            <div className="confirmation-dialog">
              <p>Delete this session and all pending scans without uploading?</p>
              <button onClick={() => handleDelete(session.sessionId)} className="btn-sm btn-danger">Confirm Delete</button>
              <button onClick={() => setDeleteConfirm(null)} className="btn-sm btn-cancel">Cancel</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
