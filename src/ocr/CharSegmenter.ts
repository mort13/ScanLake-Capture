import type { RoiConfig } from './types'

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

/**
 * Shared resize helper: draws an image into a targetW×targetH canvas with
 * aspect-ratio-preserved scaling (left-aligned, vertically centred, black padding),
 * returns a grayscale Float32Array normalised to [0, 1].
 */
function resizeToFloat32(image: ImageData, targetW: number, targetH: number): Float32Array {
  const canvas = new OffscreenCanvas(targetW, targetH)
  const ctx = canvas.getContext('2d')!
  const temp = new OffscreenCanvas(image.width, image.height)
  const tctx = temp.getContext('2d')!
  tctx.putImageData(image, 0, 0)

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, targetW, targetH)

  const scale = Math.min(targetW / image.width, targetH / image.height)
  const dw = Math.round(image.width * scale)
  const dh = Math.round(image.height * scale)
  const dx = Math.round((targetW - dw) / 2)
  const dy = Math.round((targetH - dh) / 2)
  ctx.drawImage(temp, 0, 0, image.width, image.height, dx, dy, dw, dh)

  const resized = ctx.getImageData(0, 0, targetW, targetH)
  const float32 = new Float32Array(targetH * targetW)
  for (let i = 0; i < targetH * targetW; i++) {
    float32[i] = (0.299 * resized.data[i * 4] + 0.587 * resized.data[i * 4 + 1] + 0.114 * resized.data[i * 4 + 2]) / 255
  }
  return float32
}

/**
 * Prepare an ROI for word_cnn inference: resize to 32×256.
 */
export function prepareModelInput(image: ImageData): Float32Array {
  return resizeToFloat32(image, 256, 32)
}
