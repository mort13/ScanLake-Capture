/**
 * What data/deposit_materials.json tells the word model: which materials a deposit can hold.
 *
 * Both directions: the deposit narrows its material slots (pickMaterial), and the material slots
 * settle an unsure deposit read (pickDeposit).
 */
import table from '../data/deposit_materials.json'
import type { WordCandidate } from './types'

/**
 * How much a material counts that the deposit is not known to contain, relative to one it is.
 *
 * At 0.01 the model has to be 100x surer of an outside material than of every listed one before
 * it wins. Ordinary misreads (an iron deposit's "Iron" read as "Tin") snap back to a listed
 * material, while a material the table lacks can still be read when the model is certain.
 */
export const OUTSIDE_DEPOSIT_WEIGHT = 0.01

/**
 * A deposit name the deposit slot gives less probability than this is never chosen because its
 * materials fit: the materials only settle between names the deposit read itself finds plausible.
 */
export const PLAUSIBLE_DEPOSIT = 0.02

const BY_DEPOSIT = new Map<string, ReadonlySet<string>>(
  Object.entries(table.deposits as Record<string, string[]>).map(([deposit, materials]) => [
    deposit.toLowerCase(),
    new Set(materials.map(m => m.toLowerCase())),
  ]),
)

const ONE_ENTRY = new Set((table.one_entry as string[]).map(d => d.toLowerCase()))
const NOTHING: ReadonlySet<string> = new Set()

/** The materials `deposit` can contain (lower case), or null when the table does not restrict it. */
export function depositMaterials(deposit: string): ReadonlySet<string> | null {
  return BY_DEPOSIT.get(deposit.trim().toLowerCase()) ?? null
}

/**
 * The materials composition row `row` (0 = top) of `deposit` can show: as depositMaterials,
 * except that below the single row of a 'one_entry' deposit nothing can (an empty set: blank only).
 */
export function rowMaterials(deposit: string, row: number): ReadonlySet<string> | null {
  const key = deposit.trim().toLowerCase()
  if (row > 0 && ONE_ENTRY.has(key)) return NOTHING
  return BY_DEPOSIT.get(key) ?? null
}

/**
 * Re-pick a material slot's word label knowing which materials the deposit can hold.
 *
 * `toMaterial` turns a model label into a material name ('' for the blank class, which is
 * always allowed). Each label's probability is weighted by OUTSIDE_DEPOSIT_WEIGHT when its
 * material is not in `allowed`; the result is the best label and its renormalised probability.
 */
export function pickMaterial(
  candidates: readonly WordCandidate[],
  allowed: ReadonlySet<string>,
  toMaterial: (label: string) => string,
): WordCandidate {
  let best: WordCandidate = { label: '', prob: 0 }
  let bestScore = -1
  let total = 0
  for (const { label, prob } of candidates) {
    const material = toMaterial(label).toLowerCase()
    const score = prob * (material === '' || allowed.has(material) ? 1 : OUTSIDE_DEPOSIT_WEIGHT)
    total += score
    if (score > bestScore) {
      bestScore = score
      best = { label, prob }
    }
  }
  return { label: best.label, prob: total > 0 ? bestScore / total : 0 }
}

/**
 * How well one material slot fits a deposit that can hold `allowed`, against a deposit with no
 * restriction (1 = no evidence either way, as for a blank slot).
 *
 * The word model's probabilities assume every material equally likely; this is how much more
 * likely the slot's reading becomes when only the deposit's materials are (OUTSIDE_DEPOSIT_WEIGHT
 * for the rest). A slot read as a listed material counts for the deposit, the more so the
 * shorter its list; one read as a material it cannot hold counts against it. With nothing
 * allowed (below a one_entry deposit's row) any material counts against it.
 */
export function slotFit(
  slot: readonly WordCandidate[],
  allowed: ReadonlySet<string>,
  toMaterial: (label: string) => string,
): number {
  let blank = 0
  let fit = 0
  let read = 0
  let materials = 0
  let weights = 0
  for (const { label, prob } of slot) {
    const material = toMaterial(label).toLowerCase()
    if (material === '') {
      blank += prob
      continue
    }
    const weight = allowed.has(material) ? 1 : OUTSIDE_DEPOSIT_WEIGHT
    materials += 1
    weights += weight
    fit += prob * weight
    read += prob
  }
  if (allowed.size === 0) return blank + OUTSIDE_DEPOSIT_WEIGHT * read
  return weights > 0 ? blank + (fit * materials) / weights : 1
}

/**
 * Pick the deposit from the deposit slot's word probabilities AND the material slots together.
 *
 * The plausible deposit names (>= PLAUSIBLE_DEPOSIT) share out their probability anew, each
 * weighted by how well every material slot fits it (names the table does not list fit any
 * material). The materials never move probability to or from the other names, so a deposit read
 * as the only plausible name keeps its probability whatever the materials say. Returns the best
 * label with its new probability.
 *
 * `slots[row]` is composition row `row`'s word probabilities (undefined: not read).
 */
export function pickDeposit(
  deposit: readonly WordCandidate[],
  slots: readonly (readonly WordCandidate[] | undefined)[],
  toDeposit: (label: string) => string,
  toMaterial: (label: string) => string,
): WordCandidate {
  const materialOf = memo(toMaterial)
  const plausible = deposit.filter(c => c.prob >= PLAUSIBLE_DEPOSIT)
  const mass = plausible.reduce((sum, c) => sum + c.prob, 0)
  const scores = plausible.map(({ label, prob }) => {
    const name = toDeposit(label)
    let score = prob
    slots.forEach((slot, row) => {
      const allowed = slot ? rowMaterials(name, row) : null
      if (slot && allowed) score *= slotFit(slot, allowed, materialOf)
    })
    return score
  })
  const total = scores.reduce((a, b) => a + b, 0)
  const reweighed = new Map(plausible.map((c, i) => [c, total > 0 ? (mass * scores[i]) / total : c.prob]))

  let best: WordCandidate = { label: '', prob: 0 }
  for (const c of deposit) {
    const prob = reweighed.get(c) ?? c.prob
    if (prob > best.prob) best = { label: c.label, prob }
  }
  return best
}

function memo(f: (label: string) => string): (label: string) => string {
  const seen = new Map<string, string>()
  return label => {
    let value = seen.get(label)
    if (value === undefined) {
      value = f(label)
      seen.set(label, value)
    }
    return value
  }
}
