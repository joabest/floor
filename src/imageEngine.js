import { projectPoint } from './perspective'

export const PRODUCTS = [
  { id:'oak', name:'Carvalho Natural', base:'#b98a5a', line:'#6f4e33', type:'wood' },
  { id:'walnut', name:'Nogueira Premium', base:'#6a4736', line:'#302019', type:'wood' },
  { id:'sand', name:'Porcelanato Areia', base:'#c9bba4', line:'#eee7dc', type:'tile' },
  { id:'marble', name:'Mármore Neve', base:'#dedede', line:'#a8a8a8', type:'tile' },
  { id:'cement', name:'Cimento Urbano', base:'#8a8d8e', line:'#626667', type:'tile' },
  { id:'graphite', name:'Porcelanato Grafite', base:'#34383c', line:'#62676b', type:'tile' },
]

export function loadImage(file, max=1440){
  return new Promise((resolve,reject)=>{
    const r=new FileReader(); r.onerror=()=>reject(new Error('Falha ao ler imagem.'))
    r.onload=()=>{ const img=new Image(); img.onerror=()=>reject(new Error('Imagem inválida.')); img.onload=()=>{
      const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)); const w=Math.round(img.naturalWidth*s), h=Math.round(img.naturalHeight*s)
      const c=document.createElement('canvas'); c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h)
      const dataUrl=c.toDataURL('image/jpeg',.94); const out=new Image(); out.onload=()=>resolve({image:out,dataUrl,width:w,height:h}); out.src=dataUrl
    }; img.src=String(r.result)}; r.readAsDataURL(file)
  })
}

export function polygonMask(w,h,points){
  const c=document.createElement('canvas'); c.width=w;c.height=h; const x=c.getContext('2d',{willReadFrequently:true}); x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='#fff';x.beginPath();points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.fill()
  const rgba=x.getImageData(0,0,w,h).data, data=new Uint8ClampedArray(w*h); for(let i=0;i<data.length;i++) data[i]=rgba[i*4]; return {width:w,height:h,data,device:'manual',occlusionMask:null}
}

function setCanvasSize(canvas,w,h){if(canvas){canvas.width=w;canvas.height=h}}
function clear(ctx,w,h){ctx.clearRect(0,0,w,h)}

function rawMaskCanvas(mask){
  const s=document.createElement('canvas');s.width=mask.width;s.height=mask.height;const sx=s.getContext('2d');const d=sx.createImageData(mask.width,mask.height)
  for(let i=0;i<mask.data.length;i++){const p=i*4,v=mask.data[i];d.data[p]=d.data[p+1]=d.data[p+2]=255;d.data[p+3]=v}
  sx.putImageData(d,0,0);return s
}

function scaledHardMask(mask,w,h){
  const s=rawMaskCanvas(mask)
  const hard=document.createElement('canvas');hard.width=w;hard.height=h
  const hx=hard.getContext('2d')
  hx.imageSmoothingEnabled=true
  hx.drawImage(s,0,0,w,h)
  return hard
}

function buildMaskCanvas(mask,w,h,{feather=0,inward=true}={}){
  const hard=scaledHardMask(mask,w,h)
  if(feather<=0) return hard

  const soft=document.createElement('canvas');soft.width=w;soft.height=h
  const sx=soft.getContext('2d')
  sx.save();sx.filter=`blur(${feather}px)`;sx.drawImage(hard,0,0);sx.restore()

  // Para piso, o fade deve acontecer SOMENTE para dentro. Sem este recorte,
  // o blur aumenta a máscara e pinta tapete, móveis e superfícies verticais.
  if(inward){
    sx.save();sx.globalCompositeOperation='destination-in';sx.drawImage(hard,0,0);sx.restore()
  }

  return soft
}

function textureCanvas(w,h,p){
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=p.base;x.fillRect(0,0,w,h);x.strokeStyle=p.line;x.globalAlpha=.58;x.lineWidth=2
  if(p.type==='wood'){
    for(let y=0;y<h;y+=38){x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
    for(let y=0,row=0;y<h;y+=38,row++){for(let xx=(row%2?-120:0);xx<w;xx+=240){x.beginPath();x.moveTo(xx,y);x.lineTo(xx,y+38);x.stroke()}}
  } else {
    for(let y=0;y<h;y+=95){x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
    for(let xx=0;xx<w;xx+=95){x.beginPath();x.moveTo(xx,0);x.lineTo(xx,h);x.stroke()}
  }
  x.globalAlpha=1;return c
}

function blendFloor(ctx,image,maskCanvas,product,w,h,strength){
  const tex=textureCanvas(w,h,product)
  const source=document.createElement('canvas');source.width=w;source.height=h;const sx=source.getContext('2d',{willReadFrequently:true});sx.drawImage(image,0,0,w,h)
  const orig=sx.getImageData(0,0,w,h);const t=tex.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data
  const mask=maskCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data
  const out=ctx.createImageData(w,h)
  for(let i=0;i<w*h;i++){
    const p=i*4,a=(mask[p+3]/255)*strength
    if(a<.01){out.data[p+3]=0;continue}
    const r=orig.data[p],g=orig.data[p+1],b=orig.data[p+2]
    const lum=(.2126*r+.7152*g+.0722*b)/255
    const shade=.48+lum*.78
    out.data[p]=r*(1-a)+Math.min(255,t[p]*shade)*a
    out.data[p+1]=g*(1-a)+Math.min(255,t[p+1]*shade)*a
    out.data[p+2]=b*(1-a)+Math.min(255,t[p+2]*shade)*a
    out.data[p+3]=Math.round(mask[p+3]*Math.max(.82,a))
  }
  ctx.putImageData(out,0,0)
}

function drawOcclusionLayer(ctx,image,occlusionMask,w,h){
  if(!occlusionMask?.data) return
  // Aqui um pequeno fade para fora é desejável: a imagem original dos
  // objetos deve cobrir 1px da borda do piso, evitando halos.
  const maskCanvas=buildMaskCanvas(occlusionMask,w,h,{feather:.8,inward:false})
  ctx.save();ctx.drawImage(image,0,0,w,h);ctx.globalCompositeOperation='destination-in';ctx.drawImage(maskCanvas,0,0,w,h);ctx.restore()
}

function drawFocusOverlay(ctx,maskCanvas,w,h){
  ctx.save();ctx.fillStyle='rgba(6,9,15,.20)';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='destination-out';ctx.drawImage(maskCanvas,0,0,w,h);ctx.restore()
  ctx.save();ctx.globalAlpha=.045;ctx.fillStyle='#4169e1';ctx.drawImage(maskCanvas,0,0,w,h);ctx.restore()
}

function drawMaskMode(ctx,maskCanvas,w,h){
  drawFocusOverlay(ctx,maskCanvas,w,h)
  ctx.save();ctx.globalAlpha=.12;ctx.fillStyle='#4169e1';ctx.drawImage(maskCanvas,0,0,w,h);ctx.restore()
}

function polygonPath(ctx,points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath()}
function drawPoint(ctx,p,active=true){ctx.save();ctx.fillStyle=active?'rgba(255,255,255,.8)':'rgba(159,178,245,.6)';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.lineWidth=1;ctx.strokeStyle='rgba(65,105,225,.38)';ctx.stroke();ctx.restore()}

function drawPerspectiveGrid(ctx,perspective){
  if(!perspective?.points?.length) return
  const points=perspective.points
  ctx.save()
  ctx.fillStyle='rgba(65,105,225,.025)';polygonPath(ctx,points);ctx.fill()
  ctx.lineWidth=1;ctx.strokeStyle='rgba(112,151,255,.28)';polygonPath(ctx,points);ctx.stroke()
  ctx.lineWidth=.6;ctx.strokeStyle='rgba(191,211,255,.12)'
  const steps=8, segments=28
  for(let i=1;i<steps;i++){
    const t=i/steps
    ctx.beginPath()
    for(let j=0;j<=segments;j++){const v=j/segments; const p=projectPoint(perspective.matrix,{x:t,y:v}); if(j===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y)}
    ctx.stroke()
    ctx.beginPath()
    for(let j=0;j<=segments;j++){const u=j/segments; const p=projectPoint(perspective.matrix,{x:u,y:t}); if(j===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y)}
    ctx.stroke()
  }
  points.forEach((p)=>drawPoint(ctx,p,true))
  ctx.restore()
}

function drawDraftQuad(ctx,draftPoints){
  if(!draftPoints?.length) return
  ctx.save();ctx.strokeStyle='rgba(112,151,255,.42)';ctx.lineWidth=1.25;ctx.fillStyle='rgba(65,105,225,.04)'
  ctx.beginPath();draftPoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); if(draftPoints.length>2) ctx.fill(); ctx.stroke()
  draftPoints.forEach((p)=>drawPoint(ctx,p,draftPoints.length===4))
  ctx.restore()
}

export function renderScene({baseCanvas,floorCanvas,objectCanvas,uiCanvas,image,mask,product,mode='result',strength=.92,perspective=null,draftPoints=[]}){
  if(!image) return
  const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height
  ;[baseCanvas,floorCanvas,objectCanvas,uiCanvas].forEach((canvas)=>setCanvasSize(canvas,w,h))
  const bx=baseCanvas?.getContext('2d'),fx=floorCanvas?.getContext('2d'),ox=objectCanvas?.getContext('2d'),ux=uiCanvas?.getContext('2d')
  if(!bx||!fx||!ox||!ux) return
  clear(bx,w,h);clear(fx,w,h);clear(ox,w,h);clear(ux,w,h)
  bx.drawImage(image,0,0,w,h)
  if(!mask){ if(draftPoints?.length) drawDraftQuad(ux,draftPoints); return }

  const displayMask=buildMaskCanvas(mask,w,h,{feather:.8,inward:true})
  const floorMask=buildMaskCanvas(mask,w,h,{feather:1.1,inward:true})

  if(mode==='mask') drawMaskMode(ux,displayMask,w,h)
  if(mode==='perspective') drawFocusOverlay(ux,displayMask,w,h)
  if(mode!=='original'&&mode!=='mask'&&product) blendFloor(fx,image,floorMask,product,w,h,strength)
  if(mask.occlusionMask) drawOcclusionLayer(ox,image,mask.occlusionMask,w,h)
  if(mode==='perspective'&&perspective) drawPerspectiveGrid(ux,perspective)
  if(draftPoints?.length) drawDraftQuad(ux,draftPoints)
}

export function exportCleanScene({image,mask,product,strength=.92}){
  if(!image) throw new Error('Imagem não disponível para exportação.')
  const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height
  const output=document.createElement('canvas');output.width=w;output.height=h
  const out=output.getContext('2d')
  out.drawImage(image,0,0,w,h)
  if(!mask||!product) return output

  const cleanFloor=document.createElement('canvas');cleanFloor.width=w;cleanFloor.height=h
  const floorMask=buildMaskCanvas(mask,w,h,{feather:1.1,inward:true})
  blendFloor(cleanFloor.getContext('2d'),image,floorMask,product,w,h,strength)
  out.drawImage(cleanFloor,0,0)

  if(mask.occlusionMask){
    const cleanObjects=document.createElement('canvas');cleanObjects.width=w;cleanObjects.height=h
    drawOcclusionLayer(cleanObjects.getContext('2d'),image,mask.occlusionMask,w,h)
    out.drawImage(cleanObjects,0,0)
  }
  return output
}

export function swatch(p){return p.type==='wood'?{backgroundColor:p.base,backgroundImage:`repeating-linear-gradient(0deg,transparent 0 22px,${p.line}77 22px 24px)`}:{backgroundColor:p.base,backgroundImage:`linear-gradient(${p.line}99 2px,transparent 2px),linear-gradient(90deg,${p.line}99 2px,transparent 2px)`,backgroundSize:'42px 42px'}}
