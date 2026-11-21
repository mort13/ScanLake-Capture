import { parquetWriteBuffer } from 'hyparquet-writer'
import type { Scan, Material } from '../types'
import type { UserProfile } from '../types'
import { positionRows } from '../ocr/ShipPosition'
import { materialVolume } from '../data/volume'

function toInt32(nums: (number | string)[]): Int32Array {
  return Int32Array.from(nums.map(n => Math.round(Number(n))))
}

function toFloat64(nums: (number | string)[]): Float64Array {
  return Float64Array.from(nums.map(n => parseFloat(String(n).replace(/,/g, '.'))))
}

/** Mass is INT32, except in a batch with a deposit under 1 SCU, whose mass has decimals
 *  ("12.34"): then DOUBLE (format v3 allows both; ScanLake Desktop writes it the same way). */
function massColumn(masses: number[]) {
  return masses.every(Number.isInteger)
    ? { name: 'mass', data: toInt32(masses), type: 'INT32' as const }
    : { name: 'mass', data: toFloat64(masses), type: 'DOUBLE' as const }
}

export function buildScansParquet(scans: Scan[], profile: UserProfile): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: 'session_id',   data: scans.map(s => s.sessionId),         type: 'STRING' },
      { name: 'user_id',      data: scans.map(() => profile.userId),      type: 'STRING' },
      { name: 'user_name',    data: scans.map(() => profile.userName),    type: 'STRING' },
      { name: 'org',          data: scans.map(() => profile.org),         type: 'STRING' },
      { name: 'timestamp',    data: scans.map(s => s.timestamp),         type: 'STRING' },
      { name: 'capture_id',   data: scans.map(s => s.captureId),         type: 'STRING' },
      { name: 'cluster_id',   data: scans.map(s => s.clusterId),         type: 'STRING' },
      { name: 'system',       data: scans.map(s => s.system),            type: 'STRING' },
      { name: 'gravity_well', data: scans.map(s => s.gravityWell),       type: 'STRING' },
      { name: 'region',       data: scans.map(s => s.region),            type: 'STRING' },
      { name: 'place',        data: scans.map(s => s.place),             type: 'STRING' },
      { name: 'deposit',      data: scans.map(s => s.deposit),           type: 'STRING' },
      massColumn(scans.map(s => s.mass)),
      { name: 'resistance',   data: toInt32(scans.map(s => s.resistance)), type: 'INT32' },
      { name: 'instability',  data: toFloat64(scans.map(s => s.instability)), type: 'DOUBLE' },
      { name: 'volume',       data: toFloat64(scans.map(s => s.volume)),  type: 'DOUBLE' },
    ],
  })
}

export function buildConfidencesParquet(scans: Scan[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: 'capture_id',       data: scans.map(s => s.captureId),                            type: 'STRING' },
      { name: 'deposit_conf',     data: toFloat64(scans.map(s => s.depositConf)),               type: 'DOUBLE' },
      { name: 'mass_conf',        data: toFloat64(scans.map(s => s.massConf)),                  type: 'DOUBLE' },
      { name: 'resistance_conf',  data: toFloat64(scans.map(s => s.resistanceConf)),            type: 'DOUBLE' },
      { name: 'instability_conf', data: toFloat64(scans.map(s => s.instabilityConf)),           type: 'DOUBLE' },
      { name: 'volume_conf',      data: toFloat64(scans.map(s => s.volumeConf)),                type: 'DOUBLE' },
    ],
  })
}

export function buildCompositionsParquet(scans: Scan[], materials: Material[]): ArrayBuffer {
  // Enrich material_volume at export time from the parent scan's volume
  const scanVolumeMap = new Map(scans.map(s => [s.captureId, s.volume]))
  const enriched = materials.map(m => ({
    ...m,
    materialVolume: materialVolume(scanVolumeMap.get(m.captureId) ?? 0, m.amount),
  }))

  return parquetWriteBuffer({
    columnData: [
      { name: 'capture_id',      data: enriched.map(m => m.captureId),                             type: 'STRING' },
      { name: 'mat_index',       data: toInt32(enriched.map(m => m.matIndex)),            type: 'INT32' },
      { name: 'type',            data: enriched.map(m => m.type),                                 type: 'STRING' },
      { name: 'amount',          data: toFloat64(enriched.map(m => m.amount)),                    type: 'DOUBLE' },
      { name: 'quality',         data: toInt32(enriched.map(m => m.quality)),               type: 'INT32' },
      { name: 'material_volume', data: toFloat64(enriched.map(m => m.materialVolume)),            type: 'DOUBLE' },
      { name: 'min_confidence',  data: toFloat64(enriched.map(() => 1.0)),                        type: 'DOUBLE' },
    ],
  })
}

/**
 * The optional `positions` file (format v3): one row per scan with a ship position, its regional
 * zone (asteroid field, planet, station), else the solar system's.
 * Null when no scan has a position — then the batch has no positions file.
 */
export function buildPositionsParquet(scans: Scan[]): ArrayBuffer | null {
  const rows = scans.flatMap(s => positionRows(s.captureId, s.position))
  if (rows.length === 0) return null
  return parquetWriteBuffer({
    columnData: [
      { name: 'capture_id', data: rows.map(r => r.capture_id),          type: 'STRING' },
      { name: 'zone_index', data: toInt32(rows.map(r => r.zone_index)), type: 'INT32' },
      { name: 'zone',       data: rows.map(r => r.zone),                type: 'STRING' },
      { name: 'pos_x',      data: Float64Array.from(rows, r => r.pos_x), type: 'DOUBLE' },
      { name: 'pos_y',      data: Float64Array.from(rows, r => r.pos_y), type: 'DOUBLE' },
      { name: 'pos_z',      data: Float64Array.from(rows, r => r.pos_z), type: 'DOUBLE' },
      // Empty when CamDir was not read
      { name: 'cam_dir_x',  data: rows.map(r => r.cam_dir_x),           type: 'DOUBLE' },
      { name: 'cam_dir_y',  data: rows.map(r => r.cam_dir_y),           type: 'DOUBLE' },
      { name: 'cam_dir_z',  data: rows.map(r => r.cam_dir_z),           type: 'DOUBLE' },
      { name: 'confidence', data: Float64Array.from(rows, r => r.confidence), type: 'DOUBLE' },
    ],
  })
}

export function downloadBlob(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
