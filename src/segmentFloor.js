const MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512'
let segmenterPromise = null

const OCCLUSION_KEYWORDS = [
  'chair','sofa','couch','table','desk','person','plant','potted plant','bed','cabinet','armchair',
  'stool','bench','ottoman','rug','carpet','tv','television','shelf','bookcase','toilet','sink','vase'
]

function errorText(error) {
  if (!error) return 'Erro desconhecido'
  if (typeof error === 'string' || typeof error === 'number') return String(error)
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

async function createSegmenter(onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers')

  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true

  // Importante: este modelo Xenova é publicado para uso direto no pipeline.
  // Não forçamos device/dtype aqui. O Transformers.js escolhe o backend e
  // a variante compatível do modelo para o navegador.
  return pipeline('image-segmentation', MODEL_ID, {
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
    segmenterPromise = createSegmenter(onProgress).catch((error) => {
      segmenterPromise = null
      throw new Error(`Não foi possível carregar o modelo de piso: ${errorText(error)}`)
    })
  }
  return segmenterPromise
}

export async function preloadFloorAI(onProgress) {
  try {
    await getSegmenter(onProgress)
    onProgress?.({ status: 'ready', percent: 100, device: 'wasm' })
    return true
  } catch (error) {
    console.warn('Pré-carregamento da IA não concluiu:', error)
    return false
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
    throw new Error(`Formato de máscara não reconhecido (${data.length} valores para ${raw.width}×${raw.height}).`)
  }
  return { width: raw.width, height: raw.height, data: mask }
}

function keepBestFloorComponent(mask) {
  const { width:w, height:h, data } = mask
  const total=w*h
  const labels=new Int32Array(total)
  const queue=new Int32Array(total)
  const stats=[]
  let label=0

  for(let start=0;start<total;start+=1){
    if(data[start]<128||labels[start]) continue
    label+=1
    let head=0,tail=0,count=0,maxY=0,minY=h,minX=w,maxX=0
    queue[tail++]=start;labels[start]=label

    while(head<tail){
      const idx=queue[head++],x=idx%w,y=(idx/w)|0
      count+=1
      maxY=Math.max(maxY,y);minY=Math.min(minY,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x)
      const push=(n)=>{if(n>=0&&n<total&&!labels[n]&&data[n]>=128){labels[n]=label;queue[tail++]=n}}
      if(x>0)push(idx-1)
      if(x+1<w)push(idx+1)
      if(y>0)push(idx-w)
      if(y+1<h)push(idx+w)
    }

    const bottomness=maxY/Math.max(1,h-1)
    const verticalSpan=(maxY-minY+1)/h
    const horizontalSpan=(maxX-minX+1)/w
    const areaRatio=count/total
    const score=count*(.50+.30*bottomness+.10*Math.min(1,verticalSpan*2)+.10*Math.min(1,horizontalSpan*1.5))
    stats.push({label,count,score,areaRatio})
  }

  if(!stats.length) return mask
  const candidates=stats.filter((s)=>s.areaRatio>=.002)
  const best=(candidates.length?candidates:stats).sort((a,b)=>b.score-a.score)[0]
  if(best.count<Math.max(80,total*.0025)) return mask

  const out=new Uint8ClampedArray(total)
  for(let i=0;i<total;i+=1) if(labels[i]===best.label) out[i]=255
  return {width:w,height:h,data:out}
}

function majorityPass(mask) {
  const {width:w,height:h,data}=mask
  const out=new Uint8ClampedArray(data)
  for(let y=1;y<h-1;y+=1){
    for(let x=1;x<w-1;x+=1){
      const idx=y*w+x
      let neighbors=0
      for(let yy=-1;yy<=1;yy+=1){
        for(let xx=-1;xx<=1;xx+=1){
          if(xx===0&&yy===0) continue
          if(data[(y+yy)*w+x+xx]>=128) neighbors+=1
        }
      }
      if(data[idx]>=128 && neighbors<=1) out[idx]=0
      else if(data[idx]<128 && neighbors>=7) out[idx]=255
    }
  }
  return {width:w,height:h,data:out}
}

function refineFloorMask(mask) {
  return majorityPass(keepBestFloorComponent(mask))
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
    return { mask: mergeMasks(masks, width, height), labels: labels.slice(0, 12) }
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
    throw new Error(`Falha ao executar o modelo de piso: ${errorText(error)}`)
  }

  if (!Array.isArray(outputs) || !outputs.length) {
    throw new Error('O modelo não retornou nenhuma segmentação.')
  }

  const floorSegments = outputs.filter((item) => isFloor(item?.label))
  if (!floorSegments.length) {
    const labels = outputs.map((item) => item?.label).filter(Boolean).slice(0, 20)
    throw new Error(`O modelo não identificou piso. Classes encontradas: ${labels.join(', ') || 'nenhuma'}.`)
  }

  const bestFloor = floorSegments[0]
  const rawFloorMask = normalizeMask(bestFloor.mask)
  const floorMask = refineFloorMask(rawFloorMask)
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
    refined: true,
  }
}
