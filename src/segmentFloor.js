const MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512'
const segmenters = new Map()

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

async function buildSegmenter(device, onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers')
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true

  return pipeline('image-segmentation', MODEL_ID, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (event) => {
      onProgress?.({
        status: event?.status || 'loading',
        file: event?.file || '',
        percent: progressPercent(event),
        device,
      })
    },
  })
}

async function getSegmenter(device, onProgress) {
  if (!segmenters.has(device)) {
    const promise = buildSegmenter(device, onProgress).catch((error) => {
      segmenters.delete(device)
      throw error
    })
    segmenters.set(device, promise)
  }
  return segmenters.get(device)
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
      count+=1;maxY=Math.max(maxY,y);minY=Math.min(minY,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x)
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

function majorityPass(mask, fillThreshold, removeThreshold) {
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
      if(data[idx]>=128 && neighbors<=removeThreshold) out[idx]=0
      else if(data[idx]<128 && neighbors>=fillThreshold) out[idx]=255
    }
  }
  return {width:w,height:h,data:out}
}

function refineFloorMask(mask) {
  const main=keepBestFloorComponent(mask)
  const pass1=majorityPass(main,6,1)
  return majorityPass(pass1,7,0)
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

async function runSegmentation(imageUrl, device, onProgress) {
  const segmenter = await getSegmenter(device, onProgress)
  onProgress?.({ status: 'inferencing', percent: null, device })
  const outputs = await segmenter(imageUrl)
  if (!Array.isArray(outputs) || !outputs.length) throw new Error('O modelo não retornou nenhuma segmentação.')
  return outputs
}

export async function segmentFloor(imageUrl, onProgress) {
  if (!imageUrl) throw new Error('Imagem não recebida pela IA.')

  const canUseWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu
  let outputs
  let device = canUseWebGPU ? 'webgpu' : 'wasm'

  onProgress?.({ status: 'preparing', percent: 0, device })
  try {
    outputs = await runSegmentation(imageUrl, device, onProgress)
  } catch (gpuError) {
    if (device !== 'webgpu') {
      throw new Error(`Falha ao executar o modelo no navegador: ${errorText(gpuError)}`)
    }
    console.warn('WebGPU falhou; usando WASM q8.', gpuError)
    segmenters.delete('webgpu')
    device = 'wasm'
    onProgress?.({ status: 'fallback', percent: null, device })
    try {
      outputs = await runSegmentation(imageUrl, device, onProgress)
    } catch (wasmError) {
      throw new Error(`Falha ao executar a IA (GPU e CPU): ${errorText(wasmError)}`)
    }
  }

  const floorSegments = outputs.filter((item) => isFloor(item?.label))
  if (!floorSegments.length) {
    const labels = outputs.map((item) => item?.label).filter(Boolean).slice(0, 20)
    throw new Error(`O modelo não identificou piso. Classes encontradas: ${labels.join(', ') || 'nenhuma'}.`)
  }

  const bestFloor = floorSegments.sort((a, b) => (b.score || 0) - (a.score || 0))[0]
  const rawFloorMask = normalizeMask(bestFloor.mask)
  const floorMask = refineFloorMask(rawFloorMask)
  const occlusion = buildOcclusionMask(outputs, floorMask.width, floorMask.height)

  onProgress?.({ status: 'done', percent: 100, device })
  return {
    width: floorMask.width,
    height: floorMask.height,
    data: floorMask.data,
    score: bestFloor.score ?? null,
    device,
    occlusionMask: occlusion.mask,
    detectedObjects: occlusion.labels,
    refined: true,
  }
}
