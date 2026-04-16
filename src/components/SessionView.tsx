import { useEffect, useState } from 'react'
import { useSession } from '../store/SessionStore'
import { ScanForm } from './ScanForm'
import { IndexedDBCache } from '../store/IndexedDBCache'
import type { Session, Scan, Material } from '../types'

interface Props {
  sessionId: string
  onBack: () => void
}

export function SessionView({ sessionId, onBack }: Props) {
  const { state, openSession, closeActiveView, deleteSessionWithoutUploading } = useSession()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedScan, setSelectedScan] = useState<{ scan: Scan; materials: Material[] } | null>(null)

  useEffect(() => {
    openSession(sessionId)
    return () => closeActiveView()
  }, [sessionId, openSession, closeActiveView])

  const session = state.sessions.find(s => s.sessionId === sessionId)
  if (!session) return <div>Session not found</div>

  async function handleSessionUpdated(updated: Session) {
    await IndexedDBCache.saveSession(updated)
  }

  async function handleDelete() {
    await deleteSessionWithoutUploading(sessionId)
    setShowDeleteConfirm(false)
    onBack()
  }

  return (
    <div className="session-view">
      <div className="session-view-header">
        <button onClick={onBack} className="btn-back">&larr; Back</button>
        <h2>{session.system} / {session.gravityWell}</h2>
        <span className={`session-status status-${session.status}`}>{session.status}</span>
        <span>{session.scanCount} scans ({session.pendingScans} pending)</span>
        {session.status === 'active' && (
          <button onClick={() => setShowDeleteConfirm(true)} className="btn-sm btn-danger">Delete Without Upload</button>
        )}
      </div>

      {showDeleteConfirm && (
        <div className="confirmation-dialog">
          <p>Delete this session and all pending scans without uploading?</p>
          <button onClick={handleDelete} className="btn-sm btn-danger">Confirm Delete</button>
          <button onClick={() => setShowDeleteConfirm(false)} className="btn-sm btn-cancel">Cancel</button>
        </div>
      )}

      {session.status === 'active' ? (
        <ScanForm session={session} onSessionUpdated={handleSessionUpdated} preloadedScan={selectedScan} onPreloadConsumed={() => setSelectedScan(null)} />
      ) : (
        <p>This session is {session.status}. No more scans can be added.</p>
      )}

      {state.scans.length > 0 && (
        <div className="scan-list">
          <h3>Scans in this session ({state.scans.length} in cache)</h3>
          <table className="scan-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Deposit</th>
                <th>Mass</th>
                <th>Vol</th>
                <th>Cluster</th>
                {session.status === 'active' && <th></th>}
              </tr>
            </thead>
            <tbody>
              {[...state.scans].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map(scan => (
                <tr key={scan.captureId}>
                  <td>{new Date(scan.timestamp).toLocaleTimeString()}</td>
                  <td>{scan.deposit}</td>
                  <td>{scan.mass}</td>
                  <td>{scan.volume}</td>
                  <td title={scan.clusterId}>{scan.clusterId.slice(0, 8)}</td>
                  {session.status === 'active' && (
                    <td>
                      <button
                        className="btn-sm"
                        title="Load this scan's data into the form"
                        onClick={() => setSelectedScan({ scan, materials: state.materials[scan.captureId] ?? [] })}
                      >Load</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
