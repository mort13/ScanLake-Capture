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
 * Autocrop to the bounding box of bright text, matching the Python
 * _autocrop_text() from word_cnn/dataset.py.
 * Uses 35% of peak brightness as the cut-off.
 * Returns cropped region as {x, y, w, h} or null if blank.
 */
function autocropBounds(gray: Float32Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let peak = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > peak) peak = gray[i]
  }
  if (peak < 10) return null

  const bright = Math.max(8, Math.round(peak * 0.35))

  // Column max
  let colLeft = w, colRight = -1
  for (let x = 0; x < w; x++) {
    let colMax = 0
    for (let y = 0; y < h; y++) {
      const v = gray[y * w + x]
      if (v > colMax) colMax = v
    }
    if (colMax > bright) {
      if (x < colLeft) colLeft = x
      colRight = x
    }
  }

  // Row max
  let rowTop = h, rowBottom = -1
  for (let y = 0; y < h; y++) {
    let rowMax = 0
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]
      if (v > rowMax) rowMax = v
    }
    if (rowMax > bright) {
      if (y < rowTop) rowTop = y
      rowBottom = y
    }
  }

  if (colRight < colLeft || rowBottom < rowTop) return null
  return { x: colLeft, y: rowTop, w: colRight - colLeft + 1, h: rowBottom - rowTop + 1 }
}

/**
 * Prepare an ROI for word_cnn inference.
 * Mirrors the Python pipeline: convert to grayscale, autocrop to text bounding
 * box, resize preserving aspect ratio (left-aligned, vertically centred, black
 * padding) into a 32×256 canvas, normalise to [0,1].
 * Returns null if the image has low contrast (max-min < 100).
 */
export function prepareModelInput(image: ImageData): Float32Array | null {
  const w = image.width
  const h = image.height
  const d = image.data

  // Convert to grayscale (0-255)
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  }

  // Contrast check: skip low-contrast images (matches Python predictor)
  let gMin = 255, gMax = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < gMin) gMin = gray[i]
    if (gray[i] > gMax) gMax = gray[i]
  }
  if (gMax - gMin < 100) return null

  // Autocrop to text bounding box (matches Python _autocrop_text)
  const crop = autocropBounds(gray, w, h)
  if (!crop) return null

  // Draw the cropped region onto a 256×32 canvas, left-aligned, vertically centred
  const TARGET_W = 256
  const TARGET_H = 32

  // Build a grayscale ImageData from the already-computed gray array so that
  // drawImage interpolates in grayscale — matching Python which converts to
  // uint8 gray first, then calls cv2.resize on the single-channel array.
  const grayU8 = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(gray[i])
    grayU8[i * 4]     = v
    grayU8[i * 4 + 1] = v
    grayU8[i * 4 + 2] = v
    grayU8[i * 4 + 3] = 255
  }
  const srcCanvas = new OffscreenCanvas(w, h)
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(new ImageData(grayU8, w, h), 0, 0)

  // Resize preserving aspect ratio
  const scale = Math.min(TARGET_W / crop.w, TARGET_H / crop.h)
  const dw = Math.round(crop.w * scale)
  const dh = Math.round(crop.h * scale)
  // Python: y_off = (target_h - new_h) // 2  →  floor, not round
  const dy = Math.floor((TARGET_H - dh) / 2)

  const outCanvas = new OffscreenCanvas(TARGET_W, TARGET_H)
  const outCtx = outCanvas.getContext('2d')!
  // Use high-quality smoothing to approximate cv2.INTER_AREA (area averaging)
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'
  outCtx.fillStyle = '#000'
  outCtx.fillRect(0, 0, TARGET_W, TARGET_H)
  // Left-aligned (dx=0), vertically centred
  outCtx.drawImage(srcCanvas, crop.x, crop.y, crop.w, crop.h, 0, dy, dw, dh)

  // Extract normalised grayscale from the red channel (all channels are equal)
  const resized = outCtx.getImageData(0, 0, TARGET_W, TARGET_H)
  const float32 = new Float32Array(TARGET_H * TARGET_W)
  for (let i = 0; i < TARGET_H * TARGET_W; i++) {
    float32[i] = resized.data[i * 4] / 255
  }
  return float32
}
