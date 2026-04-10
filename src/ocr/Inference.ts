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

  // Decode output — model output shape determines decoding strategy
  const decoded = decodeCTCOrClassOutput(data, meta.charClasses, output.dims as number[])

  return {
    roiName: roi.name,
    text: decoded.text,
    confidence: decoded.confidence,
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

  let totalText = ''
  let minConfidence = 1.0

  for (const seg of segments) {
    const input = prepareCharInput(seg)
    const tensor = new ort.Tensor('float32', input, [1, 1, 32, 256])
    const inputName = session.inputNames[0]
    const results = await session.run({ [inputName]: tensor })
    const output = results[session.outputNames[0]]
    const probs = output.data as Float32Array

    // Get best prediction (possibly filtered by allowed_chars)
    const { char, confidence } = bestPrediction(probs, meta.charClasses, roi.allowed_chars)
    totalText += char
    if (confidence < minConfidence) minConfidence = confidence
  }

  return {
    roiName: roi.name,
    text: totalText,
    confidence: minConfidence,
  }
}

/**
 * Decode model output — handles both CTC-style sequential output and
 * simple classification output.
 */
function decodeCTCOrClassOutput(
  data: Float32Array,
  charClasses: string,
  dims: number[],
): { text: string; confidence: number } {
  const numClasses = charClasses.length

  if (dims.length === 3) {
    // CTC output: [1, seqLen, numClasses] — greedy decode
    const seqLen = dims[1]
    let text = ''
    let totalConf = 0
    let count = 0
    let prevIdx = -1

    for (let t = 0; t < seqLen; t++) {
      const offset = t * dims[2]
      let maxIdx = 0
      let maxVal = data[offset]
      for (let c = 1; c < dims[2]; c++) {
        if (data[offset + c] > maxVal) {
          maxVal = data[offset + c]
          maxIdx = c
        }
      }
      // Apply softmax for confidence
      const conf = softmaxMax(data, offset, dims[2])

      // CTC blank token is typically the last class or index 0
      const blankIdx = dims[2] - 1 >= numClasses ? dims[2] - 1 : -1

      if (maxIdx !== blankIdx && maxIdx !== prevIdx && maxIdx < numClasses) {
        text += charClasses[maxIdx]
        totalConf += conf
        count++
      }
      prevIdx = maxIdx
    }

    return {
      text,
      confidence: count > 0 ? totalConf / count : 0,
    }
  }

  if (dims.length === 2) {
    // Simple classification: [1, numClasses]
    const { char, confidence } = bestPrediction(data, charClasses, '')
    return { text: char, confidence }
  }

  // Fallback: treat as flat classification
  const { char, confidence } = bestPrediction(data, charClasses, '')
  return { text: char, confidence }
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
