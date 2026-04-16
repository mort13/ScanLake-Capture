import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { IndexedDBCache } from './IndexedDBCache'
import { UserStore } from './UserStore'
import { buildScansParquet, buildCompositionsParquet, buildConfidencesParquet, downloadBlob } from '../services/ParquetExporter'
import { uploadBatch } from '../services/UploadService'
import type { Session, Scan, Material } from '../types'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  scans: Scan[] // scans for active session (in-memory)
  materials: Record<string, Material[]> // captureId -> materials
  clusterDeposits: Record<string, string> // clusterId -> deposit (kept across batches)
  loaded: boolean
}

type Action =
  | { type: 'LOADED'; sessions: Session[] }
  | { type: 'SESSION_CREATED'; session: Session }
  | { type: 'SESSION_UPDATED'; session: Session }
  | { type: 'SESSION_REMOVED'; sessionId: string }
  | { type: 'SET_ACTIVE'; sessionId: string | null; scans: Scan[]; materials: Record<string, Material[]> }
  | { type: 'SCAN_ADDED'; scan: Scan; materials: Material[] }
  | { type: 'SCAN_UPDATED'; scan: Scan; materials: Material[] }

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'LOADED':
      return { ...state, sessions: action.sessions, loaded: true }
    case 'SESSION_CREATED':
      return { ...state, sessions: [...state.sessions, action.session] }
    case 'SESSION_UPDATED':
      return {
        ...state,
        sessions: state.sessions.map(s => s.sessionId === action.session.sessionId ? action.session : s),
      }
    case 'SESSION_REMOVED':
      return {
        ...state,
        sessions: state.sessions.filter(s => s.sessionId !== action.sessionId),
        activeSessionId: state.activeSessionId === action.sessionId ? null : state.activeSessionId,
        scans: state.activeSessionId === action.sessionId ? [] : state.scans,
        materials: state.activeSessionId === action.sessionId ? {} : state.materials,
      }
    case 'SET_ACTIVE':
      return {
        ...state,
        activeSessionId: action.sessionId,
        scans: action.scans,
        materials: action.materials,
        clusterDeposits: buildClusterDepositsMap(action.scans),
      }
    case 'SCAN_ADDED':
      return {
        ...state,
        scans: [...state.scans, action.scan],
        materials: { ...state.materials, [action.scan.captureId]: action.materials },
        clusterDeposits: {
          ...state.clusterDeposits,
          [action.scan.clusterId]: action.scan.deposit,
        },
      }
    case 'SCAN_UPDATED':
      return {
        ...state,
        scans: state.scans.map(s => s.captureId === action.scan.captureId ? action.scan : s),
        materials: { ...state.materials, [action.scan.captureId]: action.materials },
        clusterDeposits: {
          ...state.clusterDeposits,
          [action.scan.clusterId]: action.scan.deposit,
        },
      }
    default:
      return state
  }
}

function buildClusterDepositsMap(scans: Scan[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const s of scans) {
    map[s.clusterId] = s.deposit
  }
  return map
}

interface SessionContextValue {
  state: SessionState
  createSession: (system: string, gravityWell: string, region: string) => Promise<Session>
  openSession: (sessionId: string) => Promise<void>
  closeActiveView: () => void
  addScan: (scan: Scan, materials: Material[]) => Promise<void>
  updateScan: (scan: Scan, materials: Material[]) => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  deleteSessionWithoutUploading: (sessionId: string) => Promise<void>
  getClusterDeposit: (clusterId: string) => string | undefined
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    sessions: [],
    activeSessionId: null,
    scans: [],
    materials: {},
    clusterDeposits: {},
    loaded: false,
  })

  useEffect(() => {
    IndexedDBCache.getAllSessions().then(sessions => {
      dispatch({ type: 'LOADED', sessions: sessions.filter(s => s.status !== 'archived') })
    })
  }, [])

  const createSession = useCallback(async (system: string, gravityWell: string, region: string) => {
    const profile = UserStore.loadProfile()
    const session: Session = {
      sessionId: uuidv4(),
      userId: profile.userId,
      userName: profile.userName,
      org: profile.org,
      system,
      gravityWell,
      region,
      createdAt: new Date().toISOString(),
      status: 'active',
      scanCount: 0,
      batchesUploaded: 0,
      pendingScans: 0,
      clusterHistory: [uuidv4()],
    }
    await IndexedDBCache.saveSession(session)
    dispatch({ type: 'SESSION_CREATED', session })
    return session
  }, [])

  const openSession = useCallback(async (sessionId: string) => {
    const scans = await IndexedDBCache.getScansForSession(sessionId)
    const materials: Record<string, Material[]> = {}
    for (const scan of scans) {
      materials[scan.captureId] = await IndexedDBCache.getMaterialsForScan(scan.captureId)
    }
    dispatch({ type: 'SET_ACTIVE', sessionId, scans, materials })
  }, [])

  const closeActiveView = useCallback(() => {
    dispatch({ type: 'SET_ACTIVE', sessionId: null, scans: [], materials: {} })
  }, [])

  const addScan = useCallback(async (scan: Scan, materials: Material[]) => {
    await IndexedDBCache.saveScan(scan, materials)
    dispatch({ type: 'SCAN_ADDED', scan, materials })

    // Update session counts and carry the region forward
    const session = state.sessions.find(s => s.sessionId === scan.sessionId)
    if (session) {
      const updated = {
        ...session,
        scanCount: session.scanCount + 1,
        pendingScans: session.pendingScans + 1,
        region: scan.region !== 'none' ? scan.region : session.region,
      }
      await IndexedDBCache.saveSession(updated)
      dispatch({ type: 'SESSION_UPDATED', session: updated })
    }
  }, [state.sessions])

  const updateScan = useCallback(async (scan: Scan, materials: Material[]) => {
    await IndexedDBCache.saveScan(scan, materials)
    dispatch({ type: 'SCAN_UPDATED', scan, materials })
  }, [])

  const flushBatch = useCallback(async (session: Session) => {
    const profile = UserStore.loadProfile()
    const settings = UserStore.loadSettings()
    const scans = await IndexedDBCache.getScansForSession(session.sessionId)
    if (scans.length === 0) return

    const allMaterials: Material[] = []
    for (const scan of scans) {
      const mats = await IndexedDBCache.getMaterialsForScan(scan.captureId)
      allMaterials.push(...mats)
    }
    const batchNum = session.batchesUploaded + 1
    const scansBuffer = buildScansParquet(scans, profile)
    const compsBuffer = buildCompositionsParquet(scans, allMaterials)
    const confsBuffer = buildConfidencesParquet(scans)

    await uploadBatch({
      userId: profile.userId,
      sessionId: session.sessionId,
      batchNumber: batchNum,
      isFinal: true,
      scansParquet: scansBuffer,
      compositionsParquet: compsBuffer,
      confidencesParquet: confsBuffer,
    })

    if (settings.autoDownload) {
      downloadBlob(scansBuffer, `${profile.userId}_scans_${session.sessionId}_batch${batchNum}.parquet`)
      downloadBlob(compsBuffer, `${profile.userId}_compositions_${session.sessionId}_batch${batchNum}.parquet`)
      downloadBlob(confsBuffer, `${profile.userId}_confidences_${session.sessionId}_batch${batchNum}.parquet`)
    }

    const updated: Session = {
      ...session,
      pendingScans: 0,
      status: 'closed',
    }
    await IndexedDBCache.saveSession(updated)
    dispatch({ type: 'SESSION_UPDATED', session: updated })

    if (settings.autoArchive) {
      await IndexedDBCache.deleteSession(session.sessionId)
      dispatch({ type: 'SESSION_REMOVED', sessionId: session.sessionId })
    }
  }, [])

  const closeSession = useCallback(async (sessionId: string) => {
    const session = state.sessions.find(s => s.sessionId === sessionId)
    if (!session) return
    await flushBatch(session)
  }, [state.sessions, flushBatch])

  const archiveSession = useCallback(async (sessionId: string) => {
    await IndexedDBCache.deleteSession(sessionId)
    dispatch({ type: 'SESSION_REMOVED', sessionId })
  }, [])

  const deleteSessionWithoutUploading = useCallback(async (sessionId: string) => {
    // Delete all scans for this session
    const scans = await IndexedDBCache.getScansForSession(sessionId)
    const captureIds = scans.map(s => s.captureId)
    if (captureIds.length > 0) {
      await IndexedDBCache.deleteScans(captureIds)
    }
    // Delete the session itself
    await IndexedDBCache.deleteSession(sessionId)
    dispatch({ type: 'SESSION_REMOVED', sessionId })
  }, [])

  const getClusterDeposit = useCallback((clusterId: string) => {
    return state.clusterDeposits[clusterId]
  }, [state.clusterDeposits])

  return (
    <SessionContext.Provider value={{
      state,
      createSession,
      openSession,
      closeActiveView,
      addScan,
      updateScan,
      closeSession,
      archiveSession,
      deleteSessionWithoutUploading,
      getClusterDeposit,
    }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
