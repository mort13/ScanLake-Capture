import type { CaptureRegion, RoiResult } from './types'
import type { ScanFormData } from '../types'
import { loadProfile, getProfileConfig, loadAllAnchors, DEFAULT_PROFILE_FILE } from './ProfileLoader'
import { preloadModels } from './ModelLoader'
import { captureFrame } from './ScreenCapture'
import { findHud } from './HudSearch'
import { extractRoi } from './RoiExtractor'
import { recognizeRoi } from './Inference'
import { mapResultsToForm } from './ResultMapper'
import { positionReadingAvailable, positionTracker, readShipPosition } from './PositionReader'
import type { ShipPosition } from './ShipPosition'
import { UserStore } from '../store/UserStore'

export type ProgressCallback = (stage: string) => void

let _modelsLoaded = false

/**
 * Run the complete OCR pipeline:
 * capture → find HUD (any scale) → affine transform → ROI extract → filter → infer → map
 *
 * Once the HUD is found, the debug-text corner of the same frame is read for the ship position
 * (when a debug font is shipped); `position` is that one, or the last one read if still fresh.
 */
export async function runPipeline(
  region: CaptureRegion,
  onProgress?: ProgressCallback,
): Promise<{
  formData: ScanFormData
  confidences: Map<string, number>
  roiResults: Map<string, RoiResult>
  /** Where the ship was (the game's debug text), or null */
  position: ShipPosition | null
  /** The debug text has been read at least once on this page (the player has it on) */
  positionsSeen: boolean
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
  const withCorner = await positionReadingAvailable()
  const { image: frameImage, sourceHeight, corner, capturedAt } = await captureFrame(region, { withCorner })

  // 3. Find the HUD's anchors at whatever size it is drawn, and the reference → frame transform
  onProgress?.('Detecting anchors...')
  const hud = await findHud(frameImage, sourceHeight, profileFile, profileCfg, baseAnchorImages, onProgress)
  if (!hud.transform) throw new Error(hud.error ?? 'Anchor detection failed')
  const { transform } = hud
  const subAnchorMatches = hud.subAnchors.matches

  // 3b. The HUD is locked: where was the ship?
  if (corner) onProgress?.('Reading position...')
  const position = await readShipPosition(corner, capturedAt)

  // 4. Extract and recognize each ROI
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

  // 5. Map results to form data
  onProgress?.('Mapping results...')
  const { formData, confidences } = mapResultsToForm(roiResults, masterProfile)

  onProgress?.('Done')
  return { formData, confidences, roiResults, position, positionsSeen: positionTracker.seen }
}
