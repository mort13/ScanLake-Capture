import type { RoiConfig, RoiFilters, AnchorMatch } from './types'
import { type AffineTransform, applyTransform, getScale } from './AnchorDetector'

/**
 * Extract a single ROI from the image using the affine transform.
 * If the ROI has a sub_anchor, use that for local positioning instead.
 * Pass skipFilters=true to return the raw (unfiltered) crop (used by word_cnn
 * to match the PyTorch pipeline which feeds raw images to the word predictor).
 */
export function extractRoi(
  image: ImageData,
  roi: RoiConfig,
  transform: AffineTransform,
  subAnchorMatches: Map<string, AnchorMatch>,
  subAnchorConfigs: { name: string; ref_x: number; ref_y: number }[],
  skipFilters = false,
): ImageData | null {
  const scale = getScale(transform)

  let imgX: number, imgY: number
  if (roi.sub_anchor && subAnchorMatches.has(roi.sub_anchor)) {
    // Use sub-anchor for local positioning
    const match = subAnchorMatches.get(roi.sub_anchor)!
    const saCfg = subAnchorConfigs.find(c => c.name === roi.sub_anchor)
    if (saCfg) {
      // ROI ref_x/ref_y are relative to the sub-anchor's ref position
      const dx = (roi.ref_x - saCfg.ref_x) * scale
      const dy = (roi.ref_y - saCfg.ref_y) * scale
      imgX = match.x + dx
      imgY = match.y + dy
    } else {
      const pt = applyTransform(transform, roi.ref_x, roi.ref_y)
      imgX = pt.x
      imgY = pt.y
    }
  } else {
    // Standard: use affine transform from main anchors
    const pt = applyTransform(transform, roi.ref_x, roi.ref_y)
    imgX = pt.x
    imgY = pt.y
  }

  const w = Math.round(roi.width * scale)
  const h = Math.round(roi.height * scale)
  const x = Math.round(imgX)
  const y = Math.round(imgY)

  // Clip to visible frame area — matches Python's slice_x1/y1/x2/y2 logic.
  // A partially off-screen ROI is still processed (with the visible portion),
  // not rejected outright.
  const x1 = Math.max(0, x)
  const y1 = Math.max(0, y)
  const x2 = Math.min(image.width,  x + w)
  const y2 = Math.min(image.height, y + h)
  if (x1 >= x2 || y1 >= y2) return null

  // Extract sub-image via putImageData/getImageData
  const tempCanvas = new OffscreenCanvas(image.width, image.height)
  const tempCtx = tempCanvas.getContext('2d')!
  tempCtx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  const roiData = tempCtx.getImageData(x1, y1, x2 - x1, y2 - y1)

  // Apply filters (unless caller asked for the raw crop)
  return skipFilters ? roiData : applyFilters(roiData, roi.filters)
}

/** Apply the per-ROI filter pipeline */
function applyFilters(image: ImageData, filters: RoiFilters): ImageData {
  const d = image.data

  // Channel extraction
  if (filters.channel !== 'none') {
    const ci = filters.channel === 'red' ? 0 : filters.channel === 'green' ? 1 : 2
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i + ci]
      d[i] = v; d[i + 1] = v; d[i + 2] = v
    }
  }

  // Grayscale
  if (filters.grayscale) {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      d[i] = g; d[i + 1] = g; d[i + 2] = g
    }
  }

  // Brightness
  if (filters.brightness !== 0) {
    const b = filters.brightness * 10 // scale factor matching desktop app
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] + b)
      d[i + 1] = clamp(d[i + 1] + b)
      d[i + 2] = clamp(d[i + 2] + b)
    }
  }

  // Contrast
  if (filters.contrast !== 0) {
    const factor = (259 * (filters.contrast * 10 + 255)) / (255 * (259 - filters.contrast * 10))
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(factor * (d[i] - 128) + 128)
      d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128)
      d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128)
    }
  }

  // Threshold
  if (filters.threshold_enabled) {
    const t = filters.threshold
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] >= t ? 255 : 0
      d[i] = v; d[i + 1] = v; d[i + 2] = v
    }
  }

  // Invert
  if (filters.invert) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i]
      d[i + 1] = 255 - d[i + 1]
      d[i + 2] = 255 - d[i + 2]
    }
  }

  return image
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}
