import { DebugFont, DebugTextReader, whiteness, type DebugFontMeta, type TextLine } from './DebugText'
import { parsePosition, PositionTracker, type ShipPosition } from './ShipPosition'

/**
 * Reads the ship position from the debug-text corner of captured frames.
 *
 * Fonts are copied from the desktop repo into public/display_info_font/ (`npm run sync-debug-font`):
 * `index.json` lists them, each is a `<name>.json` plus `<name>.png`. Without a font nothing is
 * read and captures carry no position.
 */

const FONT_DIR = '/display_info_font'

/** The last position read; shared by all captures of this page. */
export const positionTracker = new PositionTracker()

let readerPromise: Promise<DebugTextReader> | null = null
let failed = false

export async function loadShippedFonts(): Promise<DebugFont[]> {
  const res = await fetch(`${FONT_DIR}/index.json`)
  if (!res.ok) return []
  const { fonts = [] } = (await res.json()) as { fonts?: string[] }
  const loaded = await Promise.all(fonts.map(name => loadFont(name).catch(err => {
    console.warn(`Debug font ${name} not loaded:`, err)
    return null
  })))
  return loaded.filter((f): f is DebugFont => f !== null)
}

async function loadFont(name: string): Promise<DebugFont> {
  const meta = (await (await fetch(`${FONT_DIR}/${name}.json`)).json()) as DebugFontMeta
  const png = await fetch(`${FONT_DIR}/${name}.png`)
  if (!png.ok) throw new Error(`${name}.png: ${png.status}`)
  // Exact pixel values: no colour management, no premultiplication
  const bitmap = await createImageBitmap(await png.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const { width, height } = bitmap // 0×0 once closed
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const rgba = ctx.getImageData(0, 0, width, height).data
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[4 * i] // a grayscale PNG decodes to R = G = B
  return DebugFont.fromStrip(name, meta, { width, height, data: gray })
}

function reader(): Promise<DebugTextReader> {
  readerPromise ??= loadShippedFonts()
    .catch(err => {
      console.warn('Debug fonts not loaded, ship positions are off:', err)
      return []
    })
    .then(fonts => new DebugTextReader(fonts))
  return readerPromise
}

/** Whether a debug font is available (loads the fonts on first use). */
export async function positionReadingAvailable(): Promise<boolean> {
  return (await reader()).usable
}

export interface DebugTextReading {
  /** A debug font is shipped (without one nothing is read) */
  available: boolean
  /** The CamDir and Zone lines read, top first */
  lines: TextLine[]
  /** What they parse to (null: no Zone line read) */
  position: ShipPosition | null
}

/**
 * Reads the debug-text corner of a frame captured at `at` (ms); a position read is kept as the
 * last one. Failures never stop a capture.
 */
export async function readDebugText(corner: ImageData | null, at: number): Promise<DebugTextReading> {
  const r = await reader()
  const reading: DebugTextReading = { available: r.usable, lines: [], position: null }
  if (!corner || !r.usable) return reading
  try {
    reading.lines = r.read(whiteness(corner))
    reading.position = parsePosition(reading.lines)
    positionTracker.observe(reading.position, at)
    failed = false
  } catch (err) {
    if (!failed) console.warn('Reading the debug text failed:', err)
    failed = true
  }
  return reading
}

/**
 * The position a scan staged from a frame captured at `at` (ms) takes: the one read in its corner,
 * or the last one read if it is still fresh.
 */
export async function readShipPosition(corner: ImageData | null, at: number): Promise<ShipPosition | null> {
  await readDebugText(corner, at)
  return positionTracker.fresh(at)
}
