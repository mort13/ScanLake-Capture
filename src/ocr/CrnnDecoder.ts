import type { ModelMeta } from './types'

/**
 * Greedy CTC decode: collapse consecutive duplicates and remove blanks.
 * Input logProbs is a flattened [T, batch=1, C] Float32Array (row-major).
 */
export function greedyCTCDecode(
  logProbs: Float32Array,
  timeSteps: number,
  numClasses: number,
  blankIdx: number,
): number[] {
  const result: number[] = []
  let prevIdx = -1

  for (let t = 0; t < timeSteps; t++) {
    let maxIdx = 0
    let maxVal = -Infinity
    for (let c = 0; c < numClasses; c++) {
      const val = logProbs[t * numClasses + c]
      if (val > maxVal) {
        maxVal = val
        maxIdx = c
      }
    }

    if (maxIdx !== prevIdx && maxIdx !== blankIdx) {
      result.push(maxIdx)
    }
    prevIdx = maxIdx
  }
  return result
}

/**
 * Convert decoded CTC indices to a text string.
 * Indices are 1-based (blank=0, charClasses[0]=1, charClasses[1]=2, ...).
 */
export function indicesToText(indices: number[], charClasses: string): string {
  return indices
    .map(i => (i > 0 && i <= charClasses.length ? charClasses[i - 1] : '?'))
    .join('')
}

/**
 * Compute mean confidence over non-blank predicted timesteps.
 * logProbs contains log-softmax outputs, so exp() converts to probabilities.
 */
export function computeConfidence(
  logProbs: Float32Array,
  timeSteps: number,
  numClasses: number,
  blankIdx: number,
): number {
  let sumProb = 0
  let count = 0
  let prevIdx = -1

  for (let t = 0; t < timeSteps; t++) {
    let maxIdx = 0
    let maxVal = -Infinity
    for (let c = 0; c < numClasses; c++) {
      const val = logProbs[t * numClasses + c]
      if (val > maxVal) {
        maxVal = val
        maxIdx = c
      }
    }

    // Only count timesteps that contribute to the decoded output
    if (maxIdx !== blankIdx && maxIdx !== prevIdx) {
      sumProb += Math.exp(maxVal)
      count++
    }
    prevIdx = maxIdx
  }

  return count > 0 ? sumProb / count : 0
}

/**
 * Validate decoded text against expected format patterns from the metadata.
 * Returns true if the text matches any known format, or if no formats are defined.
 */
export function validateFormat(text: string, formatPattern: string, meta: ModelMeta): boolean {
  if (!meta.formats || !text) return true

  // If a specific format_pattern hint is provided by the ROI, use heuristic matching
  if (formatPattern) {
    if (formatPattern.includes('.') && formatPattern.includes('%')) {
      return /^\d{1,2}\.\d{2}%$/.test(text)
    }
    if (formatPattern.includes('.')) {
      return /^\d{1,3}\.\d{2}$/.test(text)
    }
    if (formatPattern.includes('%')) {
      return /^\d{1,2}%$/.test(text)
    }
    return /^\d{1,6}$/.test(text)
  }

  // Otherwise try all defined formats from the metadata
  for (const regex of Object.values(meta.formats)) {
    if (new RegExp(regex).test(text)) return true
  }
  return false
}

/**
 * Preprocess an ROI ImageData for CRNN inference: autocrop, resize+pad to 32×256.
 * Mirrors the Python digit_crnn/dataset.py preprocessing.
 */
export function preprocessForCrnn(image: ImageData): Float32Array | null {
  const w = image.width
  const h = image.height
  const d = image.data

  // Convert to grayscale
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  }

  // Contrast check: max - min >= 100
  let gMin = 255, gMax = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < gMin) gMin = gray[i]
    if (gray[i] > gMax) gMax = gray[i]
  }
  if (gMax - gMin < 100) return null // low contrast — skip

  // Autocrop: bounding box of pixels > 35% of peak brightness
  const threshold = gMax * 0.35
  let cropLeft = w, cropRight = 0, cropTop = h, cropBottom = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] > threshold) {
        if (x < cropLeft) cropLeft = x
        if (x > cropRight) cropRight = x
        if (y < cropTop) cropTop = y
        if (y > cropBottom) cropBottom = y
      }
    }
  }

  if (cropRight <= cropLeft || cropBottom <= cropTop) return null

  const cropW = cropRight - cropLeft + 1
  const cropH = cropBottom - cropTop + 1

  // Resize+pad to 32×256 (left-aligned, vertically centred, black padding)
  const TARGET_H = 32
  const TARGET_W = 256

  // Create a temporary canvas to do the cropping
  const cropCanvas = new OffscreenCanvas(cropW, cropH)
  const cropCtx = cropCanvas.getContext('2d')!
  const srcCanvas = new OffscreenCanvas(w, h)
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(image, 0, 0)
  cropCtx.drawImage(srcCanvas, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH)

  // Resize preserving aspect ratio, left-align, vertically center
  const scale = Math.min(TARGET_W / cropW, TARGET_H / cropH)
  const dw = Math.round(cropW * scale)
  const dh = Math.round(cropH * scale)
  const dy = Math.round((TARGET_H - dh) / 2)

  const outCanvas = new OffscreenCanvas(TARGET_W, TARGET_H)
  const outCtx = outCanvas.getContext('2d')!
  outCtx.fillStyle = '#000'
  outCtx.fillRect(0, 0, TARGET_W, TARGET_H)
  outCtx.drawImage(cropCanvas, 0, 0, cropW, cropH, 0, dy, dw, dh) // left-aligned: dx=0

  // Convert to normalized Float32Array
  const resized = outCtx.getImageData(0, 0, TARGET_W, TARGET_H)
  const float32 = new Float32Array(TARGET_H * TARGET_W)
  for (let i = 0; i < TARGET_H * TARGET_W; i++) {
    float32[i] =
      (0.299 * resized.data[i * 4] +
        0.587 * resized.data[i * 4 + 1] +
        0.114 * resized.data[i * 4 + 2]) /
      255
  }
  return float32
}
