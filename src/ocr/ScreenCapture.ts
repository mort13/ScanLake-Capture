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

/** Capture a single frame from the active screen share, crop to the selected region */
export async function captureFrame(region: CaptureRegion): Promise<ImageData> {
  const stream = await ensureStream()
  const track = stream.getVideoTracks()[0]
  const settings = track.getSettings()
  const fullW = settings.width!
  const fullH = settings.height!

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

  // Draw full frame to offscreen canvas
  const fullCanvas = new OffscreenCanvas(fullW, fullH)
  const fullCtx = fullCanvas.getContext('2d')!
  fullCtx.drawImage(video, 0, 0, fullW, fullH)
  video.pause()

  // Clamp region to frame bounds
  const x = Math.max(0, Math.min(region.x, fullW))
  const y = Math.max(0, Math.min(region.y, fullH))
  const w = Math.min(region.width, fullW - x)
  const h = Math.min(region.height, fullH - y)

  return fullCtx.getImageData(x, y, w, h)
}

/** Stop the active media stream */
export function stopStream(): void {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }
}
