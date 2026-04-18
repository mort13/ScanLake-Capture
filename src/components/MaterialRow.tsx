import type { MaterialFormRow } from '../types'
import { Autocomplete } from './Autocomplete'
import { MATERIAL_TYPES } from '../data/materials'

interface Props {
  row: MaterialFormRow
  index: number
  onChange: (index: number, field: keyof MaterialFormRow, value: string) => void
  onRemove: (index: number) => void
  isPartial: boolean
}

export function MaterialRow({ row, index, onChange, onRemove, isPartial }: Props) {
  const missing = (val: string) => isPartial && val === '' ? 'missing' : ''
  return (
    <div className={`material-row ${isPartial ? 'partial' : ''}`}>
      <span className="mat-index">#{index}</span>
      <Autocomplete
        suggestions={MATERIAL_TYPES}
        value={row.type}
        onChange={v => onChange(index, 'type', v)}
        placeholder="Type"
        className={`mat-type ${missing(row.type)}`}
      />
      <input
        type="text"
        inputMode="decimal"
        value={row.amount}
        onChange={e => onChange(index, 'amount', e.target.value.replace(',', '.'))}
        placeholder="Amount %"
        className={`mat-amount ${missing(row.amount)}`}
      />
      <input
        type="number"
        step="1"
        min="0"
        value={row.quality}
        onChange={e => onChange(index, 'quality', e.target.value)}
        placeholder="Quality"
        className={`mat-quality ${missing(row.quality)}`}
      />
      <button type="button" className="btn-icon" onClick={() => onRemove(index)} title="Remove row">
        &times;
      </button>
    </div>
  )
}
