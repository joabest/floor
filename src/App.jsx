import { useEffect, useRef, useState } from 'react'
import { segmentFloor } from './segmentFloor'
import { PRODUCTS, loadImage, polygonMask, render, swatch } from './imageEngine'
import { buildPerspective, estimateFloorPerspective, homographyText } from './perspective'

export default function App(){
  const canvasRef=useRef(null),fileRef=useRef(null)
  const [room,setRoom]=useState(null),[mask,setMask]=useState(null),[product,setProduct]=useState(PRODUCTS[0])
  const [mode,setMode]=useState('result'),[busy,setBusy]=useState(false),[status,setStatus]=useState('Envie uma foto para começar'),[error,setError]=useState('')
  const [floorManual,setFloorManual]=useState(false),[floorPoints,setFloorPoints]=useState([])
  const [perspectiveManual,setPerspectiveManual]=useState(false),[perspectiveDraft,setPerspectiveDraft]=useState([]),[perspective,setPerspective]=useState(null)
  const [strength,setStrength]=useState(92)

  useEffect(()=>{
    if(room)render({canvas:canvasRef.current,image:room.image,mask,product,mode,strength:strength/100,perspective,draftPoints:perspectiveDraft})
  },[room,mask,product,mode,strength,perspective,perspectiveDraft])

  async function pick(file){
    if(!file)return
    setError('');setBusy(true)
    try{
      const r=await loadImage(file)
      setRoom(r);setMask(null);setPerspective(null);setFloorPoints([]);setPerspectiveDraft([]);setFloorManual(false);setPerspectiveManual(false);setMode('result')
      setStatus('Foto pronta. Detecte o piso com IA.')
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }

  async function ai(){
    if(!room)return
    setBusy(true);setError('');setFloorManual(false);setPerspectiveManual(false);setPerspectiveDraft([])
    try{
      const m=await segmentFloor(room.dataUrl,e=>setStatus(e.status==='inferencing'?'Identificando o piso…':'Carregando IA no navegador…'))
      setMask(m)
      try{
        const p=estimateFloorPerspective(m,room.width,room.height)
        setPerspective(p);setMode('perspective');setStatus('Piso detectado. Confira a grade de perspectiva.')
      }catch(perspectiveError){
        setPerspective(null);setMode('mask');setStatus('Piso detectado. Ajuste os 4 pontos da perspectiva manualmente.')
        setError(perspectiveError.message)
      }
    }catch(e){
      setError((e.message||'Falha na IA')+' Use a marcação manual como alternativa.');setStatus('Detecção automática não concluiu.')
    }finally{setBusy(false)}
  }

  function startManualFloor(){
    if(!room)return
    setMask(null);setPerspective(null);setFloorPoints([]);setPerspectiveDraft([]);setPerspectiveManual(false);setFloorManual(true);setMode('original')
    setStatus('Marque 4 cantos do piso. A perspectiva será calculada junto.')
  }

  function startPerspectiveManual(){
    if(!room||!mask)return
    setFloorManual(false);setFloorPoints([]);setPerspectiveDraft([]);setPerspectiveManual(true);setMode('perspective')
    setStatus('Clique em 4 pontos: superior esquerdo, superior direito, inferior direito e inferior esquerdo.')
  }

  function canvasPoint(e){
    const c=canvasRef.current,r=c.getBoundingClientRect()
    return {x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)}
  }

  function clickCanvas(e){
    if(!room)return
    const p=canvasPoint(e)

    if(floorManual&&floorPoints.length<4){
      const n=[...floorPoints,p];setFloorPoints(n)
      if(n.length===4){
        const m=polygonMask(room.width,room.height,n)
        setMask(m);setPerspective(buildPerspective(n,room.width,room.height,'manual-floor'));setFloorManual(false);setFloorPoints([]);setMode('perspective')
        setStatus('Piso e perspectiva definidos manualmente. Confira a grade.')
      }
      return
    }

    if(perspectiveManual&&perspectiveDraft.length<4){
      const n=[...perspectiveDraft,p];setPerspectiveDraft(n)
      if(n.length===4){
        setPerspective(buildPerspective(n,room.width,room.height,'manual'));setPerspectiveManual(false);setPerspectiveDraft([]);setMode('perspective')
        setStatus('Perspectiva ajustada. Homografia 3×3 recalculada.')
      }
    }
  }

  async function copyMatrix(){
    if(!perspective)return
    const text=JSON.stringify(homographyText(perspective.matrix),null,2)
    try{await navigator.clipboard.writeText(text);setStatus('Matriz de homografia copiada.')}catch{setStatus('Homografia calculada e pronta para a Etapa 3.')}
  }

  function download(){
    if(!mask)return
    setMode('result')
    setTimeout(()=>{const a=document.createElement('a');a.download='floor-vision.png';a.href=canvasRef.current.toDataURL('image/png');a.click()},50)
  }

  const matrix=perspective?homographyText(perspective.matrix):null
  const editing=floorManual||perspectiveManual
  const count=floorManual?floorPoints.length:perspectiveDraft.length

  return <div className="app">
    <header><div className="brand"><b>FLOOR VISION</b><span>Visualizador de ambientes</span></div><button className="ghost" onClick={()=>location.reload()}>Reiniciar</button></header>
    <main>
      <section className="viewer">
        <div className="viewerHead"><div><small>AMBIENTE</small><h1>Veja o produto antes de instalar.</h1></div>{room&&mask&&<div className="tabs"><button className={mode==='result'?'on':''} onClick={()=>setMode('result')}>Resultado</button><button className={mode==='perspective'?'on':''} onClick={()=>setMode('perspective')}>Perspectiva</button><button className={mode==='mask'?'on':''} onClick={()=>setMode('mask')}>Máscara IA</button><button className={mode==='original'?'on':''} onClick={()=>setMode('original')}>Original</button></div>}</div>
        <div className={'stage '+(editing?'manual':'')}>
          {!room?<button className="drop" onClick={()=>fileRef.current?.click()}><strong>↑</strong><b>Envie uma foto do ambiente</b><span>JPG, PNG ou WEBP</span></button>:<canvas ref={canvasRef} onClick={clickCanvas}/>} 
          {editing&&<div className="hint">Marque 4 pontos · {count}/4</div>}
        </div>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={e=>pick(e.target.files?.[0])}/>
        <div className="viewerFoot"><div className="status"><i className={mask&&perspective?'ok':''}/>{status}</div><div className="actions">
          {room&&!mask&&<button className="secondary" onClick={startManualFloor}>Marcar piso manualmente</button>}
          {room&&!mask&&<button className="primary" disabled={busy} onClick={ai}>{busy?'Processando…':'✦ Detectar piso com IA'}</button>}
          {room&&mask&&<button className="secondary" onClick={startPerspectiveManual}>Ajustar 4 pontos</button>}
          {room&&mask&&<button className="primary" onClick={()=>setMode('perspective')}>▦ Ver perspectiva</button>}
        </div></div>
        {error&&<div className="error">{error}</div>}
      </section>
      <aside>
        <small>CATÁLOGO</small><h2>Escolha o acabamento</h2>
        <div className="products">{PRODUCTS.map(p=><button key={p.id} className={'product '+(p.id===product.id?'selected':'')} onClick={()=>setProduct(p)}><div className="swatch" style={swatch(p)}/><b>{p.name}</b></button>)}</div>

        {mask&&<div className="perspectiveCard">
          <div className="perspectiveTitle"><div><small>ETAPA 2</small><b>Geometria do piso</b></div><span className={perspective?'ready':''}>{perspective?'PRONTA':'AJUSTAR'}</span></div>
          {perspective?<><p>{perspective.source==='auto'?'4 cantos estimados a partir da máscara da IA.':'4 cantos definidos manualmente.'}</p><div className="matrix"><span>Homografia H · 3×3</span>{matrix.map((row,i)=><code key={i}>{row.map(v=>Number(v).toFixed(3)).join('   ')}</code>)}</div><div className="perspectiveButtons"><button onClick={()=>setMode('perspective')}>Ver grade</button><button onClick={copyMatrix}>Copiar H</button></div></>:<><p>A máscara existe, mas a geometria precisa ser definida.</p><button className="fullSecondary" onClick={startPerspectiveManual}>Definir 4 pontos</button></>}
        </div>}

        <div className="control"><label>Intensidade <b>{strength}%</b></label><input type="range" min="55" max="100" value={strength} onChange={e=>setStrength(+e.target.value)}/><p>Sombras e iluminação da foto original são preservadas na composição.</p></div>
        <button className="download" disabled={!mask||busy} onClick={download}>↓ Baixar resultado em PNG</button>
      </aside>
    </main>
    <footer>Etapa 2 ativa · máscara + quadrilátero + homografia calculados no navegador</footer>
  </div>
}
