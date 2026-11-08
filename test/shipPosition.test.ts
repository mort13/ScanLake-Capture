import { describe, expect, it } from 'vitest'
import {
  POSITION_MAX_AGE_MS,
  PositionTracker,
  localZone,
  parsePosition,
  positionConfidence,
  positionDetails,
  positionRows,
  positionSummary,
  positionText,
  type ShipPosition,
} from '../src/ocr/ShipPosition'
import { LINES, OTHER_LINES } from './helpers'

describe('parsePosition', () => {
  it('reads every Zone line in metres, and CamDir', () => {
    const position = parsePosition([...LINES, ...OTHER_LINES])!
    expect(position.camDir).toEqual([-155, 45, -179])
    expect(position.zones.map(z => z.zone)).toEqual([
      'MISC_Prospector_915731471510', 'ab_mine_pyro_regionb_sml_001', 'SolarSystem_906804811333', 'Root',
    ])
    const cluster = position.zones[1]
    expect([cluster.x, cluster.y, cluster.z]).toEqual([-18874.3, -3354.15, 12639.6])
    expect(position.zones[3].x).toBe(-14427194596) // km -> m, no float noise
    expect(position.zones.map(z => z.index)).toEqual([0, 1, 2, 3])
    expect(localZone(position).zone).toBe('ab_mine_pyro_regionb_sml_001')
    expect(positionSummary(position)).toBe('ab_mine_pyro_regionb_sml_001: -18.87 / -3.35 / 12.64 km')
    expect(positionDetails(position).split('\n')).toEqual([
      'CamDir: -155 45 -179',
      'MISC_Prospector_915731471510: -0.0 / 9.7 / 0.4 m',
      'ab_mine_pyro_regionb_sml_001: -18.87 / -3.35 / 12.64 km',
      'SolarSystem_906804811333: -14427194.60 / 7825291.98 / -14901.09 km',
      'Root: -14427194.60 / 7825291.98 / -14901.09 km',
    ])
  })

  it('drops a line whose numbers are unreadable but keeps the indices', () => {
    const position = parsePosition([
      { text: 'Zone: MISC_Prosp?ctor_1 Pos: -0.01m 9.72m 0.41m', score: 0.5 }, // a name glyph: kept
      { text: 'Zone: ab_mine Pos: -18.87?3km -3354.15m 12.6396km', score: 0.4 }, // a digit: dropped
      { text: 'Zone: Root Pos: 1km 2km 3km', score: 0.9 },
    ])!
    expect(position.camDir).toBeNull()
    expect(position.zones.map(z => [z.index, z.zone])).toEqual([[0, 'MISC_Prosp?ctor_1'], [2, 'Root']])
    expect(positionConfidence(position)).toBe(0.5)
    expect(localZone(position).zone).toBe('MISC_Prosp?ctor_1')
  })

  it('lists CamDir and every zone for the preview, the local one marked', () => {
    expect(positionText(parsePosition(LINES)!)).toEqual([
      'CamDir: -155 45 -179',
      'MISC_Prospector_915731471510: -0.0 / 9.7 / 0.4 m',
      'ab_mine_pyro_regionb_sml_001: -18.87 / -3.35 / 12.64 km   ◂ local',
      'SolarSystem_906804811333: -14427194.60 / 7825291.98 / -14901.09 km',
      'Root: -14427194.60 / 7825291.98 / -14901.09 km',
    ])
  })

  it('reads gaps in zone names as faint underscores', () => {
    const position = parsePosition(['Zone: MISC Prospector 1 Pos: 1m 2m 3m', 'Zone: ab mine  x Pos: 1km 2km 3km'])!
    expect(position.zones.map(z => z.zone)).toEqual(['MISC_Prospector_1', 'ab_mine__x'])
  })

  it('is null without a Zone line', () => {
    expect(parsePosition(['CamDir: 1 2 3', ...OTHER_LINES])).toBeNull()
    expect(parsePosition([])).toBeNull()
  })
})

const POSITION: ShipPosition = {
  zones: [
    { index: 0, zone: 'MISC_Prospector_1', x: -0.01, y: 9.72, z: 0.41, confidence: 0.93 },
    { index: 2, zone: 'Root', x: -14427194596.0, y: 7825291981.4, z: -14901088.1, confidence: 0.91 },
  ],
  camDir: [-155, 45, -179],
}

describe('PositionTracker', () => {
  it('keeps the last position and hands it out while it is fresh', () => {
    const tracker = new PositionTracker()
    expect(tracker.fresh(1000)).toBeNull()
    expect(tracker.seen).toBe(false)
    tracker.observe(POSITION, 10_000)
    tracker.observe(null, 11_000) // a read that found nothing keeps the last position
    expect(tracker.seen).toBe(true)
    expect(tracker.fresh(10_000 + POSITION_MAX_AGE_MS)).toBe(POSITION)
    expect(tracker.fresh(10_001 + POSITION_MAX_AGE_MS)).toBeNull()
    expect(POSITION_MAX_AGE_MS).toBe(2500)
  })
})

describe('positionRows', () => {
  it('has one row per Zone line, CamDir on each', () => {
    const rows = positionRows('c-1', POSITION)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      capture_id: 'c-1', zone_index: 2, zone: 'Root', pos_x: -14427194596.0, pos_y: 7825291981.4,
      pos_z: -14901088.1, cam_dir_x: -155, cam_dir_y: 45, cam_dir_z: -179, confidence: 0.91,
    })
  })

  it('leaves CamDir empty when it was not read, and has no rows without a position', () => {
    const [row] = positionRows('c-2', { ...POSITION, camDir: null })
    expect([row.cam_dir_x, row.cam_dir_y, row.cam_dir_z]).toEqual([null, null, null])
    expect(positionRows('c-3', null)).toEqual([])
    expect(positionRows('c-3', undefined)).toEqual([])
  })
})
