import type { OcrStatus as OcrStatusType } from '../ocr/types'

interface Props {
  status: OcrStatusType
  message: string
  confidence?: number
}

export function OcrStatus({ status, message, confidence }: Props) {
  const className = `ocr-status ocr-status-${status}`
  const icon = status === 'idle' ? '⏸'
    : status === 'capturing' ? '📷'
    : status === 'processing' ? '⚙'
    : status === 'success' ? '✓'
    : '✗'

  return (
    <div className={className}>
      <span className="ocr-status-icon">{icon}</span>
      <span className="ocr-status-message">{message}</span>
      {status === 'success' && confidence !== undefined && (
        <span className="ocr-status-confidence">
          {(confidence * 100).toFixed(0)}% confidence
        </span>
      )}
    </div>
  )
}
