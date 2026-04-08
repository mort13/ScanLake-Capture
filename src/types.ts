export interface UserProfile {
  userId: string // uuid4
  userName: string
  org: string
  email?: string // optional, for recovery
}

export interface UserSettings {
  autoArchive: boolean
  autoDownload: boolean
}

export type SessionStatus = 'active' | 'closed' | 'archived'

export interface Session {
  sessionId: string // uuid4
  userId: string // uuid4
  userName: string
  org: string
  system: string
  gravityWell: string
  createdAt: string // ISO 8601 UTC
  status: SessionStatus
  scanCount: number
  batchesUploaded: number
  pendingScans: number
  clusterHistory: string[] // uuid4 stack (last = current cluster_id)
}

export interface Scan {
  captureId: string // uuid4
  sessionId: string // uuid4
  userId: string // uuid4
  userName: string
  org: string
  clusterId: string // uuid4
  timestamp: string // ISO 8601 UTC
  system: string
  gravityWell: string
  region: string // "none" for now
  place: string // "none" for now
  deposit: string
  depositConf: number // 1.0
  mass: number // int
  massConf: number // 1.0
  resistance: number // int
  resistanceConf: number // 1.0
  instability: number
  instabilityConf: number // 1.0
  volume: number
  volumeConf: number // 1.0
}

export interface Material {
  captureId: string // uuid4
  matIndex: number // 0-based
  type: string
  amount: number // percentage, 2 decimals
  quality: number // int
  materialVolume: number // calculated: volume * amount / 100
  minConfidence: number // 1.0
}

// Form-level types (before save, may be partial)
export interface MaterialFormRow {
  type: string
  amount: string
  quality: string
}

export interface ScanFormData {
  deposit: string
  mass: string
  resistance: string
  instability: string
  volume: string
  materials: MaterialFormRow[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}
