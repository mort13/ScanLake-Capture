import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DebugFont, DebugTextReader, cornerRect, digitsInNumbers, phases, roundHalfEven, whiteness } from '../src/ocr/DebugText'
import { localZone, parsePosition, positionConfidence, type ShipPosition } from '../src/ocr/ShipPosition'
import { FIXTURES, LINES, OTHER_LINES, readPng, readPngRgba, shippedFonts, syntheticCorner, syntheticFont } from './helpers'

/**
 * The reader is tested with the desktop tests' synthetic fixed-width font (OpenCV's Hershey glyphs
 * in 9 px cells, with a dim shadow), with crops of real screenshots read with the shipped font
 * (public/display_info_font/, cut in the desktop repo and copied with `npm run sync-debug-font`),
 * and against what the desktop reader reads in the same images
 * (test/fixtures/make_debug_text_fixtures.py writes those fixtures).
 */

const font = syntheticFont()
const frac = syntheticFont('synthetic_frac') // the same glyphs, 9.5 px apart

describe('the debug-text corner', () => {
  it('is the right half of the top quarter', () => {
    expect(cornerRect(2560, 1440)).toEqual({ x: 1280, y: 0, width: 1280, height: 360 })
    expect(cornerRect(1920, 1080)).toEqual({ x: 960, y: 0, width: 960, height: 270 })
    expect(cornerRect(1366, 768)).toEqual({ x: 683, y: 0, width: 683, height: 192 })
  })

  it('is compared by whiteness, so the amber HUD counts as dark', () => {
    const rgba = new Uint8ClampedArray([255, 176, 0, 255, 250, 250, 250, 255, 30, 200, 90, 255])
    expect([...whiteness({ width: 3, height: 1, data: rgba }).data]).toEqual([0, 250, 30])
  })
})

describe('digitsInNumbers', () => {
  it.each([
    ['Pos: -O.O1m 9.72m 4O3.9892km', 'Pos: -0.01m 9.72m 403.9892km'],
    ['-54.153Ikm -54.153lkm', '-54.1531km -54.1531km'],
    ['SolarSystem_9O6775865828', 'SolarSystem_906775865828'],
    ['ab_mine_sml_OO1', 'ab_mine_sml_001'], // settles from the digit inwards
    ['Zone: OOC_Stanton_1_Hurston Pos:', 'Zone: OOC_Stanton_1_Hurston Pos:'],
    ['CamDir: 1 2 3 FOV: 55 Focal: 3.00 MISC', 'CamDir: 1 2 3 FOV: 55 Focal: 3.00 MISC'],
  ])('reads look-alikes in numbers as digits: %s', (read, meant) => {
    expect(digitsInNumbers(read)).toBe(meant)
  })
})

describe('DebugTextReader', () => {
  it('reads CamDir and Zone lines only', () => {
    const lines = new DebugTextReader([font]).read(whiteness(syntheticCorner(font, [...LINES, ...OTHER_LINES])))
    const texts = lines.map(l => l.text)
    expect(texts.slice(0, 5)).toEqual(LINES)
    // "CamPos Planet Zone: ..." holds "Zone:" too; it reads, but parses to nothing
    expect(texts.every(t => t.startsWith('CamDir:') || t.startsWith('Zone:'))).toBe(true)
    expect(Math.min(...lines.slice(0, 5).map(l => l.score))).toBeGreaterThan(0.8)
    expect(parsePosition(lines)?.zones).toHaveLength(4)
  })

  it('reads over a bright amber HUD', () => {
    const corner = syntheticCorner(font, LINES, { seed: 4, hud: true })
    expect(new DebugTextReader([font]).read(whiteness(corner)).map(l => l.text)).toEqual(LINES)
  })

  it("follows each line's grid phase", () => {
    // A fractional advance steps 9, 10, 9, 10 ... or 10, 9, 10, 9 ... px, depending on where the
    // right-aligned line starts; the real font is 7.5 px
    expect(frac.phases()).toEqual([0, 0.5])
    const corner = syntheticCorner(frac, LINES, { phases: [0, 0.5, 0.5, 0, 0.5] })
    expect(new DebugTextReader([frac]).read(whiteness(corner)).map(l => l.text)).toEqual(LINES)
  })

  it('finds nothing without text or font', () => {
    const reader = new DebugTextReader([font])
    expect(reader.read(whiteness(syntheticCorner(font, [])))).toEqual([])
    expect(reader.read({ width: 0, height: 0, data: new Uint8Array(0) })).toEqual([])
    const noFont = new DebugTextReader([])
    expect(noFont.usable).toBe(false)
    expect(noFont.read(whiteness(syntheticCorner(font, LINES)))).toEqual([])
  })

  it('skips a font that cannot spell the prefixes, and tries every font', () => {
    const digits = new DebugFont('digits', '0123456789', 9, 9, 15, Array.from({ length: 10 }, (_, i) => font.glyph(String(i))))
    expect(new DebugTextReader([digits]).usable).toBe(false)
    // The same chars with each glyph in another's place: usable, but reads nothing
    const shuffled = new DebugFont('shuffled', font.chars.join(''), 9, 9, 15, font.glyphs.map((_, i, all) => all[(i + 7) % all.length]))
    const reader = new DebugTextReader([shuffled, font])
    const white = whiteness(syntheticCorner(font, LINES))
    expect(reader.read(white).map(l => l.text)).toEqual(LINES)
    expect(reader.read(white).map(l => l.text)).toEqual(LINES) // the matching font is now tried first
  })
})

/** Crops of real 2560x1440 screenshots (JPEG, as the game saves them), read with the shipped font. */
describe.each([
  {
    crop: 'ship_over_pyro3', camDir: [103, -8, -15],
    zones: ['MISC_Prospector_915731471510', 'pyro3', 'SolarSystem_906775865828', 'Root'],
    local: ['pyro3', 174741.3, 557833.7, -5231.22],
  },
  {
    crop: 'on_foot_bright_sky', camDir: [93, 26, 132],
    zones: ['pyro3', 'SolarSystem_906775865828', 'Root'],
    local: ['pyro3', -71975.2, 403989.2, -54153.1],
  },
  {
    crop: 'asteroid_field', camDir: [-155, 45, -179],
    zones: ['MISC_Prospector_915731471510', 'ab_mine_pyro_regionb_sml_001', 'SolarSystem_906804011333', 'Root'],
    local: ['ab_mine_pyro_regionb_sml_001', -18874.3, -3354.15, 12639.6],
  },
])('the shipped font reads a real screenshot: $crop', ({ crop, camDir, zones, local }) => {
  const reader = new DebugTextReader(shippedFonts())
  const lines = reader.read(whiteness(readPngRgba(join(FIXTURES, 'debug_text', 'real', `${crop}.png`))))
  const position = parsePosition(lines)

  it('finds the position', () => {
    expect(reader.usable).toBe(true)
    expect(position).not.toBeNull()
    expect(position!.camDir).toEqual(camDir)
    expect(position!.zones.map(z => z.zone)).toEqual(zones)
    const z = localZone(position!)
    expect([z.zone, z.x, z.y, z.z]).toEqual(local)
    expect(positionConfidence(position!)).toBeGreaterThan(0.7)
  })

  it('reads what the desktop app reads', () => {
    expectSameReading(lines, `real/${crop}`)
  })
})

it('the shipped font reads a real screenshot in a whole 1440p corner, past a bright HUD', () => {
  const crop = readPngRgba(join(FIXTURES, 'debug_text', 'real', 'asteroid_field.png'))
  const corner = syntheticCorner(font, [], { seed: 9, hud: true }) // 1280×360, dark noise and amber shapes
  for (let y = 0; y < crop.height; y++) {
    corner.data.set(crop.data.subarray(y * crop.width * 4, (y + 1) * crop.width * 4), 4 * (y * corner.width + corner.width - crop.width))
  }
  const reader = new DebugTextReader(shippedFonts())
  const alone = parsePosition(reader.read(whiteness(crop)))
  const inCorner = parsePosition(reader.read(whiteness(corner)))
  expect(inCorner).toEqual(alone)
  expect(localZone(inCorner!).zone).toBe('ab_mine_pyro_regionb_sml_001')
})

/** What the desktop app's reader read in the same images (fixtures/debug_text/<name>.json). */
function expectSameReading(lines: { text: string; score: number; x: number; y: number }[], name: string) {
  const expected = JSON.parse(readFileSync(join(FIXTURES, 'debug_text', `${name}.json`), 'utf-8')) as {
    lines: { text: string; score: number; x: number; y: number }[]
    position: ShipPosition | null
  }
  expect(lines.map(({ text, x, y }) => ({ text, x, y }))).toEqual(expected.lines.map(({ text, x, y }) => ({ text, x, y })))
  lines.forEach((line, i) => expect(line.score).toBeCloseTo(expected.lines[i].score, 3))

  const position = parsePosition(lines)
  expect(position === null).toBe(expected.position === null)
  if (!position || !expected.position) return
  expect(position.camDir).toEqual(expected.position.camDir)
  const place = ({ index, zone, x, y, z }: ShipPosition['zones'][number]) => ({ index, zone, x, y, z })
  expect(position.zones.map(place)).toEqual(expected.position.zones.map(place))
  position.zones.forEach((z, i) => expect(z.confidence).toBeCloseTo(expected.position!.zones[i].confidence, 3))
}

describe.each(['synthetic', 'synthetic_frac'])('the same reading as the desktop app, %s font', name => {
  it('reads the same lines at the same places, and parses the same position', () => {
    const lines = new DebugTextReader([syntheticFont(name)]).read(readPng(join(FIXTURES, 'debug_text', `${name}.png`)))
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expectSameReading(lines, name)
  })
})

describe('DebugFont', () => {
  it('round-trips through its JSON and PNG strip', () => {
    const loaded = DebugFont.fromStrip('copy', font.meta(), font.strip())
    expect(loaded.chars).toEqual(font.chars)
    expect(loaded.advance).toBe(9)
    expect(loaded.glyphs).toEqual(font.glyphs)
    expect(font.source).toBe('test')
  })

  it('rejects glyphs that do not fit the cell size', () => {
    expect(() => DebugFont.fromStrip('short', font.meta(), { width: 90, height: 15, data: new Uint8Array(90 * 15) })).toThrow(/too small/)
    expect(() => new DebugFont('bad', 'ab', 9, 9, 15, [new Uint8Array(9 * 15)])).toThrow(/does not match/)
  })

  it('places cells on the grid phase like the desktop app', () => {
    expect([0, 1, 2, 3, 5].map(i => frac.cellX(i))).toEqual([0, 9, 19, 28, 47])
    expect([0, 1, 2, 3, 5].map(i => frac.cellX(i, 0.5))).toEqual([0, 10, 19, 29, 48])
    expect(phases(9)).toEqual([0])
    expect(phases(7.5)).toEqual([0, 0.5])
    expect(phases(7.25)).toEqual([0, 0.25, 0.5, 0.75])
    expect(font.render('Zone:').width).toBe(4 * 9 + 9)
    expect(frac.render('Zone:', 0, 0.5).width).toBe(38 + 9)
    expect([0.5, 1.5, 2.5, -2.5, -3.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, -2, -4, 2, 3])
  })
})

describe('shipped fonts', () => {
  it('are listed in public/display_info_font/index.json, load and can find the lines', () => {
    const fonts = shippedFonts()
    expect(fonts.map(f => f.name)).toContain('2560x1440')
    for (const f of fonts) expect(new DebugTextReader([f]).usable).toBe(true)
    const [real] = fonts
    expect([real.advance, real.cellW, real.cellH, real.chars.length]).toEqual([7.5, 7, 13, 48])
  })
})
