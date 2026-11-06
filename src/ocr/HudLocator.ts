import type { AnchorConfig, AnchorMatch, SubAnchorConfig } from './types'
import type { AnchorNearMiss, AffineTransform } from './AnchorDetector'
import { applyTransform } from './AnchorDetector'

/**
 * Finds a profile's HUD anchors at any screen resolution, aspect ratio and HUD scale.
 *
 * The HUD's size on screen is not a fixed function of the resolution (it moves with the game's
 * FOV and differs per ship), so instead of a short list of preset scales this searches template
 * scales from 0.45 (≈650p) to 3.0 (≈4320p), most likely first, then refines the best one to 1 %:
 *
 *   track   — the anchors near where the last capture found them, at that scale (one cheap pass)
 *   coarse  — each candidate scale on a shrunken frame, so a pass costs the same at 720p and 4K
 *   refine  — ±1–4 % around the best candidate, full resolution, small windows around its hits
 *
 * A candidate only counts when its anchors sit where the profile says they should relative to
 * each other (similar spacing, no rotation): a few chance matches on random scenery always
 * correlate *somewhere*, but not in the HUD's shape.
 *
 * Matching is TM_CCOEFF_NORMED (the desktop app's OpenCV call) with window sums from integral
 * images. Pure TypeScript on grayscale arrays, no DOM, so it runs (and is tested) outside a browser.
 */

/** Grayscale pixels (0–255), row-major. */
export interface GrayImage {
  width: number
  height: number
  data: Float32Array
}

/** Where a successful capture found the HUD; the next capture on a frame of the same size starts there. */
export interface HudTrack {
  scale: number
  positions: Record<string, { x: number; y: number }>
}

export interface HudResult {
  found: boolean
  /** Template scale (template px × scale = frame px) of the result, or of the best failed attempt */
  scale: number
  /** Anchors that matched, top-left in frame coordinates */
  matches: AnchorMatch[]
  /** The other anchors' best positions and scores */
  nearMisses: AnchorNearMiss[]
  track: HudTrack | null
  /** Scales tried (diagnostics) */
  tried: number
}

export interface HudSearchOptions {
  /** Template scales to try first, most likely first (e.g. the remembered one, frame height / 1440) */
  hints?: number[]
  /** Only sweep scales within this factor of the first hint (default: the whole range) */
  span?: number
  track?: HudTrack | null
  onProgress?: (stage: string) => void
}

interface Rect { x: number; y: number; width: number; height: number }

const round4 = (s: number) => Math.round(s * 10000) / 10000

export const SWEEP_MIN = 0.45
export const SWEEP_MAX = 3.0
/** Candidate scales 8 % apart: a template 4 % off its true scale still correlates well. */
export const SWEEP_SCALES: readonly number[] = (() => {
  const out: number[] = []
  for (let s = SWEEP_MIN; s <= SWEEP_MAX * 1.0001; s *= 1.08) out.push(round4(s))
  return out
})()
/** The coarse pass shrinks frame and templates until the templates are at most this scale. */
const COARSE_SCALE = 0.5
/** Below the anchor's own threshold: the coarse pass is approximate, the refine pass decides. */
const COARSE_SLACK = 0.1
/** A coarse candidate this good on every anchor ends the sweep. */
const STRONG = 0.7
/** Once a plausible candidate exists, scales further than this factor from it are not tried. */
const SWEEP_SPAN = 1.25
const REFINE_STEPS = [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03, -0.04, 0.04]
const TRACK_PADDING = 30 // px at scale 1, around the last positions
const MAX_ROTATION_DEG = 5
/** Anchor spacing scale / template scale. Not 1: profiles' reference positions are not at the templates' scale (≈1.1 for the Prospector). */
const SPACING_RATIO_MIN = 0.75
const SPACING_RATIO_MAX = 1.35
const MAX_RESIDUAL = 3 // px at spacing scale 1, RMS of the similarity fit (3+ anchors)
/**
 * Two anchors alone fix a similarity transform but cannot confirm it, so both must match well:
 * chance pairs on HUD-less frames scored 0.51–0.78, real HUDs give every anchor 0.76+.
 */
const PAIR_MIN = 0.7

// ── images ──────────────────────────────────────────────────────────────────

export function toGray(image: { width: number; height: number; data: Uint8ClampedArray }): GrayImage {
  const n = image.width * image.height
  const out = new Float32Array(n)
  const d = image.data
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    out[i] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]
  }
  return { width: image.width, height: image.height, data: out }
}

/** Resized by `scale`: 2×2 box halving while shrinking by 2× or more, bilinear for the rest. */
export function resizeGray(src: GrayImage, scale: number): GrayImage {
  if (Math.abs(scale - 1) < 1e-6) return src
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  let img = src
  while (img.width >= 2 * w && img.height >= 2 * h) img = halve(img)
  return img.width === w && img.height === h ? img : bilinear(img, w, h)
}

function halve(src: GrayImage): GrayImage {
  const w = src.width >> 1, h = src.height >> 1
  const out = new Float32Array(w * h)
  const s = src.data, sw = src.width
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * sw, r1 = r0 + sw
    for (let x = 0; x < w; x++) {
      const c = 2 * x
      out[y * w + x] = (s[r0 + c] + s[r0 + c + 1] + s[r1 + c] + s[r1 + c + 1]) * 0.25
    }
  }
  return { width: w, height: h, data: out }
}

/** Pixel-centre aligned like OpenCV's INTER_LINEAR. */
function bilinear(src: GrayImage, w: number, h: number): GrayImage {
  const out = new Float32Array(w * h)
  const s = src.data, sw = src.width, sh = src.height
  const fx = sw / w, fy = sh / h
  const x0s = new Int32Array(w), x1s = new Int32Array(w), axs = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5))
    x0s[x] = Math.floor(sx)
    x1s[x] = Math.min(sw - 1, x0s[x] + 1)
    axs[x] = sx - x0s[x]
  }
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5))
    const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), ay = sy - y0
    const r0 = y0 * sw, r1 = y1 * sw
    for (let x = 0; x < w; x++) {
      const a = axs[x], x0 = x0s[x], x1 = x1s[x]
      const top = s[r0 + x0] + (s[r0 + x1] - s[r0 + x0]) * a
      const bot = s[r1 + x0] + (s[r1 + x1] - s[r1 + x0]) * a
      out[y * w + x] = top + (bot - top) * ay
    }
  }
  return { width: w, height: h, data: out }
}

// ── matching ────────────────────────────────────────────────────────────────

/** Summed-area tables of the pixels and their squares, (w+1)×(h+1). */
interface Integral { stride: number; sum: Float64Array; sq: Float64Array }

function integral(img: GrayImage): Integral {
  const stride = img.width + 1
  const sum = new Float64Array(stride * (img.height + 1))
  const sq = new Float64Array(stride * (img.height + 1))
  const d = img.data
  for (let y = 0; y < img.height; y++) {
    let rs = 0, rq = 0
    for (let x = 0; x < img.width; x++) {
      const v = d[y * img.width + x]
      rs += v
      rq += v * v
      const i = (y + 1) * stride + x + 1
      sum[i] = sum[i - stride] + rs
      sq[i] = sq[i - stride] + rq
    }
  }
  return { stride, sum, sq }
}

/** A template ready for TM_CCOEFF_NORMED: zero-mean pixels and their norm. */
interface Template { width: number; height: number; zm: Float32Array; norm: number }

function prepare(img: GrayImage): Template {
  const n = img.data.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += img.data[i]
  mean /= n
  const zm = new Float32Array(n)
  let norm = 0
  for (let i = 0; i < n; i++) {
    zm[i] = img.data[i] - mean
    norm += zm[i] * zm[i]
  }
  return { width: img.width, height: img.height, zm, norm: Math.sqrt(norm) }
}

interface Peak { x: number; y: number; score: number }

/**
 * Best TM_CCOEFF_NORMED position of `t` in `img`, top-left; with `area`, the template must lie
 * inside it. Score -1 when it does not fit or the template is flat.
 */
function matchTemplate(img: GrayImage, ii: Integral, t: Template, area?: Rect): Peak {
  const best: Peak = { x: 0, y: 0, score: -1 }
  if (t.norm < 1e-6) return best
  const tw = t.width, th = t.height, n = tw * th
  const x0 = Math.max(0, Math.floor(area?.x ?? 0))
  const y0 = Math.max(0, Math.floor(area?.y ?? 0))
  const x1 = Math.min(img.width, Math.ceil(area ? area.x + area.width : img.width)) - tw
  const y1 = Math.min(img.height, Math.ceil(area ? area.y + area.height : img.height)) - th
  const d = img.data, zm = t.zm, W = img.width
  const { stride, sum, sq } = ii
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let cross = 0
      for (let ty = 0; ty < th; ty++) {
        const io = (y + ty) * W + x, to = ty * tw
        for (let tx = 0; tx < tw; tx++) cross += zm[to + tx] * d[io + tx]
      }
      const a = y * stride + x, b = a + tw, c = a + th * stride, e = c + tw
      const s = sum[e] - sum[b] - sum[c] + sum[a]
      const q = sq[e] - sq[b] - sq[c] + sq[a]
      const v = q - (s * s) / n
      if (v <= 1e-6) continue
      const score = cross / (Math.sqrt(v) * t.norm)
      if (score > best.score) {
        best.x = x
        best.y = y
        best.score = score
      }
    }
  }
  return best
}

// ── geometry ────────────────────────────────────────────────────────────────

interface Hit {
  anchor: AnchorConfig
  x: number // top-left, frame coordinates
  y: number
  w: number
  h: number
  score: number
}

interface Similarity { a: number; b: number; tx: number; ty: number; scale: number; rotation: number; rms: number }

/** Least-squares x = a·u − b·v + tx, y = b·u + a·v + ty from anchor reference to frame positions. */
function fitSimilarity(hits: Hit[]): Similarity | null {
  const n = hits.length
  if (n < 2) return null
  let mu = 0, mv = 0, mx = 0, my = 0
  for (const h of hits) { mu += h.anchor.ref_x; mv += h.anchor.ref_y; mx += h.x; my += h.y }
  mu /= n; mv /= n; mx /= n; my /= n
  let den = 0, na = 0, nb = 0
  for (const h of hits) {
    const du = h.anchor.ref_x - mu, dv = h.anchor.ref_y - mv, dx = h.x - mx, dy = h.y - my
    den += du * du + dv * dv
    na += du * dx + dv * dy
    nb += du * dy - dv * dx
  }
  if (den < 1e-9) return null
  const a = na / den, b = nb / den
  const tx = mx - a * mu + b * mv, ty = my - b * mu - a * mv
  let err = 0
  for (const h of hits) {
    const px = a * h.anchor.ref_x - b * h.anchor.ref_y + tx
    const py = b * h.anchor.ref_x + a * h.anchor.ref_y + ty
    err += (px - h.x) ** 2 + (py - h.y) ** 2
  }
  return {
    a, b, tx, ty,
    scale: Math.hypot(a, b),
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
    rms: Math.sqrt(err / n),
  }
}

function plausible(fit: Similarity | null, scale: number, n: number): boolean {
  if (!fit) return false
  const ratio = fit.scale / scale
  return Math.abs(fit.rotation) <= MAX_ROTATION_DEG
    && ratio >= SPACING_RATIO_MIN && ratio <= SPACING_RATIO_MAX
    && (n < 3 || fit.rms <= MAX_RESIDUAL * fit.scale)
}

/** The largest (then most confident) subset of `hits` laid out like the HUD; [] if none. */
function consistent(hits: Hit[], scale: number): Hit[] {
  if (hits.length < 2) return []
  if (plausible(fitSimilarity(hits), scale, hits.length)) return hits
  if (hits.length === 2) return []
  let best: Hit[] = []
  for (let i = 0; i < hits.length; i++) {
    const sub = consistent(hits.filter((_, j) => j !== i), scale)
    if (sub.length > best.length || (sub.length === best.length && confidence(sub) > confidence(best))) best = sub
  }
  return best
}

const confidence = (hits: Hit[]) => hits.reduce((s, h) => s + h.score, 0)

// ── search ──────────────────────────────────────────────────────────────────

interface Attempt {
  scale: number
  hits: Hit[] // one per anchor that had a template, best position whatever the score
  accepted: Hit[] // consistent hits above threshold
  coarse: number // frame shrink factor the hits were found at (1 = full resolution)
}

/** Ranks attempts: more anchors first, then total confidence. */
const better = (a: Attempt, b: Attempt | null) =>
  !b || a.accepted.length > b.accepted.length
  || (a.accepted.length === b.accepted.length && confidence(a.accepted) > confidence(b.accepted))

class Search {
  private shrunk = new Map<number, { img: GrayImage; ii: Integral }>()
  private prepared = new Map<string, Template>()
  private readonly frame: GrayImage
  private readonly anchors: AnchorConfig[]
  private readonly templates: Map<string, GrayImage>

  constructor(frame: GrayImage, anchors: AnchorConfig[], templates: Map<string, GrayImage>) {
    this.frame = frame
    this.anchors = anchors.filter(a => templates.has(a.template_path))
    this.templates = templates
  }

  get anchorCount() { return this.anchors.length }

  private working(c: number) {
    const key = round4(c)
    let w = this.shrunk.get(key)
    if (!w) {
      const img = resizeGray(this.frame, key)
      w = { img, ii: integral(img) }
      this.shrunk.set(key, w)
    }
    return w
  }

  private template(path: string, scale: number): Template {
    const key = `${path}@${round4(scale)}`
    let t = this.prepared.get(key)
    if (!t) {
      t = prepare(resizeGray(this.templates.get(path)!, scale))
      if (this.prepared.size > 256) this.prepared.clear()
      this.prepared.set(key, t)
    }
    return t
  }

  private size(a: AnchorConfig, scale: number) {
    const base = this.templates.get(a.template_path)!
    return { w: Math.max(1, Math.round(base.width * scale)), h: Math.max(1, Math.round(base.height * scale)) }
  }

  private judge(scale: number, hits: Hit[], coarse: number): Attempt {
    const slack = coarse < 1 ? COARSE_SLACK : 0
    const above = hits.filter(h => h.score >= h.anchor.match_threshold - slack)
    let accepted = consistent(above, scale)
    if (accepted.length === 2 && accepted.some(h => h.score < PAIR_MIN - slack)) accepted = []
    return { scale, hits, accepted, coarse }
  }

  /** Whole frame, shrunk so the templates are at most COARSE_SCALE. */
  coarse(scale: number): Attempt {
    const c = Math.min(1, COARSE_SCALE / scale)
    const { img, ii } = this.working(c)
    const hits = this.anchors.map(a => {
      const p = matchTemplate(img, ii, this.template(a.template_path, scale * c))
      return { anchor: a, x: p.x / c, y: p.y / c, ...this.size(a, scale), score: p.score }
    })
    return this.judge(scale, hits, c)
  }

  /** Full resolution, within `pad` px of each anchor's expected top-left. */
  local(scale: number, expected: Map<string, { x: number; y: number }>, pad: number): Attempt {
    const { img, ii } = this.working(1)
    const hits: Hit[] = []
    for (const a of this.anchors) {
      const at = expected.get(a.name)
      if (!at) continue
      const t = this.template(a.template_path, scale)
      const area = { x: at.x - pad, y: at.y - pad, width: t.width + 2 * pad, height: t.height + 2 * pad }
      const p = matchTemplate(img, ii, t, area)
      hits.push({ anchor: a, x: p.x, y: p.y, w: t.width, h: t.height, score: p.score })
    }
    return this.judge(scale, hits, 1)
  }

  /** Where each anchor should be: its own hit if accepted, else predicted from the accepted ones. */
  expected(at: Attempt): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>()
    const fit = fitSimilarity(at.accepted)
    for (const a of this.anchors) {
      const hit = at.accepted.find(h => h.anchor === a)
      if (hit) out.set(a.name, { x: hit.x, y: hit.y })
      else if (fit) out.set(a.name, { x: fit.a * a.ref_x - fit.b * a.ref_y + fit.tx, y: fit.b * a.ref_x + fit.a * a.ref_y + fit.ty })
    }
    return out
  }
}

const yieldToBrowser = () => new Promise<void>(r => setTimeout(r, 0))

/** Candidate scales: the hints, then the sweep outward from the first hint (within `span` of it). */
function candidates(hints: number[], span = Infinity): number[] {
  const out: number[] = []
  const near = (s: number) => out.some(t => Math.abs(Math.log(s / t)) < Math.log(1.03))
  for (const h of hints) if (h > 0 && Number.isFinite(h) && !near(h)) out.push(round4(h))
  const center = out[0] ?? 1
  const distance = (s: number) => Math.abs(Math.log(s / center))
  const sweep = SWEEP_SCALES.filter(s => distance(s) <= Math.log(span)).sort((a, b) => distance(a) - distance(b))
  for (const s of sweep) if (!near(s)) out.push(s)
  return out
}

export async function locateHud(
  frame: GrayImage,
  anchors: AnchorConfig[],
  templates: Map<string, GrayImage>,
  options: HudSearchOptions = {},
): Promise<HudResult> {
  const search = new Search(frame, anchors, templates)
  let tried = 0

  const track = options.track
  if (track) {
    tried++
    const expected = new Map(Object.entries(track.positions))
    const at = search.local(track.scale, expected, Math.ceil(TRACK_PADDING * track.scale))
    if (at.accepted.length >= 2) return result(at, tried)
  }

  let best: Attempt | null = null
  let first: Attempt | null = null
  for (const s of candidates(options.hints ?? [], options.span)) {
    if (best && Math.abs(Math.log(s / best.scale)) > Math.log(SWEEP_SPAN)) continue
    if (tried > 0 && tried % 4 === 0) {
      options.onProgress?.(`Searching HUD scale (${s.toFixed(2)})...`)
      await yieldToBrowser()
    }
    tried++
    const at = search.coarse(s)
    first ??= at
    if (at.accepted.length >= 2 && better(at, best)) best = at
    if (best && best.accepted.length === search.anchorCount && best.accepted.every(h => h.score >= STRONG)) break
  }
  if (!best) return result(first, tried)

  // Refine: ±1–4 % at full resolution, near the coarse hits (and where the missed anchors should be)
  options.onProgress?.('Refining HUD scale...')
  const expected = search.expected(best)
  const pad = Math.ceil(3 / best.coarse) + Math.ceil(2 * best.scale) + 2
  let refined: Attempt | null = null
  for (const step of REFINE_STEPS) {
    tried++
    const at = search.local(round4(best.scale * (1 + step)), expected, pad)
    if (at.accepted.length >= 2 && better(at, refined)) refined = at
  }
  return result(refined ?? best, tried)
}

function result(at: Attempt | null, tried: number): HudResult {
  if (!at) return { found: false, scale: 0, matches: [], nearMisses: [], track: null, tried }
  // Positions from a shrunken frame are approximate: a result counts only once it held at full
  // resolution (the refine pass failing at every step means the coarse match was a fluke).
  const found = at.accepted.length >= 2 && at.coarse === 1
  const accepted = found ? at.accepted : []
  const matches: AnchorMatch[] = accepted.map(h => ({
    name: h.anchor.name, x: h.x, y: h.y, w: h.w, h: h.h, confidence: h.score,
  }))
  const nearMisses: AnchorNearMiss[] = at.hits
    .filter(h => !accepted.includes(h))
    .map(h => ({
      name: h.anchor.name, x: Math.round(h.x), y: Math.round(h.y), w: h.w, h: h.h,
      score: h.score, threshold: h.anchor.match_threshold,
    }))
  const track = found
    ? { scale: at.scale, positions: Object.fromEntries(accepted.map(h => [h.anchor.name, { x: h.x, y: h.y }])) }
    : null
  return { found, scale: at.scale, matches, nearMisses, track, tried }
}

/**
 * Sub-anchors at the HUD's scale, each inside its (transformed) search region when it has one.
 */
export function matchSubAnchors(
  frame: GrayImage,
  subAnchors: SubAnchorConfig[],
  templates: Map<string, GrayImage>,
  transform: AffineTransform,
  scale: number,
): { matches: Map<string, AnchorMatch>; searchRegions: Map<string, Rect> } {
  const matches = new Map<string, AnchorMatch>()
  const searchRegions = new Map<string, Rect>()
  const ii = integral(frame)
  for (const sa of subAnchors) {
    const base = templates.get(sa.template_path)
    if (!base) continue
    const t = prepare(resizeGray(base, scale))
    const sr = sa.search_region
    let area: Rect | undefined
    const w = sr ? sr.w ?? sr.width ?? 0 : 0
    const h = sr ? sr.h ?? sr.height ?? 0 : 0
    if (sr && w > 0 && h > 0) {
      const p0 = applyTransform(transform, sr.x, sr.y)
      const p1 = applyTransform(transform, sr.x + w, sr.y + h)
      area = {
        x: Math.round(Math.min(p0.x, p1.x)), y: Math.round(Math.min(p0.y, p1.y)),
        width: Math.round(Math.abs(p1.x - p0.x)), height: Math.round(Math.abs(p1.y - p0.y)),
      }
      searchRegions.set(sa.name, area)
    }
    const p = matchTemplate(frame, ii, t, area)
    if (p.score >= sa.match_threshold) {
      matches.set(sa.name, { name: sa.name, x: p.x, y: p.y, w: t.width, h: t.height, confidence: p.score })
    }
  }
  return { matches, searchRegions }
}
