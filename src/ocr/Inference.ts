import * as ort from 'onnxruntime-web'
import type { RoiConfig, RoiResult } from './types'
import { getCrnnSession, getWordSession, getCrnnMeta, getWordMeta } from './ModelLoader'
import { prepareModelInput } from './CharSegmenter'
import {
  greedyCTCDecode,
  indicesToText,
  computeConfidence,
  validateFormat,
  preprocessForCrnn,
} from './CrnnDecoder'

/**
 * Run inference on a single ROI image and return the recognized text + confidence.
 */
export async function recognizeRoi(
  roiImage: ImageData,
  roi: RoiConfig,
): Promise<RoiResult> {
  if (roi.recognition_mode === 'word_cnn') {
    return recognizeWord(roiImage, roi)
  } else if (roi.recognition_mode === 'digit_crnn') {
    return recognizeCrnn(roiImage, roi)
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

  // prepareModelInput returns null for low-contrast / blank images
  if (!input) {
    return { roiName: roi.name, text: '', confidence: 0 }
  }

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
  const WORD_THRESHOLD = 0.5
  if (confidence < WORD_THRESHOLD) {
    return { roiName: roi.name, text: '', confidence }
  }

  return {
    roiName: roi.name,
    text: label,
    confidence,
  }
}

/** Recognize a digit sequence using the CRNN model with CTC decoding */
async function recognizeCrnn(
  roiImage: ImageData,
  roi: RoiConfig,
): Promise<RoiResult> {
  const session = await getCrnnSession()
  const meta = await getCrnnMeta()
  const timeSteps = meta.timeSteps ?? 64
  const blankIdx = meta.blankIdx ?? 0

  // Preprocess: autocrop + resize to 32×256
  const input = preprocessForCrnn(roiImage)
  if (!input) {
    // Low contrast — skip
    return { roiName: roi.name, text: '', confidence: 0 }
  }

  // Input: (1, 1, 32, 256)
  const tensor = new ort.Tensor('float32', input, [1, 1, 32, 256])
  const inputName = session.inputNames[0]
  const results = await session.run({ [inputName]: tensor })
  const output = results[session.outputNames[0]]
  const logProbs = output.data as Float32Array

  // Greedy CTC decode
  const decodedIndices = greedyCTCDecode(logProbs, timeSteps, meta.numClasses, blankIdx)
  const text = indicesToText(decodedIndices, meta.charClasses)
  const confidence = computeConfidence(logProbs, timeSteps, meta.numClasses, blankIdx)

  // Format validation: reject invalid sequences
  if (text && !validateFormat(text, roi.format_pattern, meta)) {
    return { roiName: roi.name, text: '', confidence: 0 }
  }

  const CRNN_THRESHOLD = 0.75
  if (confidence < CRNN_THRESHOLD) {
    return { roiName: roi.name, text: '', confidence }
  }

  return {
    roiName: roi.name,
    text,
    confidence,
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
