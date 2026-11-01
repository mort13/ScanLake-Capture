/**
 * What a valid volume or mass looks like, for OCR text and typed input alike. Mirrors the
 * FieldSpecs and validation of ScanLake Desktop (scanlake_core/fields.py, domain/validation.py).
 *
 * Volumes under 1 SCU are shown in milli-SCU ("25.26m SCU"); they are stored in SCU (0.02526).
 * Those deposits also show decimal masses ("12.34").
 */

// The HUD shows SCU with 2 decimals; up to 5 only below 1 SCU, which is what a converted milli
// value (0.02526) is, so it stays valid when typed or re-read.
const SCU = /^(\d{1,6}(\.\d{1,2})?|0\.\d{1,5})$/
const MILLI = /^\d{1,3}(\.\d{1,2})?$/ // as the HUD shows them: up to 999.99m
// Whole numbers, except deposits under 1 SCU (mSCU), which show e.g. "12.34". Decimals only with
// at most 3 integer digits, so a misread dot (1182.6) is still refused.
const MASS = /^(\d{1,7}|\d{1,3}\.\d{1,2})$/
const MIN_MASS = 0.01

function clean(text: string): string {
  return text.trim().replace(/,/g, '.').replace(/ /g, '')
}

/** The volume in SCU as text, '' for empty input, or null when `text` is not a valid volume. */
export function normalizeVolume(text: string): string | null {
  const cleaned = clean(text)
  if (cleaned === '') return ''
  // A "%" is a misread: models without the "m" read "25.26m" as "25.266%"
  if (cleaned.endsWith('%')) return null
  if (/m$/i.test(cleaned)) {
    const milli = cleaned.slice(0, -1)
    if (!MILLI.test(milli)) return null
    // Move the decimal point on the digits, so 25.26m is exactly 0.02526 (no float artefacts)
    const [int, frac = ''] = milli.split('.')
    return `0.${int.padStart(3, '0')}${frac}`.replace(/\.?0+$/, '')
  }
  return SCU.test(cleaned) ? cleaned : null
}

/** The volume in SCU, or NaN when `text` is empty or not a valid volume. */
export function parseVolume(text: string): number {
  const normalized = normalizeVolume(text)
  return normalized ? parseFloat(normalized) : NaN
}

/** material_volume (volume * amount / 100) to 5 places, not 2: milli deposits would round to 0.01 or 0 */
export function materialVolume(volume: number, amount: number): number {
  return Math.round(volume * amount / 100 * 1e5) / 1e5
}

/** The mass as text, '' for empty input, or null when `text` is not a valid mass. */
export function normalizeMass(text: string): string | null {
  const cleaned = clean(text)
  if (cleaned === '') return ''
  const number = cleaned.replace(/%$/, '')
  return MASS.test(number) && parseFloat(number) >= MIN_MASS ? number : null
}

/** The mass, or NaN when `text` is empty or not a valid mass. */
export function parseMass(text: string): number {
  const normalized = normalizeMass(text)
  return normalized ? parseFloat(normalized) : NaN
}

/** False for a mass with decimals on a deposit of 1 SCU or more: the HUD only shows those in mSCU. */
export function massDecimalsAllowed(mass: string, volume: number): boolean {
  return !(normalizeMass(mass)?.includes('.') && volume >= 1)
}
