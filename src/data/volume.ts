/**
 * Scan volume and mass as the HUD shows them (the same rules as ScanLake Desktop's fields.py).
 *
 * Deposits under 1 SCU show their volume in milli-SCU ("25.26m SCU"). It is stored in SCU
 * (0.02526), and such a deposit's mass is the only one with decimals ("12.34"). The web's digit
 * model has no "m": it reads "25.26m" with a third character after the two decimals ("25.266",
 * "25.264", "25.26%"), which the HUD never shows otherwise, so `volumeFromOcr` turns it back into
 * "25.26m".
 */

const SCU = /^\d{1,6}(?:\.\d{1,2})?$|^0\.\d{1,5}$/ // as shown (2 decimals), or a stored mSCU value
const MILLI = /^(\d{1,3})(?:\.(\d{1,2}))?m$/
const MASS = /^\d{1,7}$|^\d{1,3}\.\d{1,2}$/
const OCR_MILLI = /^(\d{1,3}\.\d{2})(?:m|[0-9%]{1,2})$/

function clean(text: string): string {
  return text.trim().replace(/,/g, '.').replace(/\s+/g, '').replace(/scu$/i, '').toLowerCase()
}

/** A volume in SCU from what was read or typed ("12.90", "12.90 SCU", "25.26m"), or null. */
export function parseVolume(text: string): number | null {
  const t = clean(text)
  const milli = MILLI.exec(t)
  if (milli) {
    // digits / 10^k is exact to the nearest double; 25.26 / 1000 is not (0.025259999999999998)
    const frac = milli[2] ?? ''
    return Number(milli[1] + frac) / 10 ** (frac.length + 3)
  }
  return SCU.test(t) ? Number(t) : null
}

/** Whether a volume is given in milli-SCU ("25.26m"). */
export function isMilli(text: string): boolean {
  return MILLI.test(clean(text))
}

/** The volume field's text for an OCR read: milli volumes the model read without their "m"
 *  ("25.266", "25.26%") become "25.26m"; anything else is left as read. */
export function volumeFromOcr(text: string): string {
  const read = OCR_MILLI.exec(text.trim())
  return read ? `${read[1]}m` : text.trim()
}

/** Whether `text` is a volume read the OCR may pass on: SCU as shown, or a milli read. */
export function isVolumeRead(text: string): boolean {
  return SCU.test(text) || OCR_MILLI.test(text)
}

/** A mass from what was read or typed: whole, or with decimals ("12.34", deposits under
 *  1 SCU only, see `massDecimalsAllowed`); null when not a mass. */
export function parseMass(text: string): number | null {
  const t = text.trim().replace(/,/g, '.')
  if (!MASS.test(t)) return null
  const mass = Number(t)
  return mass > 0 ? mass : null
}

/** The HUD shows a mass with decimals only for deposits under 1 SCU. */
export function massDecimalsAllowed(massText: string, volumeScu: number | null): boolean {
  return !massText.includes('.') && !massText.includes(',') || (volumeScu !== null && volumeScu < 1)
}

/** A material's volume in SCU: 5 places, so deposits under 1 SCU do not round to 0. */
export function materialVolume(volumeScu: number, amountPercent: number): number {
  return Math.round(volumeScu * amountPercent * 1000) / 1e5
}

/** A volume in SCU for display: 2 places, 5 under 1 SCU. */
export function formatScu(scu: number): string {
  return scu > 0 && scu < 1 ? scu.toFixed(5) : scu.toFixed(2)
}
