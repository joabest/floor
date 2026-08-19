const MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512'
let segmenterPromise = null
let activeDevice = null

function progressPercent(event) {
  if (!event) return null
  if (typeof event.progress === 'number') return Math.round(event.progress)
  if (typeof event.loaded === 'number' && typeof event.total === 'number' && event.total > 0) {
    return Math.round((event.loaded / event.total) * 100)
  }
  return null
}

async function buildSegmenter(device, onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers')

  env.allowLocalModels = false
  env.useBrowserCache = true

  return pipeline('image-segmentation', MODEL_ID, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (event) => {
      const percent = progressPercent(event)
      onProgress?.({
        status: event?.status || 'loading',
        file: event?.file || '',
        percent,
        device,
      })
    },
  })
}

async function getSegmenter(onProgress) {
  if (segmenterPromise) return segmenterPromise

  const preferred = typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm'
  activeDevice = preferred

  segmenterPromise = (async () => {
    try {
      return await buildSegmenter(preferred, onProgress)
    } catch (error) {
      if (preferred !== 'webgpu') throw error
      console.warn('WebGPU falhou; usando WASM.', error)
      activeDevice = 'wasm'
      onProgress?.({ status: 'fallback', percent: null, device: 'wasm' })
      return buildSegmenter('wasm', onProgress)
    }
  })()

  try {
    return await segmenterPromise
  } catch (error) {
    segmenterPromise = null
    throw error
  }
}

export async function segmentFloor(imageUrl, onProgress) {
  onProgress?.({ status: 'preparing', percent: 0, device: activeDevice })
  const segmenter = await getSegmenter(onProgress)

  onProgress?.({ status: 'inferencing', percent: null, device: activeDevice })
  const outputs = await segmenter(imageUrl)

  const floorSegments = outputs.filter((item) => {
    const label = String(item.label || '').toLowerCase()
    return label === 'floor' || label.startsWith('floor,') || label.includes('flooring')
  })

  if (!floorSegments.length) {
    const labels = outputs.map((item) => item.label).filter(Boolean).slice(0, 15)
    throw new Error(`O modelo não identificou piso nesta foto. Classes encontradas: ${labels.join(', ') || 'nenhuma'}.`)
  }

  const best = floorSegments.sort((a, b) => (b.score || 0) - (a.score || 0))[0]
  const raw = best.mask
  const data = raw?.data

  if (!raw || !data || !raw.width || !raw.height) {
    throw new Error('A IA retornou uma máscara inválida.')
  }

  const mask = new Uint8ClampedArray(raw.width * raw.height)
  if (data.length === mask.length) {
    for (let i = 0; i < mask.length; i += 1) mask[i] = data[i] > 0 ? 255 : 0
  } else if (data.length >= mask.length * 4) {
    for (let i = 0; i < mask.length; i += 1) mask[i] = data[i * 4] > 0 ? 255 : 0
  } else {
    throw new Error('Formato de máscara não reconhecido pelo navegador.')
  }

  onProgress?.({ status: 'done', percent: 100, device: activeDevice })
  return {
    width: raw.width,
    height: raw.height,
    data: mask,
    score: best.score ?? null,
    device: activeDevice,
  }
}
