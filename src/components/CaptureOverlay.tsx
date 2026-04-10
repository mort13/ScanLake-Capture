import { useState, useRef, useCallback, useEffect } from 'react'
import type { CaptureRegion } from '../ocr/types'
import { ensureStream } from '../ocr/ScreenCapture'

interface Props {
  onRegionSelected: (region: CaptureRegion) => void
  onCancel: () => void
  existingRegion?: CaptureRegion | null
}

/**
 * Fullscreen overlay that lets user drag-select a capture region.
 * Grabs a single frame from the screen share to display as background.
 */
export function CaptureOverlay({ onRegionSelected, onCancel, existingRegion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = useState(false)
  const [start, setStart] = useState({ x: 0, y: 0 })
  const [rect, setRect] = useState<CaptureRegion | null>(existingRegion ?? null)
  const [bgImage, setBgImage] = useState<ImageBitmap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Capture a frame for the background
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stream = await ensureStream()
        const track = stream.getVideoTracks()[0]
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        await video.play()
        await new Promise<void>(r => {
          if (video.videoWidth > 0) return r()
          video.addEventListener('loadeddata', () => r(), { once: true })
        })

        const settings = track.getSettings()
        const w = settings.width || video.videoWidth
        const h = settings.height || video.videoHeight
        const offscreen = new OffscreenCanvas(w, h)
        const ctx = offscreen.getContext('2d')!
        ctx.drawImage(video, 0, 0, w, h)
        video.pause()

        const bitmap = await createImageBitmap(offscreen)
        if (!cancelled) {
          setBgImage(bitmap)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to capture screen')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Redraw canvas when background or rect changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bgImage) return
    canvas.width = bgImage.width
    canvas.height = bgImage.height
    const ctx = canvas.getContext('2d')!

    // Draw background
    ctx.drawImage(bgImage, 0, 0)

    // Dim everything
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Cut out selected region (draw it bright)
    if (rect) {
      ctx.drawImage(bgImage, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height)
      ctx.strokeStyle = '#4f8ff7'
      ctx.lineWidth = 2
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

      // Dimension label
      ctx.fillStyle = '#4f8ff7'
      ctx.font = '14px monospace'
      ctx.fillText(`${rect.width} × ${rect.height}`, rect.x + 4, rect.y - 6)
    }
  }, [bgImage, rect])

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const br = canvas.getBoundingClientRect()
    const scaleX = canvas.width / br.width
    const scaleY = canvas.height / br.height
    return {
      x: Math.round((e.clientX - br.left) * scaleX),
      y: Math.round((e.clientY - br.top) * scaleY),
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasCoords(e)
    setStart(pos)
    setDragging(true)
    setRect(null)
  }, [getCanvasCoords])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging) return
    const pos = getCanvasCoords(e)
    setRect({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    })
  }, [dragging, start, getCanvasCoords])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  const handleConfirm = () => {
    if (rect && rect.width > 10 && rect.height > 10) {
      onRegionSelected(rect)
    }
  }

  if (error) {
    return (
      <div className="capture-overlay">
        <div className="capture-overlay-message">
          <p className="error">Error: {error}</p>
          <button onClick={onCancel} className="btn-cancel">Close</button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="capture-overlay">
        <div className="capture-overlay-message">
          <p>Waiting for screen share...</p>
          <p className="small-text">Select a screen/window in the browser dialog</p>
        </div>
      </div>
    )
  }

  return (
    <div className="capture-overlay">
      <div className="capture-overlay-toolbar">
        <span>Drag to select the scan area. The selected region will be used for all future captures.</span>
        <div className="capture-overlay-actions">
          <button
            onClick={handleConfirm}
            className="btn-primary"
            disabled={!rect || rect.width < 10 || rect.height < 10}
          >
            Use This Region
          </button>
          <button onClick={onCancel} className="btn-cancel">Cancel</button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="capture-overlay-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    </div>
  )
}
