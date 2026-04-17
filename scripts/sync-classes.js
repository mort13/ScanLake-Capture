#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const modelPath = join(__dirname, '../public/models/word_cnn.json')
const materialsPath = join(__dirname, '../src/data/materials.ts')

const model = JSON.parse(readFileSync(modelPath, 'utf-8'))
const classes = model.wordClasses ?? []

if (classes.length === 0) {
  console.error('No wordClasses found in word_cnn.json')
  process.exit(1)
}

// Filter 'empty' — not a real material
const displayClasses = classes.filter(c => c.toLowerCase() !== 'empty')

// Convert snake_case to Title Case
function toTitleCase(str) {
  return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const formatted = displayClasses.map(toTitleCase)

const tsCode = `export const MATERIAL_TYPES = [
${formatted.map(m => `  '${m}',`).join('\n')}
] as const
`

writeFileSync(materialsPath, tsCode, 'utf-8')
console.log(`Updated materials.ts with ${formatted.length} classes from word_cnn.json`)
