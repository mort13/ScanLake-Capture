import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { DebugFont, type DebugFontMeta, type Plane } from '../src/ocr/DebugText'

export const FIXTURES = join(import.meta.dirname, 'fixtures')

/** The debug text of the desktop app's tests: what r_DisplayInfo shows while mining. */
export const LINES = [
  'CamDir: -155  45 -179 FOV: 60 Focal: 3.00 FStop: 64.0',
  'Zone: MISC_Prospector_915731471510 Pos: -0.01m 9.72m 0.41m',
  'Zone: ab_mine_pyro_regionb_sml_001 Pos: -18.8743km -3354.15m 12.6396km',
  'Zone: SolarSystem_906804811333 Pos: -14427194.5960km 7825291.9814km -14901.0881km',
  'Zone: Root Pos: -14427194.5960km 7825291.9814km -14901.0881km',
]
export const OTHER_LINES = ['FPS 59.9 [46..60] - 16.7ms', 'CamPos Planet Zone: -613612390.421000 1578334280.3']

/** The first channel of an 8-bit, non-interlaced PNG (enough for the fixtures OpenCV writes). */
export function readPng(path: string): Plane {
  const { width, height, data } = readPngRgba(path)
  return { width, height, data: Uint8Array.from({ length: width * height }, (_, i) => data[4 * i]) }
}

/** An 8-bit, non-interlaced PNG as RGBA (gray is copied to R, G and B), like canvas ImageData. */
export function readPngRgba(path: string): Rgba {
  const buf = readFileSync(path)
  let width = 0, height = 0, channels = 0, colorType = 0
  const idat: Buffer[] = []
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${path}: only 8-bit, non-interlaced PNGs`)
      colorType = data[9]
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  const gray = colorType === 0 || colorType === 4
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0
      let pred = 0
      if (filter === 1) pred = a
      else if (filter === 2) pred = b
      else if (filter === 3) pred = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = (line[i] + pred) & 255
    }
    for (let x = 0; x < width; x++) {
      const o = 4 * (y * width + x), s = x * channels
      out[o] = cur[s]
      out[o + 1] = gray ? cur[s] : cur[s + 1]
      out[o + 2] = gray ? cur[s] : cur[s + 2]
      out[o + 3] = 255
    }
    prev = cur
  }
  return { width, height, data: out }
}

/** A font as stored on disk (`<name>.json` + `<name>.png`). */
export function loadFont(folder: string, name: string): DebugFont {
  const meta = JSON.parse(readFileSync(join(folder, `${name}.json`), 'utf-8')) as DebugFontMeta
  return DebugFont.fromStrip(name, meta, readPng(join(folder, `${name}.png`)))
}

/** The desktop tests' synthetic font: Hershey glyphs in 9×15 cells with a dim shadow, 9 px advance. */
export function syntheticFont(name = 'synthetic'): DebugFont {
  return loadFont(join(FIXTURES, 'debug_font'), name)
}

export const SHIPPED_FONTS = join(import.meta.dirname, '../public/display_info_font')

/** The fonts the app ships (public/display_info_font/, copied from the desktop repo). */
export function shippedFonts(): DebugFont[] {
  const { fonts } = JSON.parse(readFileSync(join(SHIPPED_FONTS, 'index.json'), 'utf-8')) as { fonts: string[] }
  return fonts.map(name => loadFont(SHIPPED_FONTS, name))
}

/** Deterministic 0..1 numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * The debug-text corner of a dark, noisy screen (RGBA) with `lines` right-aligned at its top
 * right, like the game draws them, each at its grid phase from `phases` (0 for the rest); `hud`
 * adds bright amber HUD shapes behind and beside the text.
 */
export function syntheticCorner(
  font: DebugFont,
  lines: string[],
  { width = 1280, height = 360, seed = 1, hud = false, phases = [] as number[] } = {},
): Rgba {
  const random = rng(seed)
  const n = width * height
  const data = new Uint8ClampedArray(n * 4)
  for (let c = 0; c < 3; c++) {
    let plane: Float32Array = Float32Array.from({ length: n }, () => Math.floor(random() * 90))
    for (let pass = 0; pass < 2; pass++) plane = boxBlur(plane, width, height, 2)
    for (let i = 0; i < n; i++) data[4 * i + c] = plane[i]
  }
  for (let i = 0; i < n; i++) data[4 * i + 3] = 255
  if (hud) {
    // Amber (whiteness 0) bars and a block under the text: bright, but not white
    const amber = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < Math.min(height, y0 + h); y++) {
        for (let x = x0; x < Math.min(width, x0 + w); x++) {
          const o = 4 * (y * width + x)
          data[o] = 255; data[o + 1] = 176; data[o + 2] = 0
        }
      }
    }
    for (let k = 0; k < 6; k++) amber(40 + k * 30, 20 + k * 25, 120, 3)
    amber(width - 300, 0, 120, 140)
  }
  lines.forEach((text, k) => {
    const image = font.render(text, 0, phases[k] ?? 0)
    const y0 = 4 + k * 16, x0 = width - 6 - image.width
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const v = image.data[y * image.width + x]
        if (v === 0) continue
        const o = 4 * ((y0 + y) * width + x0 + x)
        data[o] = data[o + 1] = data[o + 2] = v
      }
    }
  })
  return { width, height, data }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, k = 0
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        if (xx >= 0 && xx < w) { s += src[y * w + xx]; k++ }
      }
      tmp[y * w + x] = s / k
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, k = 0
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; k++ }
      }
      out[y * w + x] = s / k
    }
  }
  return out
}
