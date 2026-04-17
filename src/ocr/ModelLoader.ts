import * as ort from 'onnxruntime-web'
import type { ModelMeta } from './types'

let crnnSession: ort.InferenceSession | null = null
let wordSession: ort.InferenceSession | null = null
let crnnMeta: ModelMeta | null = null
let wordMeta: ModelMeta | null = null

// Configure onnxruntime-web WASM paths
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'

// word_model.onnx.data is too large for Cloudflare Pages (>25 MiB) so it is
// stored in R2 and served via the ScanLake Gateway worker.
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? ''

export async function getCrnnMeta(): Promise<ModelMeta> {
  if (crnnMeta) return crnnMeta
  const resp = await fetch('/models/digit_crnn.json')
  crnnMeta = (await resp.json()) as ModelMeta
  return crnnMeta
}

export async function getWordMeta(): Promise<ModelMeta> {
  if (wordMeta) return wordMeta
  const resp = await fetch('/models/word_model.json')
  wordMeta = (await resp.json()) as ModelMeta
  return wordMeta
}

export async function getCrnnSession(): Promise<ort.InferenceSession> {
  if (crnnSession) return crnnSession
  const [modelBuffer, dataBuffer] = await Promise.all([
    fetch('/models/digit_crnn.onnx').then(r => r.arrayBuffer()),
    fetch('/models/digit_crnn.onnx.data').then(r => r.arrayBuffer()),
  ])
  crnnSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    externalData: [{ path: 'digit_crnn.onnx.data', data: dataBuffer }],
  })
  return crnnSession
}

export async function getWordSession(): Promise<ort.InferenceSession> {
  if (wordSession) return wordSession
  const [modelBuffer, dataBuffer] = await Promise.all([
    fetch('/models/word_model.onnx').then(r => r.arrayBuffer()),
    fetch(`${GATEWAY_URL}/public/models/word_model.onnx.data`).then(r => r.arrayBuffer()),
  ])
  wordSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    externalData: [{ path: 'word_model.onnx.data', data: dataBuffer }],
  })
  return wordSession
}

export async function preloadModels(): Promise<void> {
  await Promise.all([getCrnnSession(), getWordSession(), getCrnnMeta(), getWordMeta()])
}
