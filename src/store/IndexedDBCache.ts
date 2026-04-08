import { openDB, type IDBPDatabase } from 'idb'
import type { Session, Scan, Material } from '../types'

const DB_NAME = 'scanlake'
const DB_VERSION = 1

interface ScanLakeDB {
  sessions: { key: string; value: Session }
  scans: { key: string; value: Scan; indexes: { sessionId: string } }
  compositions: { key: string; value: Material; indexes: { captureId: string } }
}

let dbPromise: Promise<IDBPDatabase<ScanLakeDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ScanLakeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'sessionId' })
        const scanStore = db.createObjectStore('scans', { keyPath: 'captureId' })
        scanStore.createIndex('sessionId', 'sessionId')
        const compStore = db.createObjectStore('compositions', {
          keyPath: ['captureId', 'matIndex'],
        })
        compStore.createIndex('captureId', 'captureId')
      },
    })
  }
  return dbPromise
}

// Sessions
async function saveSession(session: Session): Promise<void> {
  const db = await getDB()
  await db.put('sessions', session)
}

async function getSession(sessionId: string): Promise<Session | undefined> {
  const db = await getDB()
  return db.get('sessions', sessionId)
}

async function getAllSessions(): Promise<Session[]> {
  const db = await getDB()
  return db.getAll('sessions')
}

async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['sessions', 'scans', 'compositions'], 'readwrite')
  await tx.objectStore('sessions').delete(sessionId)
  const scans = await tx.objectStore('scans').index('sessionId').getAll(sessionId)
  for (const scan of scans) {
    const comps = await tx.objectStore('compositions').index('captureId').getAll(scan.captureId)
    for (const comp of comps) {
      await tx.objectStore('compositions').delete([comp.captureId, comp.matIndex])
    }
    await tx.objectStore('scans').delete(scan.captureId)
  }
  await tx.done
}

// Scans
async function saveScan(scan: Scan, materials: Material[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['scans', 'compositions'], 'readwrite')
  await tx.objectStore('scans').put(scan)
  for (const mat of materials) {
    await tx.objectStore('compositions').put(mat)
  }
  await tx.done
}

async function getScansForSession(sessionId: string): Promise<Scan[]> {
  const db = await getDB()
  return db.getAllFromIndex('scans', 'sessionId', sessionId)
}

async function getMaterialsForScan(captureId: string): Promise<Material[]> {
  const db = await getDB()
  return db.getAllFromIndex('compositions', 'captureId', captureId)
}

async function getMaterialsForScans(captureIds: string[]): Promise<Material[]> {
  const db = await getDB()
  const all: Material[] = []
  for (const id of captureIds) {
    const mats = await db.getAllFromIndex('compositions', 'captureId', id)
    all.push(...mats)
  }
  return all
}

async function deleteScans(captureIds: string[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['scans', 'compositions'], 'readwrite')
  for (const id of captureIds) {
    const comps = await tx.objectStore('compositions').index('captureId').getAll(id)
    for (const comp of comps) {
      await tx.objectStore('compositions').delete([comp.captureId, comp.matIndex])
    }
    await tx.objectStore('scans').delete(id)
  }
  await tx.done
}

export const IndexedDBCache = {
  saveSession,
  getSession,
  getAllSessions,
  deleteSession,
  saveScan,
  getScansForSession,
  getMaterialsForScan,
  getMaterialsForScans,
  deleteScans,
}
