export const PRODUCTS = [
  { id:'oak', name:'Carvalho Natural', base:'#b98a5a', line:'#6f4e33', type:'wood' },
  { id:'walnut', name:'Nogueira Premium', base:'#6a4736', line:'#302019', type:'wood' },
  { id:'sand', name:'Porcelanato Areia', base:'#c9bba4', line:'#eee7dc', type:'tile' },
  { id:'marble', name:'Mármore Neve', base:'#dedede', line:'#a8a8a8', type:'tile' },
  { id:'cement', name:'Cimento Urbano', base:'#8a8d8e', line:'#626667', type:'tile' },
  { id:'graphite', name:'Porcelanato Grafite', base:'#34383c', line:'#62676b', type:'tile' },
]

export function loadImage(file, max=1600){
  return new Promise((resolve,reject)=>{
    const r=new FileReader(); r.onerror=()=>reject(new Error('Falha ao ler imagem.'))
    r.onload=()=>{ const img=new Image(); img.onerror=()=>reject(new Error('Imagem inválida.')); img.onload=()=>{
      const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)); const w=Math.round(img.naturalWidth*s), h=Math.round(img.naturalHeight*s)
      const c=document.createElement('canvas'); c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h)
      const dataUrl=c.toDataURL('image/jpeg',.92); const out=new Image(); out.onload=()=>resolve({image:out,dataUrl,width:w,height:h}); out.src=dataUrl
    }; img.src=String(r.result)}; r.readAsDataURL(file)
  })
}

export function polygonMask(w,h,points){
  const c=document.createElement('canvas'); c.width=w;c.height=h; const x=c.getContext('2d',{willReadFrequently:true}); x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='#fff';x.beginPath();points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.fill()
  const rgba=x.getImageData(0,0,w,h).data, data=new Uint8ClampedArray(w*h); for(let i=0;i<data.length;i++) data[i]=rgba[i*4]; return {width:w,height:h,data,device:'manual'}
}

function maskCanvas(mask,w,h){
  const s=document.createElement('canvas');s.width=mask.width;s.height=mask.height;const sx=s.getContext('2d');const d=sx.createImageData(mask.width,mask.height)
  for(let i=0;i<mask.data.length;i++){const p=i*4,v=mask.data[i];d.data[p]=d.data[p+1]=d.data[p+2]=v;d.data[p+3]=255} sx.putImageData(d,0,0)
  const t=document.createElement('canvas');t.width=w;t.height=h;t.getContext('2d').drawImage(s,0,0,w,h);return t
}

function textureCanvas(w,h,p){
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=p.base;x.fillRect(0,0,w,h);x.strokeStyle=p.line;x.globalAlpha=.55
  if(p.type==='wood'){for(let y=0;y<h;y+=38){x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}for(let y=0,row=0;y<h;y+=38,row++){for(let xx=(row%2?-120:0);xx<w;xx+=240){x.beginPath();x.moveTo(xx,y);x.lineTo(xx,y+38);x.stroke()}}}
  else {for(let y=0;y<h;y+=95){x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}for(let xx=0;xx<w;xx+=95){x.beginPath();x.moveTo(xx,0);x.lineTo(xx,h);x.stroke()}}
  x.globalAlpha=1;return c
}

export function render({canvas,image,mask,product,mode='result',strength=.92}){
  if(!canvas||!image)return; const w=image.naturalWidth,h=image.naturalHeight;canvas.width=w;canvas.height=h;const x=canvas.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,w,h);if(!mask||mode==='original')return
  const mc=maskCanvas(mask,w,h),m=mc.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data
  if(mode==='mask'){const o=x.getImageData(0,0,w,h);for(let i=0;i<w*h;i++){const a=(m[i*4]/255)*.42,p=i*4;if(a){o.data[p]=o.data[p]*(1-a)+65*a;o.data[p+1]=o.data[p+1]*(1-a)+105*a;o.data[p+2]=o.data[p+2]*(1-a)+225*a}}x.putImageData(o,0,0);return}
  if(!product)return; const t=textureCanvas(w,h,product).getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h),o=x.getImageData(0,0,w,h),z=x.createImageData(w,h)
  for(let i=0;i<w*h;i++){const p=i*4,a=(m[p]/255)*strength,r=o.data[p],g=o.data[p+1],b=o.data[p+2],lum=(.2126*r+.7152*g+.0722*b)/255,f=.5+lum*.75;z.data[p]=r*(1-a)+Math.min(255,t.data[p]*f)*a;z.data[p+1]=g*(1-a)+Math.min(255,t.data[p+1]*f)*a;z.data[p+2]=b*(1-a)+Math.min(255,t.data[p+2]*f)*a;z.data[p+3]=255}x.putImageData(z,0,0)
}

export function swatch(p){return p.type==='wood'?{backgroundColor:p.base,backgroundImage:`repeating-linear-gradient(0deg,transparent 0 22px,${p.line}77 22px 24px)`}:{backgroundColor:p.base,backgroundImage:`linear-gradient(${p.line}99 2px,transparent 2px),linear-gradient(90deg,${p.line}99 2px,transparent 2px)`,backgroundSize:'42px 42px'}}
