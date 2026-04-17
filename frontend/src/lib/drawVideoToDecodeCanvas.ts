/**
 * BarcodeDetector + ZXing scale poorly on full camera resolution (e.g. 1920×1080).
 * Decode on a downscaled bitmap so each frame stays cheap and feels instant on phones.
 */
export const MAX_BARCODE_DECODE_WIDTH = 640

export type DecodeSurface = {
  ctx: CanvasRenderingContext2D
  dw: number
  dh: number
}

export function drawVideoToDecodeCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  filter: string
): DecodeSurface | null {
  const vw = Math.max(1, video.videoWidth || 1280)
  const vh = Math.max(1, video.videoHeight || 720)
  const scale = Math.min(1, MAX_BARCODE_DECODE_WIDTH / vw)
  const dw = Math.max(1, Math.round(vw * scale))
  const dh = Math.max(1, Math.round(vh * scale))

  if (canvas.width !== dw || canvas.height !== dh) {
    canvas.width = dw
    canvas.height = dh
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.imageSmoothingEnabled = true
  ctx.filter = filter
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, dw, dh)
  ctx.filter = 'none'

  return { ctx, dw, dh }
}
