import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  massDecimalsAllowed, materialVolume, normalizeMass, normalizeVolume, parseMass, parseVolume,
} from '../src/data/fields.ts'

// The volume cases of ScanLake Desktop's tests/test_logic.py, plus a few of Capture's own
const cases: [string, string | null][] = [
  ['42,1', '42.1'],
  ['25.26m', '0.02526'], // milli-SCU on the HUD, stored in SCU
  ['0.02526', '0.02526'], // ... and stays valid when re-read or typed
  ['313.40m', '0.3134'],
  ['7m', '0.007'],
  ['999.99m', '0.99999'],
  ['25.26 M', '0.02526'],
  ['0m', '0'],
  ['1234.00m', null], // the HUD shows SCU from 1000m on
  ['12.345m', null],
  ['25.266%', null], // how models without "m" read 25.26m
  ['25.266', null], // 3 decimals only below 1 SCU
  ['25.26%', null],
  ['1.00001', null],
  ['1234567', null],
  ['12.34', '12.34'],
  ['', ''],
  ['  ', ''],
]

for (const [text, expected] of cases) {
  test(`normalizeVolume(${JSON.stringify(text)}) is ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeVolume(text), expected)
  })
}

test('a converted milli volume normalizes to itself', () => {
  const scu = normalizeVolume('25.26m')!
  assert.equal(normalizeVolume(scu), scu)
  assert.equal(normalizeVolume(String(parseVolume('25.26m'))), scu)
})

test('parseVolume is NaN for empty or invalid input', () => {
  assert.equal(parseVolume('25.26m'), 0.02526)
  assert.ok(Number.isNaN(parseVolume('')))
  assert.ok(Number.isNaN(parseVolume('25.266%')))
})

test('materialVolume keeps 5 places so milli deposits do not collapse', () => {
  assert.equal(materialVolume(0.02526, 30), 0.00758)
  assert.equal(materialVolume(12.34, 42.09), 5.19391)
  assert.equal(materialVolume(0.02526, 100), 0.02526)
})

// The mass cases of ScanLake Desktop's tests/test_logic.py, plus a few of Capture's own
const massCases: [string, string | null][] = [
  ['11826', '11826'],
  ['1182.6', null], // decimals only on small masses: a misread dot
  ['12m', null], // only volumes come in milli
  ['12.34', '12.34'], // mSCU deposits show decimal masses
  ['118.2', '118.2'],
  ['12,34', '12.34'],
  ['0.01', '0.01'],
  ['0', null],
  ['0.00', null],
  ['12.345', null],
  ['12345678', null],
  ['', ''],
]

for (const [text, expected] of massCases) {
  test(`normalizeMass(${JSON.stringify(text)}) is ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeMass(text), expected)
  })
}

test('parseMass is NaN for empty or invalid input', () => {
  assert.equal(parseMass('12.34'), 12.34)
  assert.equal(parseMass('11826'), 11826)
  assert.ok(Number.isNaN(parseMass('')))
  assert.ok(Number.isNaN(parseMass('1182.6')))
})

test('a decimal mass is only allowed for deposits under 1 SCU', () => {
  assert.ok(massDecimalsAllowed('12.34', parseVolume('25.26m')))
  assert.ok(!massDecimalsAllowed('118.26', 1.1))
  assert.ok(!massDecimalsAllowed('12.00', 1))
  assert.ok(massDecimalsAllowed('11826', 49.27))
  assert.ok(massDecimalsAllowed('12.34', NaN)) // no volume yet: "Volume is required" says enough
})
