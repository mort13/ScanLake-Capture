import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { describe, expect, it } from 'vitest'
import {
  formatScu, isMilli, isVolumeRead, massDecimalsAllowed, materialVolume, parseMass, parseVolume,
  volumeFromOcr,
} from '../src/data/volume'
import { validateFormat } from '../src/ocr/CrnnDecoder'
import type { ModelMeta } from '../src/ocr/types'
import { buildCompositionsParquet, buildScansParquet } from '../src/services/ParquetExporter'
import type { Material, Scan } from '../src/types'

describe('volume', () => {
  it('reads SCU as shown and mSCU into SCU', () => {
    expect(parseVolume('12.90')).toBe(12.9)
    expect(parseVolume('12.90 SCU')).toBe(12.9)
    expect(parseVolume('1234.56')).toBe(1234.56)
    expect(parseVolume('25.26m')).toBe(0.02526)
    expect(parseVolume('25.26 mSCU')).toBe(0.02526)
    expect(parseVolume('25,26m')).toBe(0.02526)
    expect(parseVolume('999.99m')).toBe(0.99999)
    expect(parseVolume('7m')).toBe(0.007)
    expect(parseVolume('0.02526')).toBe(0.02526) // a stored mSCU volume, edited again
    expect(isMilli('25.26m')).toBe(true)
    expect(isMilli('25.26')).toBe(false)
  })

  it('refuses what the HUD never shows', () => {
    for (const bad of ['', 'abc', '25.266', '25.26%', '1000.00m', '12.345', '-3', '12m5']) {
      expect(parseVolume(bad), bad).toBeNull()
    }
  })

  it('turns milli reads without their m back into mSCU', () => {
    // how the web's digit model (no "m") reads "25.26m SCU"
    expect(volumeFromOcr('25.266')).toBe('25.26m')
    expect(volumeFromOcr('10.164')).toBe('10.16m')
    expect(volumeFromOcr('0.94%')).toBe('0.94m')
    expect(volumeFromOcr('25.266%')).toBe('25.26m')
    expect(volumeFromOcr('25.26m')).toBe('25.26m')
    // ordinary volumes stay as read
    expect(volumeFromOcr('12.90')).toBe('12.90')
    expect(volumeFromOcr('1234.56')).toBe('1234.56')
    expect(volumeFromOcr('')).toBe('')
  })

  it('lets the OCR keep milli reads for the volume only', () => {
    const meta = { formats: { decimal: '^\\d{1,3}\\.\\d{2}$', integer: '^\\d{1,6}$' } } as unknown as ModelMeta
    expect(validateFormat('25.266', '', meta, 'volume')).toBe(true)
    expect(validateFormat('1234.56', '', meta, 'volume')).toBe(true)
    expect(validateFormat('25.2', '', meta, 'volume')).toBe(true)
    expect(validateFormat('2.5.2', '', meta, 'volume')).toBe(false)
    expect(validateFormat('25.266', '', meta, 'inst')).toBe(false) // other fields: unchanged
    expect(validateFormat('25.266', '', meta)).toBe(false)
    expect(isVolumeRead('12.9%')).toBe(false)
  })
})

describe('mass', () => {
  it('is whole, or has decimals below 1 SCU', () => {
    expect(parseMass('11826')).toBe(11826)
    expect(parseMass('12.34')).toBe(12.34)
    expect(parseMass('12,3')).toBe(12.3)
    expect(parseMass('12345678')).toBeNull()
    expect(parseMass('1234.56')).toBeNull()
    expect(parseMass('0')).toBeNull()
    expect(massDecimalsAllowed('12.34', 0.02526)).toBe(true)
    expect(massDecimalsAllowed('12.34', 1.1)).toBe(false)
    expect(massDecimalsAllowed('12.34', null)).toBe(false)
    expect(massDecimalsAllowed('11826', 49.27)).toBe(true)
  })

  it('no longer has to be 100x the volume', () => {
    // a deposit under 1 SCU: mass 12.34, volume 25.26 mSCU (the old rule wanted >= 2526)
    expect(massDecimalsAllowed('12.34', parseVolume('25.26m'))).toBe(true)
  })
})

function scan(captureId: string, mass: number, volume: number): Scan {
  return {
    captureId, sessionId: 's-1', userId: 'u-1', userName: 'n', org: 'o', clusterId: 'k-1',
    timestamp: '2026-11-22T12:00:00.000Z', system: 'Stanton', gravityWell: 'Daymar', region: 'none',
    place: 'none', deposit: 'Quartz', depositConf: 1, mass, massConf: 1, resistance: 10,
    resistanceConf: 1, instability: 1.5, instabilityConf: 1, volume, volumeConf: 1, position: null,
  }
}

const PROFILE = { userId: 'u-1', userName: 'n', org: 'o' } as never

describe('upload', () => {
  it('writes mass as INT32, or DOUBLE when a deposit under 1 SCU has decimals', async () => {
    const whole = buildScansParquet([scan('a', 11826, 49.27)], PROFILE)
    expect(parquetMetadata(whole).schema.find(c => c.name === 'mass')?.type).toBe('INT32')
    const milli = buildScansParquet([scan('a', 11826, 49.27), scan('b', 12.34, 0.02526)], PROFILE)
    expect(parquetMetadata(milli).schema.find(c => c.name === 'mass')?.type).toBe('DOUBLE')
    const rows = await parquetReadObjects({ file: milli })
    expect(rows.map(r => [r.mass, r.volume])).toEqual([[11826, 49.27], [12.34, 0.02526]])
  })

  it('keeps material volumes of deposits under 1 SCU', async () => {
    expect(materialVolume(0.02526, 60)).toBe(0.01516)
    expect(materialVolume(49.27, 58.4)).toBe(28.77368)
    expect(formatScu(0.01516)).toBe('0.01516')
    expect(formatScu(28.77368)).toBe('28.77')
    const material: Material = {
      captureId: 'b', matIndex: 0, type: 'Quartz', amount: 60, quality: 500, materialVolume: 0,
      minConfidence: 1,
    }
    const buffer = buildCompositionsParquet([scan('b', 12.34, 0.02526)], [material])
    const rows = await parquetReadObjects({ file: buffer })
    expect(rows[0].material_volume).toBe(0.01516)
  })
})
