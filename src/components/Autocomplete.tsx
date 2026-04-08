import { useState, useRef, type KeyboardEvent } from 'react'

interface Props {
  suggestions: readonly string[] | string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function Autocomplete({ suggestions, value, onChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = value
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()))
    : [...suggestions]

  function handleKey(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      onChange(filtered[highlighted])
      setOpen(false)
      setHighlighted(-1)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={`autocomplete ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKey}
      />
      {open && filtered.length > 0 && (
        <ul className="autocomplete-dropdown">
          {filtered.map((s, i) => (
            <li
              key={s}
              className={i === highlighted ? 'highlighted' : ''}
              onMouseDown={() => { onChange(s); setOpen(false) }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
