import { useEffect, useRef } from 'react'
import type { PipelinePreviewResult, RoiPreviewData, PreviewProfileStatus } from '../ocr/PreviewPipeline'
import type { AnchorMatch } from '../ocr/types'

interface Props {
  result: PipelinePreviewResult
  onClose: () => void
}

export function CapturePreview({ result, onClose }: Props) {
  return (
    <div className="preview-overlay">
      <div className="preview-header">
        <span className="preview-title">Capture Preview</span>
        <ProfileStatusBar status={result.profileStatus} transformError={result.transformError} />
        <button className="btn-danger btn-sm" onClick={onClose}>✕ Close</button>
      </div>

      {result.transformError && (
        <div className="preview-error">⚠ {result.transformError}</div>
      )}

      <div className="preview-body">
        <div className="preview-frame-col">
          <FrameCanvas result={result} />
          <div className="preview-legend">
            <span className="legend-anchor">● Anchors</span>
            <span className="legend-subanchor">● Sub-anchors</span>
            <span className="legend-roi">■ ROIs</span>
          </div>
        </div>
        <div className="preview-roi-col">
          <div className="preview-roi-grid">
            {result.roiPreviews.map(rp => (
              <RoiCard key={rp.roi.name} item={rp} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Profile Status Bar ──────────────────────────────────────────────────────

function ProfileStatusBar({
  status, transformError,
}: { status: PreviewProfileStatus; transformError: string | null }) {
  const anchorOk = status.anchorsFound >= 2
  const subOk = status.subAnchorsFound === status.subAnchorsConfigured
  const roiOk = status.roisExtracted === status.roisEnabled

  return (
    <div className="preview-profile-status">
      <span className="preview-profile-name">
        {status.masterName} / {status.profileName}
      </span>
      <StatusPill
        label="Anchors"
        found={status.anchorsFound}
        total={status.anchorsConfigured}
        ok={anchorOk}
        missing={status.missingAnchorNames}
      />
      <StatusPill
        label="Sub-anchors"
        found={status.subAnchorsFound}
        total={status.subAnchorsConfigured}
        ok={subOk}
        missing={status.missingSubAnchorNames}
      />
      <StatusPill
        label="ROIs"
        found={status.roisExtracted}
        total={status.roisEnabled}
        ok={roiOk}
        missing={[]}
      />
      {!transformError && <span className="status-pill ok">✓ Transform</span>}
    </div>
  )
}

function StatusPill({
  label, found, total, ok, missing,
}: { label: string; found: number; total: number; ok: boolean; missing: string[] }) {
  const title = missing.length > 0 ? `Missing: ${missing.join(', ')}` : `${found}/${total}`
  return (
    <span className={`status-pill ${ok ? 'ok' : 'warn'}`} title={title}>
      {ok ? '✓' : '⚠'} {label}: {found}/{total}
    </span>
  )
}

// ─── Main Frame Canvas ───────────────────────────────────────────────────────

function FrameCanvas({ result }: { result: PipelinePreviewResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const img = result.frameImage
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!

    // Draw frame
    ctx.putImageData(img, 0, 0)

    // ROI rectangles
    for (const rp of result.roiPreviews) {
      const found = rp.imageData !== null
      ctx.strokeStyle = found ? '#ffe066' : '#e55050'
      ctx.lineWidth = 1.5
      ctx.strokeRect(rp.pixelX, rp.pixelY, rp.pixelW, rp.pixelH)

      // Semi-transparent fill
      ctx.fillStyle = found ? 'rgba(255,224,102,0.08)' : 'rgba(229,80,80,0.15)'
      ctx.fillRect(rp.pixelX, rp.pixelY, rp.pixelW, rp.pixelH)

      // Label above the box
      ctx.font = `${Math.max(8, Math.round(img.width / 160))}px monospace`
      ctx.fillStyle = found ? '#ffe066' : '#e55050'
      ctx.fillText(rp.roi.name, rp.pixelX + 1, rp.pixelY - 1)
    }

    // Main anchor crosshairs
    for (const m of result.anchorMatches) {
      drawCrosshair(ctx, m, '#50c878', img.width)
    }

    // Sub-anchor search regions (light blue rectangles)
    for (const [, region] of result.subAnchorSearchRegions) {
      ctx.strokeStyle = 'rgba(79,143,247,0.5)'
      ctx.lineWidth = 1
      ctx.strokeRect(region.x, region.y, region.width, region.height)
      // Semi-transparent fill
      ctx.fillStyle = 'rgba(79,143,247,0.05)'
      ctx.fillRect(region.x, region.y, region.width, region.height)
    }

    // Sub-anchor crosshairs
    for (const [, m] of result.subAnchorMatches) {
      drawCrosshair(ctx, m, '#4f8ff7', img.width)
    }
  }, [result])

  return (
    <canvas
      ref={canvasRef}
      className="preview-frame-canvas"
    />
  )
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  match: AnchorMatch,
  color: string,
  imgWidth: number,
) {
  const r = Math.max(6, Math.round(imgWidth / 192))
  // match.x/y are TOP-LEFT; draw crosshair at template center
  const cx = match.x + match.w / 2
  const cy = match.y + match.h / 2
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(cx - r * 2.5, cy)
  ctx.lineTo(cx + r * 2.5, cy)
  ctx.moveTo(cx, cy - r * 2.5)
  ctx.lineTo(cx, cy + r * 2.5)
  ctx.stroke()

  const fontSize = Math.max(9, Math.round(imgWidth / 160))
  ctx.font = `bold ${fontSize}px monospace`
  ctx.fillText(`${match.name} ${(match.confidence * 100).toFixed(0)}%`, cx + r + 2, cy - 2)
}

// ─── ROI Preview Card ────────────────────────────────────────────────────────

function RoiCard({ item }: { item: RoiPreviewData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !item.imageData) return

    const img = item.imageData
    // Scale up to a visible size (min 64px height, max 128px)
    const targetH = Math.max(64, Math.min(128, Math.round(64 / img.height) * img.height))
    const scale = Math.max(1, Math.round(targetH / img.height))
    const dw = img.width * scale
    const dh = img.height * scale

    canvas.width = dw
    canvas.height = dh
    const ctx = canvas.getContext('2d')!

    // Draw scaled ROI (nearest-neighbour for pixel sharpness)
    const temp = new OffscreenCanvas(img.width, img.height)
    const tctx = temp.getContext('2d')!
    tctx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(temp, 0, 0, img.width, img.height, 0, 0, dw, dh)

    // Draw segmentation cut lines (skip for CRNN — no segmentation needed)
    if (item.roi.recognition_mode !== 'digit_crnn') {
      ctx.strokeStyle = '#50c878'
      ctx.lineWidth = 1
      for (const bx of item.segBoundaries) {
        const dx = bx * scale
        ctx.beginPath()
        ctx.moveTo(dx, 0)
        ctx.lineTo(dx, dh)
        ctx.stroke()
      }
    }
  }, [item])

  const recognition = item.roi.recognition_mode
  const segMode = item.roi.seg_mode
  const confPct = item.recognizedText !== null ? Math.round(item.recognitionConfidence * 100) : null

  return (
    <div className={`roi-card ${item.imageData ? '' : 'roi-card-missing'}`}>
      <div className="roi-card-name" title={`${recognition} / ${segMode}`}>
        {item.roi.name}
        <span className="roi-card-mode">{recognition}</span>
      </div>
      {item.imageData ? (
        <canvas ref={canvasRef} className="roi-card-canvas" />
      ) : (
        <div className="roi-card-oob">out of bounds</div>
      )}
      {item.recognizedText !== null && (
        <div className="roi-card-result" title={`confidence ${confPct}%`}>
          <span className="roi-card-text">{item.recognizedText || '\u00a0'}</span>
          <span className="roi-card-conf">{confPct}%</span>
        </div>
      )}
      {item.roi.recognition_mode !== 'digit_crnn' && item.segmentConfidences.length > 0 && (
        <div className="roi-card-seg-confs">
          {item.segmentConfidences.map((c, i) => {
            const pct = Math.round(c * 100)
            const ok = c >= 0.75
            return (
              <span
                key={i}
                className={`roi-seg-conf ${ok ? 'roi-seg-conf-ok' : 'roi-seg-conf-low'}`}
                title={`Segment ${i + 1}: ${pct}%`}
              >
                {pct}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
