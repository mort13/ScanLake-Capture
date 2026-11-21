/**
 * Where the ship was when a scan was taken, from the game's debug text (r_DisplayInfo).
 *
 * A port of the desktop app's `scanlake_core/domain/position.py`; keep the two in step.
 *
 * The game draws plain text in the top-right corner of the screen, e.g.
 *
 *     CamDir: -155  45 -179 FOV: 60 Focal: 3.00 FStop: 64.0
 *     Zone: MISC_Prospector_915731471510 Pos: -0.01m 9.72m 0.41m
 *     Zone: ab_mine_pyro_regionb_sml_001 Pos: -18.8743km -3354.15m 12.6396km
 *     Zone: SolarSystem_906804811333 Pos: -14427194.5960km 7825291.9814km -14901.0881km
 *     Zone: Root Pos: -14427194.5960km 7825291.9814km -14901.0881km
 *
 * One `Zone:` line per reference frame, innermost first; how many there are depends on where the
 * ship is. `parsePosition` turns the recognised lines into a `ShipPosition` with every coordinate
 * in metres. Only CamDir and Zone lines are kept: the rest of the debug text never leaves the reader.
 *
 * Positions are plain data (they are stored with the scan in IndexedDB).
 */

import { roundTo } from './DebugText'

/** What the text reader writes where it recognises no glyph */
export const UNKNOWN_GLYPH = '?'
/** A staged scan takes the last position read only if it is at most this old */
export const POSITION_MAX_AGE_MS = 2500

const NUM = String.raw`[-+]?\d+(?:\.\d+)?`
const UNIT = '(km|m)'
const CAM_DIR = new RegExp(String.raw`(?:^|\s)CamDir:\s*(${NUM})\s+(${NUM})\s+(${NUM})(?=\s|$)`)
// A Zone line even when its numbers are unreadable ("CamPos Planet Zone: ..." has no Pos:)
const ZONE_LINE = /(?:^|\s)Zone:\s+\S.*\sP[o?][s?]:/
const ZONE = new RegExp(
  String.raw`(?:^|\s)Zone:\s+(\S(?:.*?\S)?)\s+Pos:\s*` +
  String.raw`(${NUM})${UNIT}\s+(${NUM})${UNIT}\s+(${NUM})${UNIT}(?=\s|$)`,
)
const METRES: Record<string, number> = { m: 1, km: 1000 }

// Zones that span the whole system: the zone just inside them is the "local" one (asteroid
// cluster, planet, station) that places a scan on a map.
const SYSTEM_ZONES = ['SolarSystem', 'Root']

// The only zone inside the solar system this close to its origin is the vehicle's own frame
// (the pilot sits ~10 m from the ship's origin); planets and asteroid fields are km across.
const VEHICLE_FRAME_M = 1000

function isSystemZone(zone: string): boolean {
  return SYSTEM_ZONES.some(s => zone.startsWith(s))
}

export interface ZonePosition {
  /** 0-based position of the Zone line in the debug text, top first */
  index: number
  zone: string
  /** metres */
  x: number
  y: number
  z: number
  /** Lowest glyph match score of the line, 0..1 */
  confidence: number
}

export interface ShipPosition {
  zones: ZonePosition[]
  /** The CamDir values as shown (degrees), or null when CamDir was not read */
  camDir: [number, number, number] | null
}

/**
 * The CamDir and Zone values in recognised debug-text lines; null without a Zone line.
 *
 * `lines` are texts or {text, score} lines, top first. A Zone line whose numbers cannot be read is
 * dropped but still counts for the index of the lines below it, so an index always names the
 * same line of the game's text. An unrecognised glyph in a zone name is kept. Zone names are
 * engine identifiers without spaces, so a gap in one is an underscore the reader saw too faintly
 * (a 1 px line under the text) and becomes "_" again.
 */
export function parsePosition(lines: Iterable<string | { text: string; score: number }>): ShipPosition | null {
  let camDir: [number, number, number] | null = null
  const zones: ZonePosition[] = []
  let zoneLines = 0
  for (const line of lines) {
    const [text, score] = typeof line === 'string' ? [line, 1] : [line.text, line.score]
    const cam: RegExpExecArray | null = camDir === null ? CAM_DIR.exec(text) : null
    if (cam) {
      const values: number[] = cam.slice(1, 4).map(Number)
      if (values.every(Number.isFinite)) camDir = [values[0], values[1], values[2]]
      continue
    }
    if (!ZONE_LINE.test(text)) continue
    const index = zoneLines++
    const found = ZONE.exec(text)
    if (!found) continue
    const [, read, ...parts] = found
    const name = read.replace(/\s/g, '_')
    // 4 places: the game shows km with 4 decimals (0.1 mm); rounding drops float noise
    const coords = [0, 2, 4].map(i => roundTo(Number(parts[i]) * METRES[parts[i + 1]], 4))
    if (!coords.every(Number.isFinite)) continue
    zones.push({ index, zone: name, x: coords[0], y: coords[1], z: coords[2], confidence: roundTo(score, 4) })
  }
  return zones.length ? { zones, camDir } : null
}

export function positionConfidence(position: ShipPosition): number {
  return position.zones.length ? Math.min(...position.zones.map(z => z.confidence)) : 0
}

/**
 * The zone just inside the solar system (the asteroid cluster, planet or station); the innermost
 * zone when there is none.
 */
export function localZone(position: ShipPosition): ZonePosition {
  let local = position.zones[0]
  for (const zone of position.zones) {
    if (isSystemZone(zone.zone)) break
    local = zone
  }
  return local
}

/**
 * The one zone that places the scan on a map: the local zone (asteroid field, planet, station),
 * else the solar system's (`SolarSystem_…`, else `Root`) when the ship is in none; null when only
 * the vehicle's own frame was read. With a ship in open space the innermost line (the ship) is
 * also the only one inside the solar system, so `localZone` names it: it is skipped when it sits
 * next to its origin.
 */
export function regionalZone(position: ShipPosition): ZonePosition | null {
  const zones = position.zones
  const local = localZone(position)
  let at = zones.indexOf(local)
  if (
    !isSystemZone(local.zone) &&
    Math.hypot(local.x, local.y, local.z) < VEHICLE_FRAME_M &&
    zones.filter(z => !isSystemZone(z.zone)).length === 1
  ) at += 1
  return zones[at] ?? null
}

/** x / y / z in km, or in m when the position is within 10 km of the zone's origin. */
export function readableZone(zone: ZonePosition): string {
  const values = [zone.x, zone.y, zone.z]
  if (values.every(v => Math.abs(v) < 10_000)) return values.map(v => v.toFixed(1)).join(' / ') + ' m'
  return values.map(v => (v / 1000).toFixed(2)).join(' / ') + ' km'
}

export function positionSummary(position: ShipPosition): string {
  const local = localZone(position)
  return `${local.zone}: ${readableZone(local)}`
}

/** Python's "{:g}" for the CamDir values (6 significant digits, no trailing zeros). */
function formatG(v: number): string {
  return String(Number(v.toPrecision(6)))
}

export function positionDetails(position: ShipPosition): string {
  const lines: string[] = []
  if (position.camDir) lines.push('CamDir: ' + position.camDir.map(formatG).join(' '))
  for (const z of position.zones) lines.push(`${z.zone}: ${readableZone(z)}`)
  return lines.join('\n')
}

export const LOCAL_MARK = '◂ local'

/** CamDir and every Zone line, the local zone (the one a map places the scan in) marked. */
export function positionText(position: ShipPosition): string[] {
  const lines: string[] = []
  if (position.camDir) lines.push('CamDir: ' + position.camDir.map(formatG).join(' '))
  const local = localZone(position)
  for (const z of position.zones) lines.push(`${z.zone}: ${readableZone(z)}${z === local ? `   ${LOCAL_MARK}` : ''}`)
  return lines
}

/**
 * A `positions` parquet row (format v3): one per scan, its regional zone (asteroid field, planet,
 * station), else the solar system's. The other Zone lines stay with the scan in this browser.
 */
export interface PositionRow {
  capture_id: string
  zone_index: number
  zone: string
  pos_x: number
  pos_y: number
  pos_z: number
  cam_dir_x: number | null
  cam_dir_y: number | null
  cam_dir_z: number | null
  confidence: number
}

export function positionRows(captureId: string, position: ShipPosition | null | undefined): PositionRow[] {
  const z = position ? regionalZone(position) : null
  if (!position || !z) return []
  const cam = position.camDir
  return [{
    capture_id: captureId,
    zone_index: z.index,
    zone: z.zone,
    pos_x: z.x,
    pos_y: z.y,
    pos_z: z.z,
    cam_dir_x: cam ? cam[0] : null,
    cam_dir_y: cam ? cam[1] : null,
    cam_dir_z: cam ? cam[2] : null,
    confidence: z.confidence,
  }]
}

/** The last position that parsed, and when; a scan staged later takes it only while it is fresh. */
export class PositionTracker {
  position: ShipPosition | null = null
  /** ms (Date.now()) of the last position; 0 = never */
  at = 0
  /** The debug text was read at least once (the player has r_DisplayInfo on) */
  seen = false

  /** A read at time `at`; a read that found nothing keeps the last position. */
  observe(position: ShipPosition | null, at: number): void {
    if (!position) return
    this.position = position
    this.at = at
    this.seen = true
  }

  /** The last position if it is at most `maxAgeMs` older than `at`, else null. */
  fresh(at: number, maxAgeMs = POSITION_MAX_AGE_MS): ShipPosition | null {
    return this.position && at - this.at <= maxAgeMs ? this.position : null
  }
}
