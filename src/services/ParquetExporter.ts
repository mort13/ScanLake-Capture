import { parquetWriteBuffer } from 'hyparquet-writer'
import type { Scan, Material } from '../types'
import type { UserProfile } from '../types'

function toBigInt64(nums: number[]): BigInt64Array {
  return BigInt64Array.from(nums.map(n => BigInt(Math.round(Number(n)))))
}

function toFloat64(nums: (number | string)[]): Float64Array {
  return Float64Array.from(nums.map(n => parseFloat(String(n).replace(/,/g, '.'))))
}

export function buildScansParquet(scans: Scan[], profile: UserProfile): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: 'session_id',       data: scans.map(s => s.sessionId),                    type: 'STRING' },
      { name: 'user_id',          data: scans.map(() => profile.userId),                 type: 'STRING' },
      { name: 'user_name',        data: scans.map(() => profile.userName),               type: 'STRING' },
      { name: 'org',              data: scans.map(() => profile.org),                    type: 'STRING' },
      { name: 'timestamp',        data: scans.map(s => s.timestamp),                    type: 'STRING' },
      { name: 'capture_id',       data: scans.map(s => s.captureId),                    type: 'STRING' },
      { name: 'cluster_id',       data: scans.map(s => s.clusterId),                    type: 'STRING' },
      { name: 'system',           data: scans.map(s => s.system),                       type: 'STRING' },
      { name: 'gravity_well',     data: scans.map(s => s.gravityWell),                  type: 'STRING' },
      { name: 'region',           data: scans.map(s => s.region),                       type: 'STRING' },
      { name: 'place',            data: scans.map(s => s.place),                        type: 'STRING' },
      { name: 'deposit',          data: scans.map(s => s.deposit),                      type: 'STRING' },
      { name: 'deposit_conf',     data: toFloat64(scans.map(() => 1.0)),                   type: 'DOUBLE' },
      { name: 'mass',             data: toBigInt64(scans.map(s => Number(s.mass))),         type: 'INT64' },
      { name: 'mass_conf',        data: toFloat64(scans.map(() => 1.0)),                   type: 'DOUBLE' },
      { name: 'resistance',       data: toBigInt64(scans.map(s => Number(s.resistance))),   type: 'INT64' },
      { name: 'resistance_conf',  data: toFloat64(scans.map(() => 1.0)),                   type: 'DOUBLE' },
      { name: 'instability',      data: toFloat64(scans.map(s => s.instability)),           type: 'DOUBLE' },
      { name: 'instability_conf', data: toFloat64(scans.map(() => 1.0)),                   type: 'DOUBLE' },
      { name: 'volume',           data: toFloat64(scans.map(s => s.volume)),                type: 'DOUBLE' },
      { name: 'volume_conf',      data: toFloat64(scans.map(() => 1.0)),                   type: 'DOUBLE' },
    ],
  })
}

export function buildCompositionsParquet(scans: Scan[], materials: Material[]): ArrayBuffer {
  // Enrich material_volume at export time from the parent scan's volume
  const scanVolumeMap = new Map(scans.map(s => [s.captureId, s.volume]))
  const enriched = materials.map(m => ({
    ...m,
    materialVolume: Math.round(((scanVolumeMap.get(m.captureId) ?? 0) * m.amount / 100) * 100) / 100,
  }))

  return parquetWriteBuffer({
    columnData: [
      { name: 'capture_id',      data: enriched.map(m => m.captureId),                             type: 'STRING' },
      { name: 'mat_index',       data: toBigInt64(enriched.map(m => Number(m.matIndex))),         type: 'INT64' },
      { name: 'type',            data: enriched.map(m => m.type),                                 type: 'STRING' },
      { name: 'amount',          data: toFloat64(enriched.map(m => m.amount)),                    type: 'DOUBLE' },
      { name: 'quality',         data: toBigInt64(enriched.map(m => Number(m.quality))),          type: 'INT64' },
      { name: 'material_volume', data: toFloat64(enriched.map(m => m.materialVolume)),            type: 'DOUBLE' },
      { name: 'min_confidence',  data: toFloat64(enriched.map(() => 1.0)),                        type: 'DOUBLE' },
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
