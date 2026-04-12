import type { CaptureRegion, RoiConfig, AnchorMatch } from './types'
import { loadProfile, getProfileConfig, loadAllAnchors } from './ProfileLoader'
import { captureFrame } from './ScreenCapture'
import {
  detectAnchors,
  detectSubAnchors,
  computeAffineTransform,
  applyTransform,
  getScale,
  type AffineTransform,
} from './AnchorDetector'
import { extractRoi } from './RoiExtractor'
import { getSegmentBoundaries } from './CharSegmenter'
import { recognizeRoi } from './Inference'

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
  profileStatus: PreviewProfileStatus
  anchorMatches: AnchorMatch[]
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
  const masterProfile = await loadProfile()
  const profileCfg = getProfileConfig(masterProfile, 'scan_results')

  onProgress?.('Loading anchor templates...')
  const anchorImages = await loadAllAnchors(profileCfg.anchors, profileCfg.sub_anchors)

  onProgress?.('Capturing screen...')
  const frameImage = await captureFrame(region)

  onProgress?.('Detecting anchors...')
  const anchorMatches = detectAnchors(frameImage, profileCfg.anchors, anchorImages)
  const foundAnchorNames = anchorMatches.map(m => m.name)
  const missingAnchorNames = profileCfg.anchors.map(a => a.name).filter(n => !foundAnchorNames.includes(n))

  let transform: AffineTransform | null = null
  let transformError: string | null = null
  let subAnchorMatches = new Map<string, AnchorMatch>()
  let subAnchorSearchRegions = new Map<string, { x: number; y: number; width: number; height: number }>()
  const roiPreviews: RoiPreviewData[] = []

  if (anchorMatches.length >= 2) {
    try {
      onProgress?.('Computing transform...')
      transform = computeAffineTransform(profileCfg.anchors, anchorMatches)

      onProgress?.('Detecting sub-anchors...')
      const subAnchorResult = detectSubAnchors(frameImage, profileCfg.sub_anchors, anchorImages, transform)
      subAnchorMatches = subAnchorResult.matches
      subAnchorSearchRegions = subAnchorResult.searchRegions

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

        const imageData = extractRoi(frameImage, roi, transform, subAnchorMatches, profileCfg.sub_anchors)
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
  } else {
    transformError = `Only ${anchorMatches.length} anchor(s) found (need ≥2). Missing: ${missingAnchorNames.join(', ')}`
  }

  const foundSubAnchorNames = [...subAnchorMatches.keys()]
  const missingSubAnchorNames = profileCfg.sub_anchors.map(s => s.name).filter(n => !foundSubAnchorNames.includes(n))

  return {
    frameImage,
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
    subAnchorMatches,
    subAnchorSearchRegions,
    transform,
    transformError,
    roiPreviews,
  }
}
