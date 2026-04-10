import type { CaptureRegion, RoiResult } from './types'
import type { ScanFormData } from '../types'
import { loadProfile, getProfileConfig, loadAllAnchors } from './ProfileLoader'
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

export type ProgressCallback = (stage: string) => void

let _modelsLoaded = false

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
  const masterProfile = await loadProfile()
  const profileCfg = getProfileConfig(masterProfile, 'scan_results')

  onProgress?.('Loading models...')
  if (!_modelsLoaded) {
    await preloadModels()
    _modelsLoaded = true
  }

  onProgress?.('Loading anchor templates...')
  const anchorImages = await loadAllAnchors(profileCfg.anchors, profileCfg.sub_anchors)

  // 2. Capture frame
  onProgress?.('Capturing screen...')
  const frameImage = await captureFrame(region)

  // 3. Detect main anchors
  onProgress?.('Detecting anchors...')
  const anchorMatches = detectAnchors(frameImage, profileCfg.anchors, anchorImages)
  if (anchorMatches.length < 2) {
    throw new Error(
      `Anchor detection failed: found ${anchorMatches.length} anchors (need at least 2). ` +
      `Detected: ${anchorMatches.map(m => `${m.name}=${m.confidence.toFixed(2)}`).join(', ') || 'none'}`
    )
  }

  // 4. Compute affine transform
  onProgress?.('Computing transform...')
  const transform = computeAffineTransform(profileCfg.anchors, anchorMatches)

  // 5. Detect sub-anchors
  onProgress?.('Detecting sub-anchors...')
  const subAnchorMatches = detectSubAnchors(
    frameImage, profileCfg.sub_anchors, anchorImages, transform,
  )

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
