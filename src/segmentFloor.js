const MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512'
let segmenterPromise = null
let activeDevice = null

const OCCLUSION_KEYWORDS = [
  'chair','sofa','couch','table','desk','person','plant','potted plant','bed','cabinet','armchair',
  'stool','bench','ottoman','rug','carpet','tv','television','shelf','bookcase','toilet','sink','vase'
]

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
    throw new Error('Formato de máscara não reconhecido pelo navegador.')
  }

  return { width: raw.width, height: raw.height, data: mask }
}

function mergeMasks(masks, expectedWidth, expectedHeight) {
  const valid = masks.filter((mask) =>
    mask?.data &&
    mask.width === expectedWidth &&
    mask.height === expectedHeight &&
    mask.data.length === expectedWidth * expectedHeight
  )

  if (!valid.length) return null

  const merged = new Uint8ClampedArray(expectedWidth * expectedHeight)
  for (const mask of valid) {
    for (let i = 0; i < merged.length; i += 1) {
      if (mask.data[i] > merged[i]) merged[i] = mask.data[i]
    }
  }

  return { width: expectedWidth, height: expectedHeight, data: merged }
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
    console.warn('Falha opcional na máscara de oclusão:', error)
    return { mask: null, labels: [] }
  }
}

export async function segmentFloor(imageUrl, onProgress) {
  onProgress?.({ status: 'preparing', percent: 0, device: activeDevice })

  const segmenter = await getSegmenter(onProgress)
  onProgress?.({ status: 'inferencing', percent: null, device: activeDevice })

  let outputs
  try {
    outputs = await segmenter(imageUrl)
  } catch (error) {
    throw new Error(`Falha ao executar o modelo de IA: ${error?.message || error}`)
  }

  if (!Array.isArray(outputs) || !outputs.length) {
    throw new Error('O modelo de IA não retornou nenhuma segmentação.')
  }

  const floorSegments = outputs.filter((item) => isFloor(item?.label))

  if (!floorSegments.length) {
    const labels = outputs.map((item) => item?.label).filter(Boolean).slice(0, 20)
    throw new Error(`O modelo não identificou piso nesta foto. Classes encontradas: ${labels.join(', ') || 'nenhuma'}.`)
  }

  // O piso é obrigatório. Mantemos a lógica simples da Etapa 1 que já estava funcionando:
  // usamos o melhor segmento de piso em vez de depender do processamento dos demais objetos.
  const bestFloor = floorSegments.sort((a, b) => (b.score || 0) - (a.score || 0))[0]
  const floorMask = normalizeMask(bestFloor.mask)

  // Objetos em primeiro plano são opcionais. Qualquer falha aqui NÃO derruba a detecção do piso.
  const occlusion = buildOcclusionMask(outputs, floorMask.width, floorMask.height)

  onProgress?.({ status: 'done', percent: 100, device: activeDevice })

  return {
    width: floorMask.width,
    height: floorMask.height,
    data: floorMask.data,
    score: bestFloor.score ?? null,
    device: activeDevice,
    occlusionMask: occlusion.mask,
    detectedObjects: occlusion.labels,
  }
}
