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
  return (
    <div className={`material-row ${isPartial ? 'partial' : ''}`}>
      <span className="mat-index">#{index}</span>
      <Autocomplete
        suggestions={MATERIAL_TYPES}
        value={row.type}
        onChange={v => onChange(index, 'type', v)}
        placeholder="Type"
        className="mat-type"
      />
      <input
        type="number"
        step="0.01"
        min="0"
        max="100"
        value={row.amount}
        onChange={e => onChange(index, 'amount', e.target.value)}
        placeholder="Amount %"
        className="mat-amount"
      />
      <input
        type="number"
        step="1"
        min="0"
        value={row.quality}
        onChange={e => onChange(index, 'quality', e.target.value)}
        placeholder="Quality"
        className="mat-quality"
      />
      <button type="button" className="btn-icon" onClick={() => onRemove(index)} title="Remove row">
        &times;
      </button>
    </div>
  )
}
