const MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512'
let segmenterPromise = null

const OCCLUSION_KEYWORDS = [
  'chair','sofa','couch','table','desk','person','plant','potted plant','bed','cabinet','armchair',
  'stool','bench','ottoman','rug','carpet','tv','television','shelf','bookcase','toilet','sink','vase'
]

function errorText(error) {
  if (!error) return 'Erro desconhecido'
  if (typeof error === 'string') return error
  if (error.message) return String(error.message)
  try {
    const json = JSON.stringify(error)
    if (json && json !== '{}') return json
  } catch {}
  return String(error)
}

function progressPercent(event) {
  if (!event) return null
  if (typeof event.progress === 'number') return Math.round(event.progress)
  if (typeof event.loaded === 'number' && typeof event.total === 'number' && event.total > 0) {
    return Math.round((event.loaded / event.total) * 100)
  }
  return null
}

async function buildSegmenter(onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers')

  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true

  // Modo de compatibilidade para Vercel/navegadores.
  // Um único thread evita depender de cross-origin isolation para WASM multithread.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1
  }

  return pipeline('image-segmentation', MODEL_ID, {
    device: 'wasm',
    progress_callback: (event) => {
      onProgress?.({
        status: event?.status || 'loading',
        file: event?.file || '',
        percent: progressPercent(event),
        device: 'wasm',
      })
    },
  })
}

async function getSegmenter(onProgress) {
  if (!segmenterPromise) {
    segmenterPromise = buildSegmenter(onProgress).catch((error) => {
      segmenterPromise = null
      throw new Error(`Não foi possível carregar o modelo: ${errorText(error)}`)
    })
  }
  return segmenterPromise
}

function normalizeMask(raw) {
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
    throw new Error(`Formato de máscara não reconhecido (${data.length} valores para ${raw.width}×${raw.height}).`)
  }

  return { width: raw.width, height: raw.height, data: mask }
}

function mergeMasks(masks, width, height) {
  const valid = masks.filter((mask) => mask?.data && mask.width === width && mask.height === height)
  if (!valid.length) return null

  const merged = new Uint8ClampedArray(width * height)
  for (const mask of valid) {
    for (let i = 0; i < merged.length; i += 1) {
      if (mask.data[i] > merged[i]) merged[i] = mask.data[i]
    }
  }
  return { width, height, data: merged }
}

function isFloor(label) {
  const text = String(label || '').toLowerCase().trim()
  return text === 'floor' || text.startsWith('floor,') || text.includes('flooring')
}

function isOccluder(label) {
  const text = String(label || '').toLowerCase()
  return OCCLUSION_KEYWORDS.some((item) => text.includes(item))
}

function buildOcclusionMask(outputs, width, height) {
  try {
    const masks = []
    const labels = []

    for (const item of outputs) {
      if (!isOccluder(item?.label)) continue
      try {
        const mask = normalizeMask(item.mask)
        if (mask.width !== width || mask.height !== height) continue
        masks.push(mask)
        labels.push(item.label)
      } catch (error) {
        console.warn('Máscara de objeto ignorada:', item?.label, error)
      }
    }

    return {
      mask: mergeMasks(masks, width, height),
      labels: labels.slice(0, 12),
    }
  } catch (error) {
    console.warn('Falha opcional na oclusão:', error)
    return { mask: null, labels: [] }
  }
}

export async function segmentFloor(imageUrl, onProgress) {
  if (!imageUrl) throw new Error('Imagem não recebida pela IA.')

  onProgress?.({ status: 'preparing', percent: 0, device: 'wasm' })
  const segmenter = await getSegmenter(onProgress)

  onProgress?.({ status: 'inferencing', percent: null, device: 'wasm' })

  let outputs
  try {
    outputs = await segmenter(imageUrl)
  } catch (error) {
    throw new Error(`Falha ao executar o modelo no navegador: ${errorText(error)}`)
  }

  if (!Array.isArray(outputs) || !outputs.length) {
    throw new Error('O modelo não retornou nenhuma segmentação.')
  }

  const floorSegments = outputs.filter((item) => isFloor(item?.label))
  if (!floorSegments.length) {
    const labels = outputs.map((item) => item?.label).filter(Boolean).slice(0, 20)
    throw new Error(`O modelo não identificou piso. Classes encontradas: ${labels.join(', ') || 'nenhuma'}.`)
  }

  const bestFloor = floorSegments.sort((a, b) => (b.score || 0) - (a.score || 0))[0]
  const floorMask = normalizeMask(bestFloor.mask)

  // A detecção de objetos é um extra e nunca pode derrubar o resultado do piso.
  const occlusion = buildOcclusionMask(outputs, floorMask.width, floorMask.height)

  onProgress?.({ status: 'done', percent: 100, device: 'wasm' })

  return {
    width: floorMask.width,
    height: floorMask.height,
    data: floorMask.data,
    score: bestFloor.score ?? null,
    device: 'wasm',
    occlusionMask: occlusion.mask,
    detectedObjects: occlusion.labels,
  }
}
