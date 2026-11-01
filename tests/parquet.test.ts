import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { buildScansParquet } from '../src/services/ParquetExporter.ts'
import type { Scan } from '../src/types.ts'

const profile = { userId: 'user', userName: 'Tester', org: 'Org' }

function scan(mass: number, volume: number): Scan {
  return {
    captureId: `capture-${mass}`, sessionId: 'session', userId: 'user', userName: 'Tester', org: 'Org',
    clusterId: 'cluster', timestamp: '2026-11-01T00:00:00.000Z', system: 'Stanton', gravityWell: 'Hurston',
    region: 'none', place: 'none', deposit: 'Quartz', depositConf: 1, mass, massConf: 1,
    resistance: 0, resistanceConf: 1, instability: 4.58, instabilityConf: 1, volume, volumeConf: 1,
  }
}

async function massColumn(scans: Scan[]) {
  const file = buildScansParquet(scans, profile)
  const type = parquetMetadata(file).schema.find(e => e.name === 'mass')?.type
  const rows = await parquetReadObjects({ file, columns: ['mass', 'volume'] })
  return { type, rows }
}

test('a batch of whole masses writes mass as INT32, as before', async () => {
  const { type, rows } = await massColumn([scan(11826, 49.27), scan(9000, 30)])
  assert.equal(type, 'INT32')
  assert.deepEqual(rows.map(r => r.mass), [11826, 9000])
})

test('a batch with a decimal mass (deposit under 1 SCU) writes mass as DOUBLE', async () => {
  const { type, rows } = await massColumn([scan(11826, 49.27), scan(12.34, 0.02526)])
  assert.equal(type, 'DOUBLE')
  assert.deepEqual(rows, [{ mass: 11826, volume: 49.27 }, { mass: 12.34, volume: 0.02526 }])
})
