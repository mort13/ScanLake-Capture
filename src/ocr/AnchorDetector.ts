import type { AnchorConfig, AnchorMatch, SubAnchorConfig, SearchRegion } from './types'

/**
 * Normalized cross-correlation template matching on grayscale ImageData.
 * Returns the best match position (top-left corner) and correlation score.
 */
function nccMatch(
  image: ImageData,
  template: ImageData,
  searchRegion?: { x: number; y: number; width: number; height: number },
): { x: number; y: number; score: number } {
  const imgW = image.width
  const imgH = image.height
  const tplW = template.width
  const tplH = template.height

  // Convert to grayscale Float32 arrays
  const img = toGray(image)
  const tpl = toGray(template)

  // Precompute template stats
  const tplLen = tplW * tplH
  let tplMean = 0
  for (let i = 0; i < tplLen; i++) tplMean += tpl[i]
  tplMean /= tplLen

  let tplStd = 0
  for (let i = 0; i < tplLen; i++) {
    const d = tpl[i] - tplMean
    tplStd += d * d
  }
  tplStd = Math.sqrt(tplStd)
  if (tplStd < 1e-6) return { x: 0, y: 0, score: 0 }

  // Search bounds
  const sx = searchRegion ? Math.max(0, searchRegion.x) : 0
  const sy = searchRegion ? Math.max(0, searchRegion.y) : 0
  const ex = searchRegion ? Math.min(imgW - tplW, searchRegion.x + searchRegion.width - tplW) : imgW - tplW
  const ey = searchRegion ? Math.min(imgH - tplH, searchRegion.y + searchRegion.height - tplH) : imgH - tplH

  let bestScore = -1
  let bestX = 0
  let bestY = 0

  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      // Compute NCC at this position
      let imgMean = 0
      for (let ty = 0; ty < tplH; ty++) {
        const rowOff = (y + ty) * imgW + x
        for (let tx = 0; tx < tplW; tx++) {
          imgMean += img[rowOff + tx]
        }
      }
      imgMean /= tplLen

      let cross = 0
      let imgStd = 0
      for (let ty = 0; ty < tplH; ty++) {
        const rowOff = (y + ty) * imgW + x
        for (let tx = 0; tx < tplW; tx++) {
          const id = img[rowOff + tx] - imgMean
          const td = tpl[ty * tplW + tx] - tplMean
          cross += id * td
          imgStd += id * id
        }
      }
      imgStd = Math.sqrt(imgStd)

      const denom = imgStd * tplStd
      const score = denom > 1e-6 ? cross / denom : 0

      if (score > bestScore) {
        bestScore = score
        bestX = x
        bestY = y
      }
    }
  }

  return { x: bestX, y: bestY, score: bestScore }
}

/** Convert RGBA ImageData to Float32 grayscale array (0-255 range) */
function toGray(image: ImageData): Float32Array {
  const len = image.width * image.height
  const gray = new Float32Array(len)
  const d = image.data
  for (let i = 0; i < len; i++) {
    const off = i * 4
    gray[i] = 0.299 * d[off] + 0.587 * d[off + 1] + 0.114 * d[off + 2]
  }
  return gray
}

function normalizeSearchRegion(sr?: SearchRegion): { x: number; y: number; width: number; height: number } | undefined {
  if (!sr) return undefined
  return {
    x: sr.x,
    y: sr.y,
    width: sr.w ?? sr.width ?? 0,
    height: sr.h ?? sr.height ?? 0,
  }
}

/**
 * Detect anchors in the captured image.
 * Returns matched positions for each anchor with score above threshold.
 */
export function detectAnchors(
  image: ImageData,
  anchors: AnchorConfig[],
  anchorImages: Map<string, ImageData>,
): AnchorMatch[] {
  const matches: AnchorMatch[] = []
  for (const anchor of anchors) {
    const tpl = anchorImages.get(anchor.template_path)
    if (!tpl) continue
    const result = nccMatch(image, tpl)
    if (result.score >= anchor.match_threshold) {
      matches.push({
        name: anchor.name,
        // Center of the matched region
        x: result.x + tpl.width / 2,
        y: result.y + tpl.height / 2,
        confidence: result.score,
      })
    }
  }
  return matches
}

/**
 * Detect sub-anchors using localized search regions (relative to the main affine-transformed frame).
 */
export function detectSubAnchors(
  image: ImageData,
  subAnchors: SubAnchorConfig[],
  anchorImages: Map<string, ImageData>,
  transform: AffineTransform,
): Map<string, AnchorMatch> {
  const results = new Map<string, AnchorMatch>()
  for (const sa of subAnchors) {
    const tpl = anchorImages.get(sa.template_path)
    if (!tpl) continue

    // Transform the sub-anchor's search region to image coordinates
    const sr = normalizeSearchRegion(sa.search_region)
    let searchRegion: { x: number; y: number; width: number; height: number } | undefined
    if (sr && sr.width > 0 && sr.height > 0) {
      const topLeft = applyTransform(transform, sr.x, sr.y)
      const botRight = applyTransform(transform, sr.x + sr.width, sr.y + sr.height)
      searchRegion = {
        x: Math.round(Math.min(topLeft.x, botRight.x)),
        y: Math.round(Math.min(topLeft.y, botRight.y)),
        width: Math.round(Math.abs(botRight.x - topLeft.x)),
        height: Math.round(Math.abs(botRight.y - topLeft.y)),
      }
    }

    const result = nccMatch(image, tpl, searchRegion)
    if (result.score >= sa.match_threshold) {
      results.set(sa.name, {
        name: sa.name,
        x: result.x + tpl.width / 2,
        y: result.y + tpl.height / 2,
        confidence: result.score,
      })
    }
  }
  return results
}

/**
 * 2×3 affine transformation: maps reference coordinates to image coordinates.
 * [a, b, tx]
 * [c, d, ty]
 */
export interface AffineTransform {
  a: number; b: number; tx: number
  c: number; d: number; ty: number
}

/**
 * Compute affine transform from anchor reference positions to detected image positions.
 * Uses least-squares fit. Requires at least 2 matched anchors.
 */
export function computeAffineTransform(
  anchors: AnchorConfig[],
  matches: AnchorMatch[],
): AffineTransform {
  // Build matched pairs: ref (expected) → img (detected)
  const pairs: { refX: number; refY: number; imgX: number; imgY: number }[] = []
  for (const match of matches) {
    const anchor = anchors.find(a => a.name === match.name)
    if (!anchor) continue
    pairs.push({ refX: anchor.ref_x, refY: anchor.ref_y, imgX: match.x, imgY: match.y })
  }

  if (pairs.length < 2) {
    throw new Error(`Need at least 2 anchors, got ${pairs.length}`)
  }

  if (pairs.length === 2) {
    // From 2 points: solve for scale, rotation, translation (4 unknowns, similarity transform)
    const [p0, p1] = pairs
    const dRefX = p1.refX - p0.refX
    const dRefY = p1.refY - p0.refY
    const dImgX = p1.imgX - p0.imgX
    const dImgY = p1.imgY - p0.imgY

    const refDistSq = dRefX * dRefX + dRefY * dRefY
    const a = (dRefX * dImgX + dRefY * dImgY) / refDistSq
    const b = (dRefX * dImgY - dRefY * dImgX) / refDistSq

    return {
      a, b: -b,
      tx: p0.imgX - a * p0.refX + b * p0.refY,
      c: b, d: a,
      ty: p0.imgY - b * p0.refX - a * p0.refY,
    }
  }

  // 3+ points: full affine least-squares
  // Solve for [a, b, tx; c, d, ty] that maps ref → img
  // Using normal equations: A^T * A * x = A^T * b
  const n = pairs.length
  let sumX2 = 0, sumY2 = 0, sumXY = 0, sumX = 0, sumY = 0
  let sumXU = 0, sumYU = 0, sumU = 0
  let sumXV = 0, sumYV = 0, sumV = 0

  for (const p of pairs) {
    sumX2 += p.refX * p.refX
    sumY2 += p.refY * p.refY
    sumXY += p.refX * p.refY
    sumX += p.refX
    sumY += p.refY
    sumXU += p.refX * p.imgX
    sumYU += p.refY * p.imgX
    sumU += p.imgX
    sumXV += p.refX * p.imgY
    sumYV += p.refY * p.imgY
    sumV += p.imgY
  }

  // Solve 3×3 system for [a, b, tx] and [c, d, ty]
  // | sumX2  sumXY  sumX | |a|   |sumXU|
  // | sumXY  sumY2  sumY | |b| = |sumYU|
  // | sumX   sumY   n    | |tx|  |sumU |
  const det = sumX2 * (sumY2 * n - sumY * sumY)
            - sumXY * (sumXY * n - sumY * sumX)
            + sumX * (sumXY * sumY - sumY2 * sumX)

  if (Math.abs(det) < 1e-10) {
    throw new Error('Degenerate anchor configuration')
  }

  const invDet = 1 / det

  function solve3x3(b0: number, b1: number, b2: number): [number, number, number] {
    const x0 = ((sumY2 * n - sumY * sumY) * b0 + (sumX * sumY - sumXY * n) * b1 + (sumXY * sumY - sumY2 * sumX) * b2) * invDet
    const x1 = ((sumY * sumX - sumXY * n) * b0 + (sumX2 * n - sumX * sumX) * b1 + (sumXY * sumX - sumX2 * sumY) * b2) * invDet
    const x2 = ((sumXY * sumY - sumY2 * sumX) * b0 + (sumXY * sumX - sumX2 * sumY) * b1 + (sumX2 * sumY2 - sumXY * sumXY) * b2) * invDet
    return [x0, x1, x2]
  }

  const [a, b, tx] = solve3x3(sumXU, sumYU, sumU)
  const [c, d, ty] = solve3x3(sumXV, sumYV, sumV)

  return { a, b, tx, c, d, ty }
}

/** Apply affine transform to a reference-space point → image-space point */
export function applyTransform(t: AffineTransform, refX: number, refY: number): { x: number; y: number } {
  return {
    x: t.a * refX + t.b * refY + t.tx,
    y: t.c * refX + t.d * refY + t.ty,
  }
}

/** Extract the uniform scale factor from the affine transform */
export function getScale(t: AffineTransform): number {
  return Math.sqrt(t.a * t.a + t.c * t.c)
}
