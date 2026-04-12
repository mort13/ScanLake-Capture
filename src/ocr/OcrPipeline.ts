import type { CaptureRegion, RoiResult, AnchorConfig } from './types'
import type { ScanFormData } from '../types'
import { loadProfile, getProfileConfig, loadAllAnchors, scaleAnchorImages, DEFAULT_PROFILE_FILE } from './ProfileLoader'
import { preloadModels } from './ModelLoader'
import { captureFrame } from './ScreenCapture'
import {
  detectAnchors,
  detectSubAnchors,
  computeAffineTransform,
} from './AnchorDetector'
import { extractRoi } from './RoiExtractor'
import { recognizeRoi } from './Inference'
import { mapResultsToForm } from './ResultMapper'
import { IndexedDBCache } from '../store/IndexedDBCache'
import { UserStore } from '../store/UserStore'

export type ProgressCallback = (stage: string) => void

let _modelsLoaded = false

/** Scale candidates to probe when no cached scaling factor exists.
 * Reference resolution: 2560×1440. Each entry = target_width / 2560.
 * 1.0=2560×1440  0.75=1920×1080  1.5=3840×2160  0.5=1280×720
 * 0.625=1600×900  0.8=2048×1152  1.25=3200×1800  2.0=5120×2880
 */
const SCALE_CANDIDATES = [1.0, 0.75, 1.5, 0.5, 0.625, 0.8, 1.25, 2.0]

/**
 * Determine the display-scaling factor for the current capture.
 * Checks IndexedDB first; if absent, sniffs each candidate scale and picks
 * the one that yields the most (and highest-confidence) anchor matches.
 * The result is stored so it won't be re-detected on subsequent calls.
 */
async function resolveScalingFactor(
  frameImage: ImageData,
  anchors: AnchorConfig[],
  baseImages: Map<string, ImageData>,
  profileFile: string,
  onProgress?: ProgressCallback,
): Promise<number> {
  // Manual resolution override — skip cache and detection entirely
  const manualRes = UserStore.loadSettings().captureResolution
  if (manualRes) {
    const w = parseInt(manualRes.split('x')[0], 10)
    if (w > 0) return w / 2560
  }

  const cached = await IndexedDBCache.getScalingFactor(profileFile)
  if (cached !== null) return cached

  onProgress?.('Detecting display scale...')
  let bestScale = 1.0
  let bestMatchCount = 0
  let bestScore = -1

  for (const scale of SCALE_CANDIDATES) {
    const scaledImages = await scaleAnchorImages(baseImages, scale)
    const matches = detectAnchors(frameImage, anchors, scaledImages)
    const score = matches.reduce((s, m) => s + m.confidence, 0)
    if (
      matches.length > bestMatchCount ||
      (matches.length === bestMatchCount && score > bestScore)
    ) {
      bestMatchCount = matches.length
      bestScore = score
      bestScale = scale
    }
    if (matches.length >= anchors.length) break // all anchors found — stop early
  }

  await IndexedDBCache.saveScalingFactor(profileFile, bestScale)
  return bestScale
}

/**
 * Run the complete OCR pipeline:
 * capture → anchor detect → affine transform → ROI extract → filter → infer → map
 */
export async function runPipeline(
  region: CaptureRegion,
  onProgress?: ProgressCallback,
): Promise<{
  formData: ScanFormData
  confidences: Map<string, number>
  roiResults: Map<string, RoiResult>
}> {
  // 1. Load profile + anchors + models
  onProgress?.('Loading profile...')
  const profileFile = UserStore.loadSettings().selectedShipProfile ?? DEFAULT_PROFILE_FILE
  const masterProfile = await loadProfile(profileFile)
  const profileCfg = getProfileConfig(masterProfile, 'scan_results')

  onProgress?.('Loading models...')
  if (!_modelsLoaded) {
    await preloadModels()
    _modelsLoaded = true
  }

  onProgress?.('Loading anchor templates...')
  const baseAnchorImages = await loadAllAnchors(profileCfg.anchors, profileCfg.sub_anchors)

  // 2. Capture frame
  onProgress?.('Capturing screen...')
  const frameImage = await captureFrame(region)

  // 3. Resolve display scaling (cached after first detection)
  const scalingFactor = await resolveScalingFactor(
    frameImage, profileCfg.anchors, baseAnchorImages, profileFile, onProgress,
  )
  const anchorImages = await scaleAnchorImages(baseAnchorImages, scalingFactor)

  // 4. Detect main anchors
  onProgress?.('Detecting anchors...')
  const anchorMatches = detectAnchors(frameImage, profileCfg.anchors, anchorImages)
  if (anchorMatches.length < 2) {
    throw new Error(
      `Anchor detection failed: found ${anchorMatches.length} anchors (need at least 2). ` +
      `Detected: ${anchorMatches.map(m => `${m.name}=${m.confidence.toFixed(2)}`).join(', ') || 'none'}`
    )
  }

  // 5. Compute affine transform
  onProgress?.('Computing transform...')
  const transform = computeAffineTransform(profileCfg.anchors, anchorMatches)

  // 5. Detect sub-anchors
  onProgress?.('Detecting sub-anchors...')
  const subAnchorResult = detectSubAnchors(
    frameImage, profileCfg.sub_anchors, anchorImages, transform,
  )
  const subAnchorMatches = subAnchorResult.matches

  // 6. Extract and recognize each ROI
  const roiResults = new Map<string, RoiResult>()
  const enabledRois = profileCfg.rois.filter(r => r.enabled)

  for (let i = 0; i < enabledRois.length; i++) {
    const roi = enabledRois[i]
    onProgress?.(`Processing ROI ${i + 1}/${enabledRois.length}: ${roi.name}`)

    const roiImage = extractRoi(
      frameImage,
      roi,
      transform,
      subAnchorMatches,
      profileCfg.sub_anchors,
      roi.recognition_mode === 'word_cnn',  // word_cnn uses raw (unfiltered) image
    )

    if (!roiImage) {
      roiResults.set(roi.name, { roiName: roi.name, text: '', confidence: 0 })
      continue
    }

    const result = await recognizeRoi(roiImage, roi)
    roiResults.set(roi.name, result)
  }

  // 7. Map results to form data
  onProgress?.('Mapping results...')
  const { formData, confidences } = mapResultsToForm(roiResults, masterProfile)

  onProgress?.('Done')
  return { formData, confidences, roiResults }
}
