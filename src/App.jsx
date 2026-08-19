import { useEffect, useRef, useState } from 'react'
import { segmentFloor } from './segmentFloor'
import { PRODUCTS, loadImage, polygonMask, render, swatch } from './imageEngine'

export default function App(){
  const canvasRef=useRef(null),fileRef=useRef(null)
  const [room,setRoom]=useState(null),[mask,setMask]=useState(null),[product,setProduct]=useState(PRODUCTS[0])
  const [mode,setMode]=useState('result'),[busy,setBusy]=useState(false),[status,setStatus]=useState('Envie uma foto para começar'),[error,setError]=useState('')
  const [manual,setManual]=useState(false),[points,setPoints]=useState([]),[strength,setStrength]=useState(92)

  useEffect(()=>{if(room)render({canvas:canvasRef.current,image:room.image,mask,product,mode,strength:strength/100})},[room,mask,product,mode,strength])

  async function pick(file){if(!file)return;setError('');setBusy(true);try{const r=await loadImage(file);setRoom(r);setMask(null);setPoints([]);setStatus('Foto pronta. Detecte o piso com IA.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function ai(){if(!room)return;setBusy(true);setError('');setManual(false);try{const m=await segmentFloor(room.dataUrl,e=>setStatus(e.status==='inferencing'?'Identificando o piso…':'Carregando IA no navegador…'));setMask(m);setStatus('Piso detectado. Escolha um acabamento.')}catch(e){setError((e.message||'Falha na IA')+' Use a marcação manual como alternativa.');setStatus('Detecção automática não concluiu.')}finally{setBusy(false)}}
  function startManual(){if(!room)return;setMask(null);setPoints([]);setManual(true);setStatus('Clique em 4 pontos ao redor do piso.')}
  function clickCanvas(e){if(!manual||points.length>=4)return;const c=canvasRef.current,r=c.getBoundingClientRect(),p={x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)},n=[...points,p];setPoints(n);if(n.length===4){setMask(polygonMask(room.width,room.height,n));setManual(false);setStatus('Área manual definida. Escolha um acabamento.')}}
  function download(){if(!mask)return;setMode('result');setTimeout(()=>{const a=document.createElement('a');a.download='floor-vision.png';a.href=canvasRef.current.toDataURL('image/png');a.click()},50)}

  return <div className="app">
    <header><div className="brand"><b>FLOOR VISION</b><span>Visualizador de ambientes</span></div><button className="ghost" onClick={()=>location.reload()}>Reiniciar</button></header>
    <main>
      <section className="viewer">
        <div className="viewerHead"><div><small>AMBIENTE</small><h1>Veja o produto antes de instalar.</h1></div>{room&&mask&&<div className="tabs"><button className={mode==='result'?'on':''} onClick={()=>setMode('result')}>Resultado</button><button className={mode==='mask'?'on':''} onClick={()=>setMode('mask')}>Máscara IA</button><button className={mode==='original'?'on':''} onClick={()=>setMode('original')}>Original</button></div>}</div>
        <div className={'stage '+(manual?'manual':'')}>
          {!room?<button className="drop" onClick={()=>fileRef.current?.click()}><strong>↑</strong><b>Envie uma foto do ambiente</b><span>JPG, PNG ou WEBP</span></button>:<canvas ref={canvasRef} onClick={clickCanvas}/>} 
          {manual&&<div className="hint">Marque 4 pontos · {points.length}/4</div>}
        </div>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={e=>pick(e.target.files?.[0])}/>
        <div className="viewerFoot"><div className="status"><i className={mask?'ok':''}/>{status}</div><div className="actions">{room&&!mask&&<button className="secondary" onClick={startManual}>Marcar piso manualmente</button>}{room&&<button className="primary" disabled={busy} onClick={ai}>{busy?'Processando…':'✦ Detectar piso com IA'}</button>}</div></div>
        {error&&<div className="error">{error}</div>}
      </section>
      <aside>
        <small>CATÁLOGO</small><h2>Escolha o acabamento</h2>
        <div className="products">{PRODUCTS.map(p=><button key={p.id} className={'product '+(p.id===product.id?'selected':'')} onClick={()=>setProduct(p)}><div className="swatch" style={swatch(p)}/><b>{p.name}</b></button>)}</div>
        <div className="control"><label>Intensidade <b>{strength}%</b></label><input type="range" min="55" max="100" value={strength} onChange={e=>setStrength(+e.target.value)}/><p>Sombras e iluminação da foto original são preservadas na composição.</p></div>
        <button className="download" disabled={!mask||busy} onClick={download}>↓ Baixar resultado em PNG</button>
      </aside>
    </main>
    <footer>IA executada no navegador · sem backend pesado na Vercel</footer>
  </div>
}
