import type { AnchorConfig, AnchorMatch } from './types'

/*
 * Anchor geometry: the reference → frame transform the anchors define. Finding the anchors
 * (template matching at any HUD scale) lives in HudLocator.ts.
 */

/** Best NCC result for an anchor that was not accepted. */
export interface AnchorNearMiss {
  name: string
  x: number
  y: number
  w: number
  h: number
  score: number
  threshold: number
  /** Pixel-space search region used, if any */
  searchRegion?: { x: number; y: number; width: number; height: number }
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
