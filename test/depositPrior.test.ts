import { describe, expect, it } from 'vitest'
import table from '../src/data/deposit_materials.json'
import { DEPOSIT_TYPES } from '../src/data/deposits'
import { MATERIAL_TYPES } from '../src/data/materials'
import { depositMaterials, pickDeposit, pickMaterial, rowMaterials, slotFit } from '../src/ocr/DepositPrior'
import { mapResultsToForm } from '../src/ocr/ResultMapper'
import type { MasterProfile, RoiResult, WordCandidate } from '../src/ocr/types'

const LABELS = [
  'bexalite', 'borase', 'empty', 'gold', 'hadanite', 'hephaestanite', 'inert_materials', 'iron', 'laranite',
  'silicon', 'taranite', 'tin', 'tungsten',
]

/** Softmax-like candidates over LABELS; labels not given get a tiny share */
function candidates(probs: Record<string, number>): WordCandidate[] {
  return LABELS.map(label => ({ label, prob: probs[label] ?? 0.0001 }))
}

const asMaterial = (label: string) =>
  label === 'empty' ? '' : label === 'inert_materials' ? 'Inert Materials' : label

describe('deposit_materials.json', () => {
  it('names only known deposits and materials', () => {
    const deposits = new Set<string>(DEPOSIT_TYPES)
    const materials = new Set<string>(MATERIAL_TYPES)
    for (const [deposit, inside] of Object.entries(table.deposits)) {
      expect(deposits, deposit).toContain(deposit)
      for (const material of inside) expect(materials, `${deposit}: ${material}`).toContain(material)
    }
  })

  it('lists each one_entry deposit as holding only itself', () => {
    const deposits = table.deposits as Record<string, string[]>
    for (const deposit of table.one_entry) expect(deposits[deposit], deposit).toEqual([deposit])
  })

  it('looks deposits up without case and leaves unknown ones unrestricted', () => {
    expect(depositMaterials('iron')).toEqual(new Set(['iron', 'inert materials']))
    expect(depositMaterials(' BEXALITE ')).toEqual(new Set(['bexalite', 'borase', 'gold', 'inert materials']))
    expect(depositMaterials('None')).toBeNull()
    expect(depositMaterials('')).toBeNull()
  })

  it('allows nothing below the row of a one_entry deposit', () => {
    expect(rowMaterials('hadanite', 0)).toEqual(new Set(['hadanite']))
    expect(rowMaterials('Hadanite', 1)).toEqual(new Set())
    expect(rowMaterials('Iron', 3)).toEqual(depositMaterials('Iron'))
    expect(rowMaterials('None', 1)).toBeNull()
  })
})

describe('pickMaterial', () => {
  const iron = depositMaterials('Iron')!

  it('snaps a misread back to a material the deposit holds', () => {
    const pick = pickMaterial(candidates({ tin: 0.7, iron: 0.25 }), iron, asMaterial)
    expect(pick.label).toBe('iron')
    expect(pick.prob).toBeGreaterThan(0.95)
  })

  it('keeps blank slots blank', () => {
    expect(pickMaterial(candidates({ empty: 0.9, tin: 0.08 }), iron, asMaterial).label).toBe('empty')
  })

  it('lets near-certain evidence for an outside material through', () => {
    expect(pickMaterial(candidates({ tin: 0.999 }), iron, asMaterial).label).toBe('tin')
  })
})

describe('pickDeposit', () => {
  const pick = (deposit: Record<string, number>, ...slots: Record<string, number>[]) =>
    pickDeposit(candidates(deposit), slots.map(candidates), d => d, asMaterial)

  it('scores a slot by how well it fits the deposit', () => {
    const taranite = depositMaterials('Taranite')!
    expect(slotFit(candidates({ taranite: 0.95 }), taranite, asMaterial)).toBeGreaterThan(3)
    expect(slotFit(candidates({ tin: 0.95 }), taranite, asMaterial)).toBeLessThan(0.1)
    expect(slotFit(candidates({ empty: 0.99 }), taranite, asMaterial)).toBeCloseTo(1, 1)
  })

  it('lets the materials settle an unsure deposit read', () => {
    // Tungsten deposits cannot hold Taranite; Taranite deposits hold nothing else
    const p = pick({ tungsten: 0.55, taranite: 0.4 }, { taranite: 0.95 }, { taranite: 0.95 }, { inert_materials: 0.9 })
    expect(p.label).toBe('taranite')
    expect(p.prob).toBeGreaterThan(0.9)
  })

  it('confirms a deposit read whose materials fit', () => {
    const p = pick({ iron: 0.6, tin: 0.35 }, { iron: 0.95 }, { inert_materials: 0.9 })
    expect(p.label).toBe('iron')
    expect(p.prob).toBeGreaterThan(0.9)
  })

  it('keeps a confident deposit read whatever the materials say', () => {
    expect(pick({ iron: 0.99 }, { tin: 0.95 }, { tin: 0.95 })).toEqual({ label: 'iron', prob: 0.99 })
  })

  it('counts a read row below a one_entry deposit against it', () => {
    expect(slotFit(candidates({ silicon: 0.95 }), new Set(), asMaterial)).toBeLessThan(0.02)
    expect(slotFit(candidates({ empty: 0.99 }), new Set(), asMaterial)).toBeCloseTo(1, 1)
    // Hadanite deposits show one row, Hadanite; Hephaestanite ones hold Silicon
    const two = pick({ hadanite: 0.5, hephaestanite: 0.45 }, { hephaestanite: 0.9 }, { silicon: 0.9 })
    expect(two.label).toBe('hephaestanite')
    const one = pick({ hadanite: 0.5, hephaestanite: 0.45 }, { hadanite: 0.9 }, { empty: 0.99 })
    expect(one.label).toBe('hadanite')
    expect(one.prob).toBeGreaterThan(0.9)
  })

  it('keeps the deposit read when the materials fit both names equally', () => {
    // Bexalite and Gold deposits can hold the same materials
    const p = pick({ bexalite: 0.6, gold: 0.38 }, { bexalite: 0.95 }, { gold: 0.9 })
    expect(p.label).toBe('bexalite')
    expect(p.prob).toBeCloseTo(0.6, 2)
  })
})

describe('mapResultsToForm with deposit materials', () => {
  const profile: MasterProfile = {
    name: 'test',
    profiles: {},
    output_schema: [{
      key: 'scan',
      type: 'object',
      children: [
        { key: 'deposit_name', roi: 'deposit' },
        {
          key: 'composition',
          type: 'array',
          children: [1, 2].map(i => ({
            key: `material${i}`,
            type: 'object' as const,
            children: [{ key: 'name', roi: `material${i}` }],
          })),
        },
      ],
    }],
  }

  function word(roiName: string, probs: Record<string, number>): RoiResult {
    const all = candidates(probs)
    const best = all.reduce((a, b) => (b.prob > a.prob ? b : a))
    const text = best.prob >= 0.5 && best.label !== 'empty' ? best.label : ''
    return { roiName, text, confidence: best.prob, candidates: all }
  }

  function read(deposit: string, depositConf: number, m1: Record<string, number>, m2: Record<string, number>) {
    const results = new Map<string, RoiResult>([
      ['deposit', { roiName: 'deposit', text: deposit, confidence: depositConf }],
      ['material1', word('material1', m1)],
      ['material2', word('material2', m2)],
    ])
    return mapResultsToForm(results, profile).formData
  }

  it('reads materials the deposit can hold', () => {
    const form = read('bexalite', 0.98, { gold: 0.9, bexalite: 0.05 }, { tin: 0.6, borase: 0.35 })
    expect(form.deposit).toBe('Bexalite')
    expect(form.materials.map(m => m.type)).toEqual(['Gold', 'Borase'])
  })

  it('does not decide between two materials the deposit can both hold', () => {
    const form = read('bexalite', 0.98, { gold: 0.55, bexalite: 0.4 }, { inert_materials: 0.9 })
    // the unsure slot stays empty (and, having no amount or quality either, is left out)
    expect(form.materials.map(m => m.type)).toEqual(['Inert Materials'])
  })

  it('recovers a material the model was unsure of', () => {
    // Unrestricted, 0.45 for iron is below every threshold and the slot would stay empty
    const form = read('iron', 0.98, { tin: 0.5, iron: 0.45 }, { inert_materials: 0.9 })
    expect(form.materials.map(m => m.type)).toEqual(['Iron', 'Inert Materials'])
  })

  it('does not restrict when the deposit was not read confidently', () => {
    const form = read('iron', 0.6, { tin: 0.9, iron: 0.05 }, { inert_materials: 0.9 })
    expect(form.deposit).toBe('')
    expect(form.materials.map(m => m.type)).toEqual(['Tin', 'Inert Materials'])
  })

  /** As the word model delivers them: every slot, the deposit too, with all class probabilities */
  function readWords(deposit: Record<string, number>, m1: Record<string, number>, m2: Record<string, number>) {
    const results = new Map<string, RoiResult>([
      ['deposit', word('deposit', deposit)],
      ['material1', word('material1', m1)],
      ['material2', word('material2', m2)],
    ])
    return mapResultsToForm(results, profile)
  }

  it('reads an unsure deposit from its materials', () => {
    // Unrestricted, 0.6 for iron is below the threshold and the deposit would stay empty
    const { formData, confidences } = readWords({ iron: 0.6, tin: 0.35 }, { iron: 0.9 }, { inert_materials: 0.9 })
    expect(formData.deposit).toBe('Iron')
    expect(confidences.get('deposit')).toBeGreaterThan(0.9)
    expect(formData.materials.map(m => m.type)).toEqual(['Iron', 'Inert Materials'])
  })

  it('reads one row for a one_entry deposit', () => {
    // a bright background behind the empty second row gives the model something to misread
    const { formData } = readWords({ hadanite: 0.98 }, { hadanite: 0.6, hephaestanite: 0.3 }, { silicon: 0.8, empty: 0.15 })
    expect(formData.deposit).toBe('Hadanite')
    expect(formData.materials.map(m => m.type)).toEqual(['Hadanite'])
  })

  it('leaves the deposit empty when its materials cannot tell', () => {
    const { formData } = readWords({ bexalite: 0.6, gold: 0.38 }, { bexalite: 0.9 }, { inert_materials: 0.9 })
    expect(formData.deposit).toBe('')
    expect(formData.materials.map(m => m.type)).toEqual(['Bexalite', 'Inert Materials'])
  })
})
