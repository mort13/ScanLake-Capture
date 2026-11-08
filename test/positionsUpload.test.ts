import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { describe, expect, it } from 'vitest'
import { buildPositionsParquet } from '../src/services/ParquetExporter'
import { uploadForm, type UploadPayload } from '../src/services/UploadService'
import type { ShipPosition } from '../src/ocr/ShipPosition'
import type { Scan } from '../src/types'

const POSITION: ShipPosition = {
  zones: [
    { index: 0, zone: 'MISC_Prospector_1', x: -0.01, y: 9.72, z: 0.41, confidence: 0.93 },
    { index: 2, zone: 'Root', x: -14427194596.0, y: 7825291981.4, z: -14901088.1, confidence: 0.91 },
  ],
  camDir: [-155, 45, -179],
}

function scan(captureId: string, position?: ShipPosition | null): Scan {
  return {
    captureId, sessionId: 's-1', userId: 'u-1', userName: 'n', org: 'o', clusterId: 'k-1',
    timestamp: '2026-11-07T12:00:00.000Z', system: 'Pyro', gravityWell: 'Pyro I', region: 'none',
    place: 'none', deposit: 'Quantanium', depositConf: 1, mass: 9000, massConf: 1, resistance: 10,
    resistanceConf: 1, instability: 1.5, instabilityConf: 1, volume: 50, volumeConf: 1, position,
  }
}

/** The `positions` columns of parquet format v3 (ScanLake-Format, branch `positions`), in order. */
const V3_POSITIONS = [
  ['capture_id', 'BYTE_ARRAY'], ['zone_index', 'INT32'], ['zone', 'BYTE_ARRAY'],
  ['pos_x', 'DOUBLE'], ['pos_y', 'DOUBLE'], ['pos_z', 'DOUBLE'],
  ['cam_dir_x', 'DOUBLE'], ['cam_dir_y', 'DOUBLE'], ['cam_dir_z', 'DOUBLE'], ['confidence', 'DOUBLE'],
]

describe('the positions parquet', () => {
  it('has one row per Zone line in the format v3 columns, none for scans without a position', async () => {
    const buffer = buildPositionsParquet([scan('c-1', POSITION), scan('c-2'), scan('c-3', null)])!
    const schema = parquetMetadata(buffer).schema.slice(1)
    expect(schema.map(c => [c.name, c.type])).toEqual(V3_POSITIONS)
    expect(schema.filter(c => c.type === 'BYTE_ARRAY').every(c => c.converted_type === 'UTF8')).toBe(true)

    const rows = await parquetReadObjects({ file: buffer })
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      capture_id: 'c-1', zone_index: 2, zone: 'Root', pos_x: -14427194596.0, pos_y: 7825291981.4,
      pos_z: -14901088.1, cam_dir_x: -155, cam_dir_y: 45, cam_dir_z: -179, confidence: 0.91,
    })
  })

  it('leaves CamDir empty when it was not read', async () => {
    const buffer = buildPositionsParquet([scan('c-1', { ...POSITION, camDir: null })])!
    const rows = await parquetReadObjects({ file: buffer })
    expect(rows.map(r => [r.cam_dir_x, r.cam_dir_y, r.cam_dir_z])).toEqual([[null, null, null], [null, null, null]])
  })

  it('is not written when no scan has a position', () => {
    expect(buildPositionsParquet([scan('c-1'), scan('c-2', null)])).toBeNull()
    expect(buildPositionsParquet([])).toBeNull()
  })
})

describe('the upload form', () => {
  const payload: UploadPayload = {
    userId: 'u-1', sessionId: 's-1', batchNumber: 1, isFinal: true,
    scansParquet: new ArrayBuffer(4), compositionsParquet: new ArrayBuffer(4), confidencesParquet: new ArrayBuffer(4),
    positionsParquet: new ArrayBuffer(8),
  }
  const files = (form: FormData) => [...form.keys()].filter(k => form.get(k) instanceof Blob)

  it('sends positions only when the player opted in', () => {
    expect(files(uploadForm(payload))).toEqual(['scans', 'compositions', 'confidences'])
    expect(files(uploadForm({ ...payload, uploadPositions: false }))).toEqual(['scans', 'compositions', 'confidences'])
    const form = uploadForm({ ...payload, uploadPositions: true })
    expect(files(form)).toEqual(['scans', 'compositions', 'confidences', 'positions'])
    expect((form.get('positions') as File).name).toBe('u-1_positions_s-1_batch1.parquet')
    expect((form.get('positions') as File).size).toBe(8)
  })

  it('sends no positions when the batch has none', () => {
    expect(files(uploadForm({ ...payload, uploadPositions: true, positionsParquet: null }))).toEqual(['scans', 'compositions', 'confidences'])
  })

  it('keeps the other fields', () => {
    const form = uploadForm(payload)
    expect(['userId', 'sessionId', 'batchNumber', 'isFinal'].map(k => form.get(k))).toEqual(['u-1', 's-1', '1', 'true'])
    expect((form.get('scans') as File).name).toBe('u-1_scans_s-1_batch1.parquet')
  })
})
