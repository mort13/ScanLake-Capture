interface Props {
  label: string
  valid: boolean
  message?: string
}

export function ValidationBadge({ label, valid, message }: Props) {
  return (
    <span className={`validation-badge ${valid ? 'valid' : 'invalid'}`} title={message}>
      {valid ? '\u2713' : '\u2717'} {label}
    </span>
  )
}
