import type { RoiResult, OutputSchemaNode, MasterProfile } from './types'
import type { ScanFormData, MaterialFormRow } from '../types'
import { DEPOSIT_TYPES } from '../data/deposits'
import { MATERIAL_TYPES } from '../data/materials'

/**
 * Map OCR results from ROIs into a ScanFormData object that can directly populate the form.
 * Walks the output_schema tree, applies 75% confidence threshold, and fuzzy-matches known values.
 * The new schema emits direct keys (no _int/_dec pairs); amounts/instability/volume come whole from CRNN.
 */
export function mapResultsToForm(
  roiResults: Map<string, RoiResult>,
  profile: MasterProfile,
): { formData: ScanFormData; confidences: Map<string, number> } {
  const schema = profile.output_schema
  const flat = flattenSchema(schema, roiResults)
  const confidences = new Map<string, number>()
  const CONFIDENCE_THRESHOLD = 0.75

  // Extract values from the flattened schema results, applying confidence threshold
  const get = (key: string): string => {
    const r = flat.get(key)
    if (r) {
      confidences.set(key, r.confidence)
      if (r.confidence < CONFIDENCE_THRESHOLD) return ''
      return r.text.trim()
    }
    return ''
  }

  // Like get(), but strips a trailing % sign and normalizes comma to dot
  const getNumeric = (key: string): string => get(key).replace(/%$/, '').replace(/,/g, '.')

  // Detect the top-level wrapper prefix (new schema wraps everything under "scan")
  const firstKey = flat.keys().next().value as string | undefined
  const prefix = firstKey?.startsWith('scan.') ? 'scan.' : ''

  // Scalar fields
  const rawDeposit = get(`${prefix}deposit_name`) || get(`${prefix}deposit`)
  const deposit = fuzzyMatch(rawDeposit, DEPOSIT_TYPES as unknown as string[])
  if (deposit) confidences.set('deposit', confidences.get(`${prefix}deposit_name`) ?? confidences.get(`${prefix}deposit`) ?? 0)

  const mass = get(`${prefix}mass`)
  const resistance = getNumeric(`${prefix}resistance`)
  const instability = get(`${prefix}instability`)
  const volume = get(`${prefix}volume`)

  // Materials: named slots material1…material5
  const materials: MaterialFormRow[] = []
  for (const slot of ['material1', 'material2', 'material3', 'material4', 'material5']) {
    const base = `${prefix}composition.${slot}`
    const rawName = flat.get(`${base}.name`)?.text.trim() ?? ''
    const nameConf = flat.get(`${base}.name`)?.confidence ?? 0
    if (rawName && nameConf >= CONFIDENCE_THRESHOLD) {
      confidences.set(`${base}.name`, nameConf)
    }
    const materialType = nameConf >= CONFIDENCE_THRESHOLD ? fuzzyMatch(rawName, MATERIAL_TYPES as unknown as string[]) : ''

    const amount = getNumeric(`${base}.amount`)
    const quality = get(`${base}.quality`)

    if (materialType || amount || quality) {
      materials.push({ type: materialType, amount, quality })
    }
  }

  if (materials.length === 0) {
    materials.push({ type: '', amount: '', quality: '' })
  }

  return {
    formData: { deposit, mass, resistance, instability, volume, materials },
    confidences,
  }
}

/**
 * Walk the output_schema tree and collect all leaf ROI references into a flat Map.
 * Keys are dot-joined paths: e.g. "scan.composition.material1.amount"
 */
function flattenSchema(
  nodes: OutputSchemaNode[],
  roiResults: Map<string, RoiResult>,
): Map<string, RoiResult> {
  const result = new Map<string, RoiResult>()

  function walk(nodes: OutputSchemaNode[], prefix: string) {
    for (const node of nodes) {
      if (!node.key) continue  // skip malformed nodes
      const keyPath = prefix ? `${prefix}.${node.key}` : node.key

      if (node.roi) {
        const roiResult = roiResults.get(node.roi)
        if (roiResult) result.set(keyPath, roiResult)
      }

      if (node.children) {
        walk(node.children, keyPath)
      }
    }
  }

  walk(nodes, '')
  return result
}

/** Fuzzy match a recognized string to the closest known value using Levenshtein distance */
function fuzzyMatch(input: string, candidates: string[]): string {
  if (!input) return ''
  const lower = input.toLowerCase()

  // Try exact match first
  const exact = candidates.find(c => c.toLowerCase() === lower)
  if (exact) return exact

  // Find closest by Levenshtein distance
  let bestDist = Infinity
  let bestMatch = ''
  for (const candidate of candidates) {
    const dist = levenshtein(lower, candidate.toLowerCase())
    if (dist < bestDist) {
      bestDist = dist
      bestMatch = candidate
    }
  }

  // Only accept if distance is reasonable (< 40% of string length)
  const maxDist = Math.max(input.length, bestMatch.length) * 0.4
  return bestDist <= maxDist ? bestMatch : input
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
