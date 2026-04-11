import type { RoiResult, OutputSchemaNode, MasterProfile } from './types'
import type { ScanFormData, MaterialFormRow } from '../types'
import { DEPOSIT_TYPES } from '../data/deposits'
import { MATERIAL_TYPES } from '../data/materials'

/**
 * Map OCR results from ROIs into a ScanFormData object that can directly populate the form.
 * Walks the output_schema tree, combines _int/_dec pairs, applies 75% confidence threshold, and fuzzy-matches known values.
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
      // Only accept if confidence >= 75%
      if (r.confidence < CONFIDENCE_THRESHOLD) {
        confidences.set(key, r.confidence)
        return ''
      }
      confidences.set(key, r.confidence)
      return r.text.trim()
    }
    return ''
  }

  // Combine int + dec pairs with confidence threshold
  const combine = (intKey: string, decKey: string): string => {
    const intPart = get(intKey)
    const decPart = get(decKey)
    if (!intPart && !decPart) return ''
    // Merge confidences (take the minimum)
    const intConf = confidences.get(intKey) ?? 1
    const decConf = confidences.get(decKey) ?? 1
    confidences.set(intKey.replace('_int', ''), Math.min(intConf, decConf))
    if (!decPart) return intPart
    return `${intPart}.${decPart}`
  }

  // Deposit
  const rawDeposit = get('deposit_name') || get('deposit')
  const deposit = fuzzyMatch(rawDeposit, DEPOSIT_TYPES as unknown as string[])
  if (deposit) confidences.set('deposit', confidences.get('deposit_name') ?? confidences.get('deposit') ?? 0)

  // Mass
  const mass = get('mass')

  // Resistance
  const resistance = get('resistance')

  // Instability (combined int + dec)
  const instability = combine('instability_int', 'instability_dec')

  // Volume (combined int + dec)
  let volume = combine('volume_int', 'volume_dec')
  // Also check direct 'volume' key
  if (!volume) volume = get('volume')

  // Materials: extract from composition array in the schema
  const materials: MaterialFormRow[] = []
  for (let i = 0; i < 5; i++) {
    // Look for composition[i].* entries in the flat map
    const materialKey = `composition[${i}].name`
    const amountIntKey = `composition[${i}].amount_int`
    const amountDecKey = `composition[${i}].amount_dec`
    const qualityKey = `composition[${i}].quality`

    const rawName = flat.get(materialKey)?.text.trim() ?? ''
    const conf = flat.get(materialKey)?.confidence ?? 0
    if (rawName && conf >= CONFIDENCE_THRESHOLD) {
      confidences.set(`composition[${i}].name`, conf)
    }
    const materialType = fuzzyMatch(rawName, MATERIAL_TYPES as unknown as string[])

    const amountInt = flat.get(amountIntKey)?.text.trim() ?? ''
    const amountDec = flat.get(amountDecKey)?.text.trim() ?? ''
    const intConf = flat.get(amountIntKey)?.confidence ?? 0
    const decConf = flat.get(amountDecKey)?.confidence ?? 0

    // Only include amount if both components meet threshold
    let amount = ''
    if (intConf >= CONFIDENCE_THRESHOLD || decConf >= CONFIDENCE_THRESHOLD) {
      const intPart = intConf >= CONFIDENCE_THRESHOLD ? amountInt : ''
      const decPart = decConf >= CONFIDENCE_THRESHOLD ? amountDec : ''
      amount = intPart && decPart ? `${intPart}.${decPart}` : intPart || decPart
      confidences.set(`composition[${i}].amount`, Math.min(intConf, decConf))
    }

    const qualityRaw = flat.get(qualityKey)?.text.trim() ?? ''
    const qualConf = flat.get(qualityKey)?.confidence ?? 0
    if (qualityRaw && qualConf >= CONFIDENCE_THRESHOLD) {
      confidences.set(`composition[${i}].quality`, qualConf)
    }
    const quality = qualConf >= CONFIDENCE_THRESHOLD ? qualityRaw : ''

    if (materialType || amount || quality) {
      materials.push({
        type: materialType,
        amount: amount,
        quality: quality,
      })
    }
  }

  // Ensure at least one empty row
  if (materials.length === 0) {
    materials.push({ type: '', amount: '', quality: '' })
  }

  return {
    formData: {
      deposit,
      mass,
      resistance,
      instability,
      volume,
      materials,
    },
    confidences,
  }
}

/**
 * Walk the output_schema tree and collect all leaf ROI references,
 * building a Map from schema key path → RoiResult.
 * Preserves nested structure: composition[i].name, composition[i].amount_int, etc.
 */
function flattenSchema(
  nodes: OutputSchemaNode[],
  roiResults: Map<string, RoiResult>,
): Map<string, RoiResult> {
  const result = new Map<string, RoiResult>()

  function walk(nodes: OutputSchemaNode[], prefix = '') {
    for (const node of nodes) {
      // Build the full key path, handling arrays
      let keyPath = prefix
      if (prefix) {
        // If parent is an array (composition), use bracket notation: composition[i].key
        // Otherwise use dot notation: key.subkey
        if (prefix.includes('[')) {
          // Array context: append with dot
          keyPath = `${prefix}.${node.key}`
        } else {
          // Object context: use dot
          keyPath = prefix ? `${prefix}.${node.key}` : node.key
        }
      } else {
        keyPath = node.key
      }

      if (node.roi) {
        // Leaf: ROI reference
        const roiResult = roiResults.get(node.roi)
        if (roiResult) {
          result.set(keyPath, roiResult)
        }
      }

      if (node.children) {
        // Check if this node represents an array (composition has 5 items)
        if (node.key === 'composition' && Array.isArray(node.children)) {
          // composition is an array, repeat children for each slot (0-4)
          for (let i = 0; i < 5; i++) {
            walk(node.children, `composition[${i}]`)
          }
        } else {
          // Regular nested object
          walk(node.children, keyPath)
        }
      }
    }
  }

  walk(nodes)
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
