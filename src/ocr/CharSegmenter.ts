import type { RoiConfig } from './types'

/**
 * Segment a ROI image into individual character images.
 * Returns array of ImageData for each character.
 */
export function segmentCharacters(
  roiImage: ImageData,
  roi: RoiConfig,
): ImageData[] {
  if (roi.seg_mode === 'fixed_width') {
    return fixedWidthSegment(roiImage, roi.char_count)
  } else if (roi.seg_mode === 'projection') {
    return projectionSegment(roiImage, roi.char_count)
  }
  // Fallback: treat entire ROI as one segment
  return [roiImage]
}

/**
 * Return the x-pixel positions of segmentation cut lines within a ROI image.
 * Used for visualization only.
 */
export function getSegmentBoundaries(image: ImageData, roi: RoiConfig): number[] {
  if (roi.seg_mode === 'fixed_width') {
    if (roi.char_count <= 0) return []
    const charW = Math.floor(image.width / roi.char_count)
    return Array.from({ length: roi.char_count - 1 }, (_, i) => (i + 1) * charW)
  } else if (roi.seg_mode === 'projection') {
    return projectionBoundaries(image)
  }
  return []
}

function projectionBoundaries(image: ImageData): number[] {
  const w = image.width
  const h = image.height
  const projection = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y < h; y++) {
      const off = (y * w + x) * 4
      const gray = 0.299 * image.data[off] + 0.587 * image.data[off + 1] + 0.114 * image.data[off + 2]
      if (gray < 128) sum++
    }
    projection[x] = sum
  }
  const threshold = h * 0.05
  const boundaries: number[] = []
  let inChar = false
  let first = true
  for (let x = 0; x <= w; x++) {
    const val = x < w ? projection[x] : 0
    if (!inChar && val > threshold) {
      inChar = true
      if (!first) boundaries.push(x)
      first = false
    } else if (inChar && val <= threshold) {
      inChar = false
    }
  }
  return boundaries
}

/** Fixed-width: divide ROI into equal columns */
function fixedWidthSegment(image: ImageData, charCount: number): ImageData[] {
  if (charCount <= 0) return [image]
  const charW = Math.floor(image.width / charCount)
  const segments: ImageData[] = []

  for (let i = 0; i < charCount; i++) {
    const x = i * charW
    const w = i === charCount - 1 ? image.width - x : charW
    segments.push(extractSubImage(image, x, 0, w, image.height))
  }
  return segments
}

/** Projection-based: vertical histogram to find inter-character gaps */
function projectionSegment(image: ImageData, _expectedCount: number): ImageData[] {
  const w = image.width
  const h = image.height

  // Compute vertical projection (sum of dark pixels per column)
  const projection = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y < h; y++) {
      const off = (y * w + x) * 4
      // Dark pixel = character content (assuming light background or already filtered)
      const gray = 0.299 * image.data[off] + 0.587 * image.data[off + 1] + 0.114 * image.data[off + 2]
      // Count darker pixels (below midpoint)
      if (gray < 128) sum++
    }
    projection[x] = sum
  }

  // Find character boundaries (regions where projection > 0)
  const threshold = h * 0.05 // minimum pixel density to count as character column
  const segments: ImageData[] = []
  let inChar = false
  let startX = 0

  for (let x = 0; x <= w; x++) {
    const val = x < w ? projection[x] : 0
    if (!inChar && val > threshold) {
      inChar = true
      startX = x
    } else if (inChar && val <= threshold) {
      inChar = false
      const charW = x - startX
      if (charW > 2) { // minimum width filter
        segments.push(extractSubImage(image, startX, 0, charW, h))
      }
    }
  }

  // If no segments found, return the whole ROI
  if (segments.length === 0) return [image]
  return segments
}

function extractSubImage(image: ImageData, sx: number, sy: number, w: number, h: number): ImageData {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  const temp = new OffscreenCanvas(image.width, image.height)
  const tctx = temp.getContext('2d')!
  tctx.putImageData(image, 0, 0)
  ctx.drawImage(temp, sx, sy, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Resize an image to the model input dimensions (32×256) as a grayscale Float32Array.
 * Returns normalized [0,1] values in shape [1, 1, 32, 256].
 */
export function prepareModelInput(image: ImageData): Float32Array {
  const targetH = 32
  const targetW = 256
  const canvas = new OffscreenCanvas(targetW, targetH)
  const ctx = canvas.getContext('2d')!

  // Draw source image onto target canvas (resize)
  const temp = new OffscreenCanvas(image.width, image.height)
  const tctx = temp.getContext('2d')!
  tctx.putImageData(image, 0, 0)

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, targetW, targetH)

  // Maintain aspect ratio, center in target
  const scaleX = targetW / image.width
  const scaleY = targetH / image.height
  const scale = Math.min(scaleX, scaleY)
  const dw = Math.round(image.width * scale)
  const dh = Math.round(image.height * scale)
  const dx = Math.round((targetW - dw) / 2)
  const dy = Math.round((targetH - dh) / 2)
  ctx.drawImage(temp, 0, 0, image.width, image.height, dx, dy, dw, dh)

  const resized = ctx.getImageData(0, 0, targetW, targetH)
  const float32 = new Float32Array(targetH * targetW)
  for (let i = 0; i < targetH * targetW; i++) {
    // Grayscale, normalized to [0, 1]
    float32[i] = (0.299 * resized.data[i * 4] + 0.587 * resized.data[i * 4 + 1] + 0.114 * resized.data[i * 4 + 2]) / 255
  }
  return float32
}

/**
 * Prepare a single character for per-char inference.
 * Same as prepareModelInput but for individual segmented characters.
 */
export function prepareCharInput(charImage: ImageData): Float32Array {
  return prepareModelInput(charImage)
}
