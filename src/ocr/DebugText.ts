/**
 * Reads the game's debug text (r_DisplayInfo) from the top-right corner of the screen.
 *
 * A port of the desktop app's `scanlake_core/vision/debug_text.py`; keep the two in step.
 *
 * The text is drawn in a fixed-width bitmap font, plain white with a dark shadow, right-aligned at
 * the top right; it never shakes, scales or glows. That makes an exact reader simple:
 *
 *   - a `DebugFont` holds one template per glyph, cut from real screenshots (the desktop repo's
 *     `scanlake-train font cut`), with the font's advance (cell pitch);
 *   - the line prefixes "CamDir:" and "Zone:" are found by template matching (first at half
 *     scale, then verified at full scale), which gives each line's position and grid phase (with a
 *     fractional advance such as 7.5 px the cells step 7, 8, 7, 8 ... or 8, 7, 8, 7 ... px,
 *     depending on where the right-aligned line starts);
 *   - every cell after a prefix is classified by normalised correlation against all glyphs;
 *   - inside numbers, the look-alikes O, I and l are read as 0 and 1.
 *
 * Only CamDir and Zone lines are read; the rest of the debug text (session, server, ...) is never
 * looked at. Images are compared by "whiteness" (the darkest of R, G, B), so the coloured HUD
 * behind the text counts as dark. Pure TypeScript on pixel arrays, no DOM, so it runs (and is
 * tested) outside a browser.
 */

export const PREFIXES = ['CamDir:', 'Zone:'] as const
/** What a cell with ink that matches no glyph reads as */
export const UNKNOWN = '?'

/** The searched corner: this share of the screen width, from the right ... */
export const CORNER_W = 0.5
/** ... and of its height, from the top */
export const CORNER_H = 0.25
/** Whiteness a glyph pixel reaches at least ... */
export const INK = 170
/** ... or how far it stands above its cell's median (a thin "_" may stay dim) */
export const INK_CONTRAST = 80
/** Correlation that makes a prefix match */
const PREFIX_MIN = 0.75
/** Below this a cell is UNKNOWN */
const GLYPH_MIN = 0.6
/** Blank cells in a row end a line ("CamDir: -155  45 -179" has two) */
const MAX_BLANK = 3
/** Unknown cells in a row end a line (we ran into the HUD) */
const MAX_UNKNOWN = 3
/** Prefixes are first looked for at 1/COARSE scale (cheap), then verified */
const COARSE = 2
/** Correlation that makes a coarse candidate (true: 0.5–0.85; verified after) */
const COARSE_MIN = 0.45

/** One channel, 0–255, row-major. */
export interface Plane {
  width: number
  height: number
  data: Uint8Array
}

interface FloatPlane {
  width: number
  height: number
  data: Float32Array
}

export interface TextLine {
  text: string
  /** Lowest glyph correlation of the line, 0..1 */
  score: number
  /** Top-left of the line's first cell in the read image */
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Python's round(): halves go to the even neighbour (scores and coordinates match the desktop app's). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

export function roundTo(x: number, places: number): number {
  const f = 10 ** places
  return roundHalfEven(x * f) / f
}

/** The screen corner the debug text sits in, for a screen of that size. */
export function cornerRect(width: number, height: number): Rect {
  const w = Math.trunc(width * CORNER_W)
  const h = Math.trunc(height * CORNER_H)
  return { x: width - w, y: 0, width: w, height: h }
}

/** Per pixel the darkest of R, G, B: white text stays bright, coloured HUD does not. */
export function whiteness(image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): Plane {
  const n = image.width * image.height
  const out = new Uint8Array(n)
  const d = image.data
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const r = d[o], g = d[o + 1], b = d[o + 2]
    out[i] = r < g ? (r < b ? r : b) : (g < b ? g : b)
  }
  return { width: image.width, height: image.height, data: out }
}

/** What a font's `<name>.json` holds; `<name>.png` holds the glyphs side by side. */
export interface DebugFontMeta {
  chars: string
  advance: number
  cell_w: number
  cell_h: number
  source?: string
}

/**
 * Glyph templates of one size of the debug font.
 *
 * Stored as `<name>.json` (chars, advance, cell size, where it was cut) plus `<name>.png`: the
 * glyphs' whiteness side by side, `cell_w` pixels each, in `chars` order.
 */
export class DebugFont {
  readonly name: string
  readonly chars: string[]
  /** px from one cell to the next */
  readonly advance: number
  readonly cellW: number
  readonly cellH: number
  /** One whiteness array (cellH × cellW) per char */
  readonly glyphs: Uint8Array[]
  /** e.g. "2560x1440": where the glyphs were cut */
  readonly source: string

  constructor(name: string, chars: string, advance: number, cellW: number, cellH: number, glyphs: Uint8Array[], source = '') {
    this.name = name
    this.chars = Array.from(chars)
    this.advance = advance
    this.cellW = cellW
    this.cellH = cellH
    this.glyphs = glyphs
    this.source = source
    if (glyphs.length !== this.chars.length || glyphs.some(g => g.length !== cellW * cellH)) {
      throw new Error(`font ${name}: glyph array does not match chars/cell size`)
    }
  }

  /** A font from its JSON and its PNG strip (whiteness, one channel). */
  static fromStrip(name: string, meta: DebugFontMeta, strip: Plane): DebugFont {
    const chars = Array.from(meta.chars)
    const w = Math.trunc(meta.cell_w), h = Math.trunc(meta.cell_h)
    if (strip.width < chars.length * w || strip.height < h) {
      throw new Error(`font ${name}: the glyph strip is ${strip.width}×${strip.height}, too small`)
    }
    const glyphs = chars.map((_, i) => {
      const g = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) g.set(strip.data.subarray(y * strip.width + i * w, y * strip.width + (i + 1) * w), y * w)
      return g
    })
    return new DebugFont(name, meta.chars, Number(meta.advance), w, h, glyphs, meta.source ?? '')
  }

  /** The JSON half of this font (the PNG half is `strip()`). */
  meta(): DebugFontMeta {
    return { chars: this.chars.join(''), advance: this.advance, cell_w: this.cellW, cell_h: this.cellH, source: this.source }
  }

  /** The glyphs side by side, as stored in `<name>.png`. */
  strip(): Plane {
    const w = this.cellW, h = this.cellH, width = w * this.glyphs.length
    const data = new Uint8Array(width * h)
    this.glyphs.forEach((g, i) => {
      for (let y = 0; y < h; y++) data.set(g.subarray(y * w, (y + 1) * w), y * width + i * w)
    })
    return { width, height: h, data }
  }

  glyph(char: string): Uint8Array {
    const i = this.chars.indexOf(char)
    if (i < 0) throw new Error(`font ${this.name} has no glyph for ${JSON.stringify(char)}`)
    return this.glyphs[i]
  }

  /** Left edge of cell `i` of a line whose first cell starts `phase` px into a pixel. */
  cellX(i: number, phase = 0): number {
    return Math.floor(phase + i * this.advance)
  }

  phases(): number[] {
    return phases(this.advance)
  }

  /** `text` in this font (whiteness); unknown characters and spaces stay background. */
  render(text: string, background = 0, phase = 0): Plane {
    const chars = Array.from(text)
    const width = chars.length ? this.cellX(chars.length - 1, phase) + this.cellW : 0
    const data = new Uint8Array(width * this.cellH).fill(background)
    chars.forEach((char, i) => {
      if (char === ' ' || !this.chars.includes(char)) return
      const g = this.glyph(char), x = this.cellX(i, phase)
      for (let y = 0; y < this.cellH; y++) data.set(g.subarray(y * this.cellW, (y + 1) * this.cellW), y * width + x)
    })
    return { width, height: this.cellH, data }
  }
}

/**
 * The sub-pixel starts that give a line of cells a different pattern of whole-pixel steps: only 0
 * for a whole-pixel advance; 0 and 0.5 for 7.5 px; four for quarter pixels.
 */
export function phases(advance: number): number[] {
  const found = new Map<string, number>()
  for (const phase of [0, 0.25, 0.5, 0.75]) {
    const key = Array.from({ length: 8 }, (_, i) => Math.floor(phase + i * advance)).join(',')
    if (!found.has(key)) found.set(key, phase)
  }
  return [...found.values()]
}

const AS_DIGIT: Record<string, string> = { O: '0', I: '1', l: '1' }
const NUMERIC_LEFT = new Set('0123456789.-')
const NUMERIC_RIGHT = new Set('0123456789.')

/**
 * O, I and l next to a digit (or after a minus or point) become 0 and 1: at this size the font
 * draws them almost alike, and the debug text is mostly numbers. Names keep their letters
 * ("OOC_Stanton" stays as it is).
 */
export function digitsInNumbers(text: string): string {
  const chars = Array.from(text)
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < chars.length; i++) {
      const digit = AS_DIGIT[chars[i]]
      if (!digit) continue
      const left = i ? chars[i - 1] : ''
      const right = i + 1 < chars.length ? chars[i + 1] : ''
      if (NUMERIC_LEFT.has(left) || NUMERIC_RIGHT.has(right)) {
        chars[i] = digit
        changed = true
      }
    }
  }
  return chars.join('')
}

// ── image helpers ───────────────────────────────────────────────────────────

function toFloat(p: Plane): FloatPlane {
  return { width: p.width, height: p.height, data: Float32Array.from(p.data) }
}

/** Source spans of each output pixel for an area (box) resize from n to m pixels. */
function areaTable(n: number, m: number): { start: number; weights: number[] }[] {
  const s = n / m
  const out: { start: number; weights: number[] }[] = []
  for (let i = 0; i < m; i++) {
    const a = i * s, b = Math.min(n, (i + 1) * s)
    const start = Math.floor(a)
    const weights: number[] = []
    for (let j = start; j < b; j++) weights.push((Math.min(j + 1, b) - Math.max(j, a)) / s)
    out.push({ start, weights })
  }
  return out
}

/** Shrunk by COARSE, averaging each output pixel's area (OpenCV's INTER_AREA). */
function shrink(p: FloatPlane): FloatPlane {
  const w = Math.max(1, Math.trunc(p.width / COARSE)), h = Math.max(1, Math.trunc(p.height / COARSE))
  const tx = areaTable(p.width, w), ty = areaTable(p.height, h)
  const rows = new Float32Array(w * p.height)
  for (let y = 0; y < p.height; y++) {
    const r = y * p.width
    for (let x = 0; x < w; x++) {
      const { start, weights } = tx[x]
      let v = 0
      for (let k = 0; k < weights.length; k++) v += p.data[r + start + k] * weights[k]
      rows[y * w + x] = v
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const { start, weights } = ty[y]
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = 0; k < weights.length; k++) v += rows[(start + k) * w + x] * weights[k]
      out[y * w + x] = v
    }
  }
  return { width: w, height: h, data: out }
}

function crop(p: FloatPlane, x: number, y: number, width: number, height: number): FloatPlane {
  const w = Math.max(0, Math.min(width, p.width - x)), h = Math.max(0, Math.min(height, p.height - y))
  const data = new Float32Array(w * h)
  for (let r = 0; r < h; r++) data.set(p.data.subarray((y + r) * p.width + x, (y + r) * p.width + x + w), r * w)
  return { width: w, height: h, data }
}

/**
 * TM_CCOEFF_NORMED of `t` at every position in `img` where it fits, (W−tw+1)×(H−th+1), with
 * OpenCV's handling of flat windows (score 0).
 */
function matchTemplate(img: FloatPlane, t: FloatPlane): FloatPlane {
  const tw = t.width, th = t.height, n = tw * th
  const rw = img.width - tw + 1, rh = img.height - th + 1
  const out = new Float32Array(Math.max(0, rw) * Math.max(0, rh))
  if (rw <= 0 || rh <= 0) return { width: Math.max(0, rw), height: Math.max(0, rh), data: out }

  let mean = 0
  for (let i = 0; i < n; i++) mean += t.data[i]
  mean /= n
  const zm = new Float32Array(n)
  let tnorm = 0
  for (let i = 0; i < n; i++) {
    zm[i] = t.data[i] - mean
    tnorm += zm[i] * zm[i]
  }
  tnorm = Math.sqrt(tnorm)
  if (tnorm < 1e-12) return { width: rw, height: rh, data: out.fill(1) }

  // Summed-area tables of the pixels and their squares, (W+1)×(H+1)
  const stride = img.width + 1
  const sum = new Float64Array(stride * (img.height + 1))
  const sq = new Float64Array(stride * (img.height + 1))
  const d = img.data, W = img.width
  for (let y = 0; y < img.height; y++) {
    let rs = 0, rq = 0
    for (let x = 0; x < W; x++) {
      const v = d[y * W + x]
      rs += v
      rq += v * v
      const i = (y + 1) * stride + x + 1
      sum[i] = sum[i - stride] + rs
      sq[i] = sq[i - stride] + rq
    }
  }

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let cross = 0
      for (let ty = 0; ty < th; ty++) {
        const io = (y + ty) * W + x, to = ty * tw
        for (let tx = 0; tx < tw; tx++) cross += zm[to + tx] * d[io + tx]
      }
      const a = y * stride + x, b = a + tw, c = a + th * stride, e = c + tw
      const s = sum[e] - sum[b] - sum[c] + sum[a]
      const q = sq[e] - sq[b] - sq[c] + sq[a]
      const norm = Math.sqrt(Math.max(q - (s * s) / n, 0)) * tnorm
      const abs = Math.abs(cross)
      out[y * rw + x] = abs < norm ? cross / norm : abs < norm * 1.125 ? Math.sign(cross) : 0
    }
  }
  return { width: rw, height: rh, data: out }
}

/** Grey dilation with a kw×kh rectangle anchored at its centre (cv2.dilate). */
function dilate(p: FloatPlane, kw: number, kh: number): Float32Array {
  const { width: w, height: h } = p
  const ax = kw >> 1, ay = kh >> 1
  const rows = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = -Infinity
      for (let xx = Math.max(0, x - ax); xx <= Math.min(w - 1, x - ax + kw - 1); xx++) m = Math.max(m, p.data[y * w + xx])
      rows[y * w + x] = m
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = -Infinity
      for (let yy = Math.max(0, y - ay); yy <= Math.min(h - 1, y - ay + kh - 1); yy++) m = Math.max(m, rows[yy * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

/** (x, y) of the template's local best matches above `minimum`, at most one per line. */
function peaks(image: FloatPlane, template: FloatPlane, cellH: number, minimum: number): [number, number][] {
  const th = template.height, tw = template.width
  if (image.height < th || image.width < tw) return []
  const result = matchTemplate(image, template)
  const localMax = dilate(result, Math.max(3, tw), Math.max(3, cellH))
  const hits: { x: number; y: number; score: number }[] = []
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const score = result.data[y * result.width + x]
      if (score >= minimum && score >= localMax[y * result.width + x]) hits.push({ x, y, score })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  const kept: [number, number][] = []
  const minDy = Math.max(1, cellH >> 1)
  for (const { x, y } of hits) {
    if (kept.every(([kx, ky]) => Math.abs(y - ky) >= minDy || Math.abs(x - kx) >= tw)) kept.push([x, y])
  }
  return kept
}

interface PhaseTemplate {
  phase: number
  template: FloatPlane
}

interface Hit {
  x: number
  y: number
  phase: number
}

/**
 * (x, y, phase) of the prefix's matches in `white`: candidates found at 1/COARSE scale, each
 * verified and placed exactly at full scale with the grid phase that fits best.
 */
function find(white: FloatPlane, small: FloatPlane, templates: PhaseTemplate[], coarse: FloatPlane, cellH: number): Hit[] {
  const th = templates[0].template.height
  const tw = Math.max(...templates.map(t => t.template.width))
  const margin = 2 * COARSE
  const found: Hit[] = []
  for (const [cx, cy] of peaks(small, coarse, Math.max(1, Math.trunc(cellH / COARSE)), COARSE_MIN)) {
    const x0 = Math.max(0, cx * COARSE - margin), y0 = Math.max(0, cy * COARSE - margin)
    const window = crop(white, x0, y0, tw + 2 * margin, th + 2 * margin)
    if (window.height < th || window.width < tw) continue
    let best = -1, bx = 0, by = 0, bphase = 0
    for (const { phase, template } of templates) {
      // The first maximum, scanning rows (cv2.minMaxLoc)
      const result = matchTemplate(window, template)
      let score = -Infinity, dx = 0, dy = 0
      for (let y = 0; y < result.height; y++) {
        for (let x = 0; x < result.width; x++) {
          const v = result.data[y * result.width + x]
          if (v > score) { score = v; dx = x; dy = y }
        }
      }
      if (score > best) { best = score; bx = dx; by = dy; bphase = phase }
    }
    const x = x0 + bx, y = y0 + by
    if (best >= PREFIX_MIN && !found.some(f => f.x === x && f.y === y)) found.push({ x, y, phase: bphase })
  }
  return found
}

/** A cell has ink when a pixel is white, or stands well above the cell's median (a dim "_"). */
function hasInk(white: Plane, x0: number, y0: number, w: number, h: number): boolean {
  const counts = new Uint32Array(256)
  let top = 0
  for (let y = 0; y < h; y++) {
    const r = (y0 + y) * white.width + x0
    for (let k = 0; k < w; k++) {
      const v = white.data[r + k]
      counts[v]++
      if (v > top) top = v
    }
  }
  if (top >= INK) return true
  // np.median: the middle value, or the mean of the two middle ones (truncated like int())
  const n = w * h
  const at = (rank: number): number => {
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += counts[v]
      if (seen > rank) return v
    }
    return 255
  }
  const median = n % 2 ? at((n - 1) >> 1) : (at(n / 2 - 1) + at(n / 2)) / 2
  return top - Math.trunc(median) >= INK_CONTRAST
}

/** A row made zero-mean and unit-length (for correlation by dot product), and its norm. */
function unitRow(values: ArrayLike<number>): { unit: Float32Array; norm: number } {
  const n = values.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += values[i]
  mean /= n
  const unit = new Float32Array(n)
  let norm = 0
  for (let i = 0; i < n; i++) {
    unit[i] = values[i] - mean
    norm += unit[i] * unit[i]
  }
  norm = Math.sqrt(norm)
  const scale = 1 / Math.max(norm, 1e-6)
  for (let i = 0; i < n; i++) unit[i] *= scale
  return { unit, norm }
}

// ── reader ──────────────────────────────────────────────────────────────────

interface Prepared {
  font: DebugFont
  /** Glyphs, zero-mean unit rows */
  unit: Float32Array[]
  /** Per prefix: its whiteness at every grid phase of the font */
  prefixes: Map<string, PhaseTemplate[]>
  /** Per prefix: phase 0 at 1/COARSE */
  coarse: Map<string, FloatPlane>
}

/** Reads CamDir and Zone lines; tries each font, the last one that matched first. */
export class DebugTextReader {
  private fonts: Prepared[] = []

  constructor(fonts: DebugFont[]) {
    for (const font of fonts) {
      if (!PREFIXES.every(p => Array.from(p).every(c => font.chars.includes(c)))) continue // cannot even find the lines
      const prefixes = new Map(PREFIXES.map(p => [
        p, font.phases().map(phase => ({ phase, template: toFloat(font.render(p, 0, phase)) })),
      ] as const))
      const coarse = new Map([...prefixes].map(([p, t]) => [p, shrink(t[0].template)] as const))
      this.fonts.push({ font, unit: font.glyphs.map(g => unitRow(g).unit), prefixes, coarse })
    }
  }

  get usable(): boolean {
    return this.fonts.length > 0
  }

  /** The CamDir and Zone lines in `white` (the whiteness of the debug-text corner), top first. */
  read(white: Plane): TextLine[] {
    if (!this.fonts.length || white.width === 0 || white.height === 0) return []
    let max = 0
    for (let i = 0; i < white.data.length; i++) if (white.data[i] > max) max = white.data[i]
    if (max < INK) return []
    const whiteF = toFloat(white)
    const small = shrink(whiteF)
    for (let i = 0; i < this.fonts.length; i++) {
      const lines = this.readWith(this.fonts[i], white, whiteF, small)
      if (lines.length) {
        if (i) this.fonts.unshift(...this.fonts.splice(i, 1))
        return lines
      }
    }
    return []
  }

  private readWith(p: Prepared, white: Plane, whiteF: FloatPlane, small: FloatPlane): TextLine[] {
    const hits: (Hit & { prefix: string })[] = []
    for (const prefix of PREFIXES) {
      for (const hit of find(whiteF, small, p.prefixes.get(prefix)!, p.coarse.get(prefix)!, p.font.cellH)) {
        hits.push({ ...hit, prefix })
      }
    }
    hits.sort((a, b) => a.y - b.y || a.x - b.x || a.phase - b.phase || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0))
    const lines: TextLine[] = []
    for (const { x, y, phase, prefix } of hits) {
      if (lines.length && Math.abs(lines[lines.length - 1].y - y) < p.font.cellH >> 1) continue // "CamDir:" and "Zone:" on the same row: keep the first
      const [rest, score] = this.line(p, white, x, y, prefix.length, phase)
      lines.push({ text: digitsInNumbers(prefix + rest), score, x, y })
    }
    return lines
  }

  /**
   * Text of the cells after a prefix, and the lowest glyph correlation among them.
   *
   * Cells sit at the line's grid phase. Each is classified against every glyph, at −1, 0 and +1 px
   * when the advance is fractional (to absorb its rounding); the line ends at a run of blank or
   * unknown cells.
   */
  private line(p: Prepared, white: Plane, x0: number, y0: number, start: number, phase: number): [string, number] {
    const font = p.font
    const h = font.cellH, w = font.cellW, W = white.width
    if (y0 + h > white.height) return ['', 0]
    const xs: number[] = []
    for (let i = start; x0 + font.cellX(i, phase) + w <= W; i++) xs.push(x0 + font.cellX(i, phase))
    if (!xs.length) return ['', 0]
    // A whole-pixel advance puts every cell exactly; a fractional one may round either way
    const offsets = Number.isInteger(font.advance) ? [0] : [-1, 0, 1]
    const patch = new Float32Array(w * h)

    /** Best glyph and its score; the band is padded with its edge columns for the ±1 px offsets. */
    const classify = (x: number): [number, number] => {
      const perGlyph = new Float32Array(p.unit.length).fill(-Infinity)
      for (const d of offsets) {
        for (let y = 0; y < h; y++) {
          const r = (y0 + y) * W
          for (let k = 0; k < w; k++) patch[y * w + k] = white.data[r + Math.min(W - 1, Math.max(0, x + d + k))]
        }
        const { unit, norm } = unitRow(patch)
        for (let g = 0; g < p.unit.length; g++) {
          let score = -1
          if (norm >= 1e-3) {
            const gu = p.unit[g]
            score = 0
            for (let k = 0; k < gu.length; k++) score += gu[k] * unit[k]
          }
          if (score > perGlyph[g]) perGlyph[g] = score
        }
      }
      let best = 0
      for (let g = 1; g < perGlyph.length; g++) if (perGlyph[g] > perGlyph[best]) best = g
      return [best, perGlyph[best]]
    }

    const chars: string[] = []
    let lowest = 1
    let blanks = 0, unknowns = 0
    for (const x of xs) {
      if (!hasInk(white, x, y0, w, h)) {
        chars.push(' ')
        blanks += 1
        unknowns = 0
        if (blanks >= MAX_BLANK) break
        continue
      }
      blanks = 0
      const [glyph, score] = classify(x)
      const known = Number.isFinite(score) && score >= GLYPH_MIN
      chars.push(known ? font.chars[glyph] : UNKNOWN)
      unknowns = known ? 0 : unknowns + 1
      if (unknowns >= MAX_UNKNOWN) {
        chars.splice(-unknowns)
        break
      }
      lowest = Math.min(lowest, Number.isFinite(score) ? score : 0)
    }
    return [chars.join('').trimEnd(), Math.max(0, roundTo(lowest, 4))]
  }
}
