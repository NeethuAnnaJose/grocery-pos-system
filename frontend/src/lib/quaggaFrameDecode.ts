import Quagga from 'quagga'

function quaggaResultToText(result: any): string | null {
  if (!result) return null
  const cr = result.codeResult
  if (!cr) return null
  if (typeof cr.code === 'string' && cr.code.trim()) return cr.code.trim()
  const dc = cr.decodedCodes
  if (Array.isArray(dc)) {
    for (const entry of dc) {
      if (typeof entry?.code === 'string' && entry.code.trim()) return entry.code.trim()
    }
  }
  return null
}

/**
 * Quagga's ImageStream uses get-pixels and expects a URL/data URL — not ImageData.
 * Runs decode on a downscaled snapshot so each attempt stays bounded.
 */
export async function decodeQuaggaFromCanvas(
  canvas: HTMLCanvasElement,
  opts?: { maxSide?: number; timeoutMs?: number }
): Promise<string | null> {
  const maxSide = opts?.maxSide ?? 720
  const timeoutMs = opts?.timeoutMs ?? 380
  const w = canvas.width
  const h = canvas.height
  if (w < 2 || h < 2) return null

  const scale = Math.min(1, maxSide / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const small = document.createElement('canvas')
  small.width = tw
  small.height = th
  const sctx = small.getContext('2d')
  if (!sctx) return null
  sctx.imageSmoothingEnabled = true
  sctx.drawImage(canvas, 0, 0, tw, th)

  let dataUrl: string
  try {
    dataUrl = small.toDataURL('image/png')
  } catch {
    return null
  }

  return await new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (val: string | null) => {
      if (settled) return
      settled = true
      resolve(val)
    }
    const timer = window.setTimeout(() => {
      try {
        Quagga.stop()
      } catch {
        /* noop */
      }
      finish(null)
    }, timeoutMs)
    try {
      Quagga.decodeSingle(
        {
          src: dataUrl,
          inputStream: {
            size: Math.max(tw, th),
            mime: 'image/png',
          },
          numOfWorkers: 0,
          locator: { halfSample: true },
          decoder: {
            readers: [
              'ean_reader',
              'ean_8_reader',
              'upc_reader',
              'upc_e_reader',
              'code_128_reader',
              'code_39_reader',
              'codabar_reader',
            ],
          },
        } as any,
        (result: any) => {
          window.clearTimeout(timer)
          try {
            Quagga.stop()
          } catch {
            /* noop */
          }
          finish(quaggaResultToText(result))
        }
      )
    } catch {
      window.clearTimeout(timer)
      finish(null)
    }
  })
}
