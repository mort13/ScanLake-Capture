import * as ort from 'onnxruntime-web'
import type { ModelMeta } from './types'

let digitSession: ort.InferenceSession | null = null
let wordSession: ort.InferenceSession | null = null
let digitMeta: ModelMeta | null = null
let wordMeta: ModelMeta | null = null

// Configure onnxruntime-web WASM paths
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'

export async function getDigitMeta(): Promise<ModelMeta> {
  if (digitMeta) return digitMeta
  const resp = await fetch('/models/digit_cnn.json')
  digitMeta = (await resp.json()) as ModelMeta
  return digitMeta
}

export async function getWordMeta(): Promise<ModelMeta> {
  if (wordMeta) return wordMeta
  const resp = await fetch('/models/word_cnn.json')
  wordMeta = (await resp.json()) as ModelMeta
  return wordMeta
}

export async function getDigitSession(): Promise<ort.InferenceSession> {
  if (digitSession) return digitSession
  const [modelBuffer, dataBuffer] = await Promise.all([
    fetch('/models/digit_cnn.onnx').then(r => r.arrayBuffer()),
    fetch('/models/digit_cnn.onnx.data').then(r => r.arrayBuffer()),
  ])
  digitSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    externalData: [{ path: 'digit_cnn.onnx.data', data: dataBuffer }],
  })
  return digitSession
}

export async function getWordSession(): Promise<ort.InferenceSession> {
  if (wordSession) return wordSession
  const [modelBuffer, dataBuffer] = await Promise.all([
    fetch('/models/word_cnn.onnx').then(r => r.arrayBuffer()),
    fetch('/models/word_cnn.onnx.data').then(r => r.arrayBuffer()),
  ])
  wordSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    externalData: [{ path: 'word_cnn.onnx.data', data: dataBuffer }],
  })
  return wordSession
}

export async function preloadModels(): Promise<void> {
  await Promise.all([getDigitSession(), getWordSession(), getDigitMeta(), getWordMeta()])
}
