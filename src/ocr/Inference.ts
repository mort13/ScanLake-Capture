import * as ort from 'onnxruntime-web'
import type { RoiConfig, RoiResult } from './types'
import { getDigitSession, getWordSession, getDigitMeta, getWordMeta } from './ModelLoader'
import { segmentCharacters, prepareModelInput, prepareCharInput } from './CharSegmenter'

/**
 * Run inference on a single ROI image and return the recognized text + confidence.
 */
export async function recognizeRoi(
  roiImage: ImageData,
  roi: RoiConfig,
): Promise<RoiResult> {
  if (roi.recognition_mode === 'word_cnn') {
    return recognizeWord(roiImage, roi)
  } else if (roi.recognition_mode === 'cnn') {
    return recognizeChars(roiImage, roi)
  }
  // template mode not implemented for web yet
  return { roiName: roi.name, text: '', confidence: 0 }
}

/** Recognize entire ROI as a word using word_cnn model */
async function recognizeWord(
  roiImage: ImageData,
  roi: RoiConfig,
): Promise<RoiResult> {
  const session = await getWordSession()
  const meta = await getWordMeta()
  const input = prepareModelInput(roiImage)

  const tensor = new ort.Tensor('float32', input, [1, 1, 32, 256])
  const inputName = session.inputNames[0]
  const results = await session.run({ [inputName]: tensor })
  const output = results[session.outputNames[0]]
  const data = output.data as Float32Array
  const dims = output.dims as number[]

  // word_cnn outputs class scores over word labels (not char classes).
  // Use wordClasses array from JSON when available; fall back to charClasses string.
  const labels: string[] = meta.wordClasses ?? [...meta.charClasses]
  const numClasses = labels.length

  // Output is [1, numClasses] — simple argmax classification
  let bestIdx = 0
  let bestVal = -Infinity
  const classCount = dims.length === 2 ? dims[1] : data.length
  for (let i = 0; i < Math.min(classCount, numClasses); i++) {
    if (data[i] > bestVal) { bestVal = data[i]; bestIdx = i }
  }
  const confidence = softmaxMax(data, 0, Math.min(classCount, numClasses))

  // If the model predicted an "empty" class, the field is blank
  const label = labels[bestIdx] ?? '?'
  if (label.toLowerCase() === 'empty' || label.toLowerCase() === 'none') {
    return { roiName: roi.name, text: '', confidence: 0 }
  }

  // Below confidence threshold → treat as unrecognized
  const WORD_THRESHOLD = 0.75
  if (confidence < WORD_THRESHOLD) {
    return { roiName: roi.name, text: '', confidence }
  }

  return {
    roiName: roi.name,
    text: label,
    confidence,
  }
}

/** Recognize individual characters using digit_cnn model */
async function recognizeChars(
  roiImage: ImageData,
  roi: RoiConfig,
): Promise<RoiResult> {
  const session = await getDigitSession()
  const meta = await getDigitMeta()
  const segments = segmentCharacters(roiImage, roi)

  const CHAR_THRESHOLD = 0.75
  let totalText = ''
  const segmentConfidences: number[] = []
  const contributingConfs: number[] = []

  for (const seg of segments) {
    const input = prepareCharInput(seg)
    // DigitCNN takes 28×28 input
    const tensor = new ort.Tensor('float32', input, [1, 1, 28, 28])
    const inputName = session.inputNames[0]
    const results = await session.run({ [inputName]: tensor })
    const output = results[session.outputNames[0]]
    const probs = output.data as Float32Array

    // Get best prediction (possibly filtered by allowed_chars)
    const { char, confidence } = bestPrediction(probs, meta.charClasses, roi.allowed_chars)
    segmentConfidences.push(confidence)

    if (confidence >= CHAR_THRESHOLD) {
      totalText += char
      contributingConfs.push(confidence)
    }
    // Below threshold: skip this segment (likely empty space)
  }

  const overallConfidence = contributingConfs.length > 0
    ? contributingConfs.reduce((a, b) => a + b, 0) / contributingConfs.length
    : 0

  return {
    roiName: roi.name,
    text: totalText,
    confidence: overallConfidence,
    segmentConfidences,
  }
}

/** Get best prediction, optionally filtering by allowed chars */
function bestPrediction(
  probs: Float32Array,
  charClasses: string,
  allowedChars: string,
): { char: string; confidence: number } {
  let bestIdx = 0
  let bestVal = -Infinity

  for (let i = 0; i < charClasses.length && i < probs.length; i++) {
    if (allowedChars && !allowedChars.includes(charClasses[i])) continue
    if (probs[i] > bestVal) {
      bestVal = probs[i]
      bestIdx = i
    }
  }

  // Softmax confidence for the winning class
  const conf = softmaxMax(probs, 0, Math.min(charClasses.length, probs.length))

  return {
    char: bestIdx < charClasses.length ? charClasses[bestIdx] : '?',
    confidence: conf,
  }
}

/** Compute softmax probability of the max element */
function softmaxMax(data: Float32Array, offset: number, len: number): number {
  let maxVal = -Infinity
  for (let i = 0; i < len; i++) {
    if (data[offset + i] > maxVal) maxVal = data[offset + i]
  }
  let sumExp = 0
  for (let i = 0; i < len; i++) {
    sumExp += Math.exp(data[offset + i] - maxVal)
  }
  return 1 / sumExp // exp(0) / sumExp = 1/sumExp since we subtracted max
}
