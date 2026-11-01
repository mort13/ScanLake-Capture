/**
 * What a valid volume looks like, for OCR text and typed input alike. Mirrors the volume
 * FieldSpec of ScanLake Desktop (scanlake_core/fields.py).
 *
 * Volumes under 1 SCU are shown in milli-SCU ("25.26m SCU"); they are stored in SCU (0.02526).
 */

// The HUD shows SCU with 2 decimals; up to 5 only below 1 SCU, which is what a converted milli
// value (0.02526) is, so it stays valid when typed or re-read.
const SCU = /^(\d{1,6}(\.\d{1,2})?|0\.\d{1,5})$/
const MILLI = /^\d{1,3}(\.\d{1,2})?$/ // as the HUD shows them: up to 999.99m

/** The volume in SCU as text, '' for empty input, or null when `text` is not a valid volume. */
export function normalizeVolume(text: string): string | null {
  const cleaned = text.trim().replace(/,/g, '.').replace(/ /g, '')
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
