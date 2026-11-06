import type { CaptureRegion } from './types'

let mediaStream: MediaStream | null = null

/** Request screen sharing permission and store the stream for reuse during session */
export async function ensureStream(): Promise<MediaStream> {
  if (mediaStream && mediaStream.active) return mediaStream
  mediaStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'never' } as MediaTrackConstraints,
    audio: false,
  })
  // Clean up on track ended (user stops sharing)
  mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
    mediaStream = null
  })
  return mediaStream
}

export interface CapturedFrame {
  /** The OCR region's pixels */
  image: ImageData
  /** Size of the whole shared screen or window */
  sourceWidth: number
  sourceHeight: number
}

/**
 * The region on a shared screen of this size. A region selected on another resolution with the
 * same aspect ratio is scaled with it (the HUD keeps its place on screen); after an aspect-ratio
 * change nothing says where the HUD went, so that is an error asking for a new selection.
 */
export function regionForSource(region: CaptureRegion, width: number, height: number): CaptureRegion {
  const sw = region.sourceWidth, sh = region.sourceHeight
  if (!sw || !sh || (sw === width && sh === height)) return region
  if (Math.abs((sw / sh) / (width / height) - 1) > 0.01) {
    throw new Error(
      `The shared screen is ${width}×${height} now, but the OCR region was selected on ${sw}×${sh}. ` +
      'Select the OCR region again.',
    )
  }
  const fx = width / sw, fy = height / sh
  return {
    x: Math.round(region.x * fx),
    y: Math.round(region.y * fy),
    width: Math.round(region.width * fx),
    height: Math.round(region.height * fy),
    sourceWidth: width,
    sourceHeight: height,
  }
}

/** Capture a single frame from the active screen share, crop to the selected region */
export async function captureFrame(region: CaptureRegion): Promise<CapturedFrame> {
  const stream = await ensureStream()
  const track = stream.getVideoTracks()[0]

  // Create a video element to grab a frame
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  await video.play()

  // Wait for a valid frame
  await new Promise<void>(resolve => {
    if (video.videoWidth > 0) return resolve()
    video.addEventListener('loadeddata', () => resolve(), { once: true })
  })

  const settings = track.getSettings()
  const fullW = video.videoWidth || settings.width!
  const fullH = video.videoHeight || settings.height!

  // Draw full frame to offscreen canvas
  const fullCanvas = new OffscreenCanvas(fullW, fullH)
  const fullCtx = fullCanvas.getContext('2d')!
  fullCtx.drawImage(video, 0, 0, fullW, fullH)
  video.pause()

  // Clamp region to frame bounds
  const r = regionForSource(region, fullW, fullH)
  const x = Math.max(0, Math.min(r.x, fullW - 1))
  const y = Math.max(0, Math.min(r.y, fullH - 1))
  const w = Math.max(1, Math.min(r.width, fullW - x))
  const h = Math.max(1, Math.min(r.height, fullH - y))

  return { image: fullCtx.getImageData(x, y, w, h), sourceWidth: fullW, sourceHeight: fullH }
}

/** Stop the active media stream */
export function stopStream(): void {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }
}
