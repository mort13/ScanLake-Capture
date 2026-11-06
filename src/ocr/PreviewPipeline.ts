import type { CaptureRegion, RoiConfig, AnchorMatch } from './types'
import { loadProfile, getProfileConfig, loadAllAnchors, DEFAULT_PROFILE_FILE } from './ProfileLoader'
import { captureFrame } from './ScreenCapture'
import { applyTransform, getScale, type AffineTransform, type AnchorNearMiss } from './AnchorDetector'
import { findHud } from './HudSearch'
import { extractRoi } from './RoiExtractor'
import { getSegmentBoundaries } from './CharSegmenter'
import { recognizeRoi } from './Inference'
import { UserStore } from '../store/UserStore'

export interface RoiPreviewData {
  roi: RoiConfig
  imageData: ImageData | null
  pixelX: number
  pixelY: number
  pixelW: number
  pixelH: number
  /** X-positions of segmentation cut lines in ROI-local pixel coords */
  segBoundaries: number[]
  /** CNN-recognized text (null if ROI out of bounds) */
  recognizedText: string | null
  recognitionConfidence: number
  /** Per-segment confidences for cnn mode */
  segmentConfidences: number[]
}

export interface PreviewProfileStatus {
  masterName: string
  profileName: string
  anchorsConfigured: number
  anchorsFound: number
  foundAnchorNames: string[]
  missingAnchorNames: string[]
  subAnchorsConfigured: number
  subAnchorsFound: number
  foundSubAnchorNames: string[]
  missingSubAnchorNames: string[]
  roisEnabled: number
  roisExtracted: number
}

export interface PipelinePreviewResult {
  frameImage: ImageData
  /** Width of the captured frame in pixels */
  frameWidth: number
  /** Height of the captured frame in pixels */
  frameHeight: number
  /** HUD scale the anchors matched at (template pixels × scale = frame pixels) */
  resolvedScale: number
  profileStatus: PreviewProfileStatus
  anchorMatches: AnchorMatch[]
  /** Best NCC position for each anchor that was not accepted (below threshold or out of the HUD's layout) */
  anchorNearMisses: AnchorNearMiss[]
  /** Pixel-space search regions for main anchors (none: main anchors are searched in the whole region) */
  anchorSearchRegions: Map<string, { x: number; y: number; width: number; height: number }>
  subAnchorMatches: Map<string, AnchorMatch>
  subAnchorSearchRegions: Map<string, { x: number; y: number; width: number; height: number }>
  transform: AffineTransform | null
  transformError: string | null
  roiPreviews: RoiPreviewData[]
}

export async function runPreviewPipeline(
  region: CaptureRegion,
  onProgress?: (msg: string) => void,
): Promise<PipelinePreviewResult> {
  onProgress?.('Loading profile...')
  const profileFile = UserStore.loadSettings().selectedShipProfile ?? DEFAULT_PROFILE_FILE
  const masterProfile = await loadProfile(profileFile)
  const profileCfg = getProfileConfig(masterProfile, 'scan_results')

  onProgress?.('Loading anchor templates...')
  const baseAnchorImages = await loadAllAnchors(profileCfg.anchors, profileCfg.sub_anchors)

  onProgress?.('Capturing screen...')
  const { image: frameImage, sourceHeight } = await captureFrame(region)

  onProgress?.('Detecting anchors...')
  const hud = await findHud(frameImage, sourceHeight, profileFile, profileCfg, baseAnchorImages, onProgress)
  const { matches: anchorMatches, nearMisses: anchorNearMisses } = hud.result
  const anchorSearchRegions = new Map<string, { x: number; y: number; width: number; height: number }>()
  const foundAnchorNames = anchorMatches.map(m => m.name)

  const transform: AffineTransform | null = hud.transform
  let transformError: string | null = hud.error
  const subAnchorMatches = hud.subAnchors.matches
  const subAnchorSearchRegions = hud.subAnchors.searchRegions
  const roiPreviews: RoiPreviewData[] = []

  if (transform) {
    try {

      onProgress?.('Extracting ROIs...')
      const scale = getScale(transform)
      const enabledRois = profileCfg.rois.filter(r => r.enabled)

      for (const roi of enabledRois) {
        // Compute pixel position of this ROI in the frame
        let imgX: number, imgY: number
        if (roi.sub_anchor && subAnchorMatches.has(roi.sub_anchor)) {
          const match = subAnchorMatches.get(roi.sub_anchor)!
          const saCfg = profileCfg.sub_anchors.find(c => c.name === roi.sub_anchor)
          if (saCfg) {
            imgX = match.x + (roi.ref_x - saCfg.ref_x) * scale
            imgY = match.y + (roi.ref_y - saCfg.ref_y) * scale
          } else {
            const pt = applyTransform(transform, roi.ref_x, roi.ref_y)
            imgX = pt.x; imgY = pt.y
          }
        } else {
          const pt = applyTransform(transform, roi.ref_x, roi.ref_y)
          imgX = pt.x; imgY = pt.y
        }

        const pixelW = Math.round(roi.width * scale)
        const pixelH = Math.round(roi.height * scale)
        const pixelX = Math.round(imgX)
        const pixelY = Math.round(imgY)

        const imageData = extractRoi(frameImage, roi, transform, subAnchorMatches, profileCfg.sub_anchors,
          roi.recognition_mode === 'word_cnn')  // word_cnn uses raw (unfiltered) image
        // CRNN doesn't use segmentation — skip boundaries for digit_crnn
        const segBoundaries = roi.recognition_mode === 'digit_crnn' 
          ? [] 
          : (imageData ? getSegmentBoundaries(imageData, roi) : [])

        let recognizedText: string | null = null
        let recognitionConfidence = 0
        let segmentConfidences: number[] = []
        if (imageData) {
          try {
            const result = await recognizeRoi(imageData, roi)
            recognizedText = result.text
            recognitionConfidence = result.confidence
            segmentConfidences = result.segmentConfidences ?? []
          } catch {
            recognizedText = '(error)'
          }
        }

        roiPreviews.push({ roi, imageData, pixelX, pixelY, pixelW, pixelH, segBoundaries, recognizedText, recognitionConfidence, segmentConfidences })
      }
    } catch (e) {
      transformError = e instanceof Error ? e.message : 'Transform failed'
    }
  }
  const missingAnchorNames = profileCfg.anchors.map(a => a.name).filter(n => !foundAnchorNames.includes(n))

  const foundSubAnchorNames = [...subAnchorMatches.keys()]
  const missingSubAnchorNames = profileCfg.sub_anchors.map(s => s.name).filter(n => !foundSubAnchorNames.includes(n))

  return {
    frameImage,
    frameWidth: frameImage.width,
    frameHeight: frameImage.height,
    resolvedScale: hud.result.scale,
    profileStatus: {
      masterName: masterProfile.name,
      profileName: 'scan_results',
      anchorsConfigured: profileCfg.anchors.length,
      anchorsFound: anchorMatches.length,
      foundAnchorNames,
      missingAnchorNames,
      subAnchorsConfigured: profileCfg.sub_anchors.length,
      subAnchorsFound: foundSubAnchorNames.length,
      foundSubAnchorNames,
      missingSubAnchorNames,
      roisEnabled: profileCfg.rois.filter(r => r.enabled).length,
      roisExtracted: roiPreviews.filter(r => r.imageData !== null).length,
    },
    anchorMatches,
    anchorNearMisses,
    anchorSearchRegions,
    subAnchorMatches,
    subAnchorSearchRegions,
    transform,
    transformError,
    roiPreviews,
  }
}
