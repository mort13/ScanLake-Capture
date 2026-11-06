import type { AnchorMatch, ProfileConfig } from './types'
import { locateHud, matchSubAnchors, toGray, type GrayImage, type HudResult, type HudTrack } from './HudLocator'
import { computeAffineTransform, type AffineTransform } from './AnchorDetector'
import { IndexedDBCache } from '../store/IndexedDBCache'
import { UserStore } from '../store/UserStore'

/** Profiles (anchor templates and positions) are cut on a 2560×1440 screen. */
const REFERENCE_HEIGHT = 1440
/** With a HUD scale confirmed by an earlier capture, the sweep stays within this factor of it. */
const REMEMBERED_SPAN = 1.35

export interface HudSearch {
  /** The captured region in grayscale (ROIs are cropped from the colour frame, not this) */
  gray: GrayImage
  result: HudResult
  transform: AffineTransform | null
  subAnchors: { matches: Map<string, AnchorMatch>; searchRegions: Map<string, { x: number; y: number; width: number; height: number }> }
  /** Why there is no transform */
  error: string | null
}

const grayTemplates = new WeakMap<ImageData, GrayImage>()
let last: { key: string; track: HudTrack } | null = null

/**
 * Finds the profile's HUD in a captured region at whatever size it is drawn.
 *
 * Starts where the previous capture found it; otherwise tries the remembered HUD scale (adjusted
 * for a change of screen height), the Capture Resolution setting and the shared screen's height,
 * then sweeps all scales. A confirmed scale is remembered per ship profile.
 */
export async function findHud(
  frame: ImageData,
  sourceHeight: number,
  profileFile: string,
  cfg: ProfileConfig,
  images: Map<string, ImageData>,
  onProgress?: (stage: string) => void,
): Promise<HudSearch> {
  const gray = toGray(frame)
  const templates = new Map<string, GrayImage>()
  for (const [path, img] of images) {
    let g = grayTemplates.get(img)
    if (!g) grayTemplates.set(img, (g = toGray(img)))
    templates.set(path, g)
  }

  const remembered = await IndexedDBCache.getScalingFactor(profileFile)
  const hints: number[] = []
  if (remembered) {
    const { scale, sourceHeight: h } = remembered
    hints.push(h ? (scale * sourceHeight) / h : scale)
  }
  const manualHeight = parseInt(UserStore.loadSettings().captureResolution?.split('x')[1] ?? '', 10)
  if (manualHeight > 0) hints.push(manualHeight / REFERENCE_HEIGHT)
  hints.push(sourceHeight / REFERENCE_HEIGHT)
  // Only a scale saved by this code (with its screen height) has been confirmed by a lock
  const confirmed = remembered?.sourceHeight != null

  const key = `${profileFile}|${frame.width}x${frame.height}|${sourceHeight}`
  const result = await locateHud(gray, cfg.anchors, templates, {
    hints,
    span: confirmed ? REMEMBERED_SPAN : undefined,
    track: last?.key === key ? last.track : null,
    onProgress,
  })

  const subAnchors = { matches: new Map<string, AnchorMatch>(), searchRegions: new Map() }
  if (!result.found || !result.track) {
    if (last?.key === key) last = null
    return { gray, result, transform: null, subAnchors, error: failure(result, cfg, confirmed) }
  }

  last = { key, track: result.track }
  if (!remembered || remembered.sourceHeight !== sourceHeight || Math.abs(remembered.scale / result.scale - 1) > 0.005) {
    await IndexedDBCache.saveScalingFactor(profileFile, result.scale, sourceHeight)
  }

  let transform: AffineTransform
  try {
    transform = computeAffineTransform(cfg.anchors, result.matches)
  } catch (e) {
    return { gray, result, transform: null, subAnchors, error: e instanceof Error ? e.message : 'Transform failed' }
  }
  if (cfg.sub_anchors.length > 0) {
    onProgress?.('Detecting sub-anchors...')
    Object.assign(subAnchors, matchSubAnchors(gray, cfg.sub_anchors, templates, transform, result.scale))
  }
  return { gray, result, transform, subAnchors, error: null }
}

function failure(result: HudResult, cfg: ProfileConfig, confirmed: boolean): string {
  const best = result.nearMisses
    .filter(m => m.score > -1)
    .map(m => `${m.name}=${m.score.toFixed(2)}`)
    .join(', ')
  return `Anchor detection failed: the HUD was not found at any size tried (need 2 of ${cfg.anchors.length} anchors, in the HUD's layout).`
    + (best ? ` Best scores (scale ${result.scale.toFixed(2)}): ${best}.` : '')
    + (confirmed ? ' Only sizes near the remembered HUD size were searched; Settings → Reset Scale Detection searches all.' : '')
}
