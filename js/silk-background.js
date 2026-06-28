(()=>{
const canvas=document.getElementById('silk-background');
const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance',desynchronized:true});
if(!gl){
  window.__silkRenderer='unavailable';
  window.__silkShaderOK=false;
  canvas.style.background='linear-gradient(120deg,#c41224,#74105a 42%,#169db9 72%,#0754a8)';
  return;
}
const vertex=`#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main(){
  v_uv=a_position*.5+.5;
  gl_Position=vec4(a_position,0.0,1.0);
}`;
const fragment=`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_blob0;
uniform vec3 u_blob1;
uniform vec3 u_blob2;
uniform vec3 u_blob3;
uniform vec3 u_blob4;
uniform vec3 u_color0;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform vec3 u_color4;
uniform vec4 u_bounds;  // 前4个高度占比阈值(青|蓝|品红|红)，第5个=1

const float TAU=6.28318530718;

float gaussian(float d,float width){
  return exp(-(d*d)/width);
}

vec2 flowWarp(vec2 p,float ph){
  vec2 q=p;
  float sx=sin(ph),cx=cos(ph);
  q.x+=.135*sin(q.y*.70+ph)+.050*sin(q.y*1.28-ph+1.15)+.028*cx;
  q.y+=.105*sin(q.x*.58-ph+2.10)+.038*sin(q.x*1.05+ph*2.0-.65)+.022*sx;
  q.x+=.030*sin((q.x+q.y)*.43+ph);
  q.y+=.024*cos((q.x-q.y)*.39-ph*2.0);
  return q;
}

float heightField(vec2 p,float ph){
  vec2 q=flowWarp(p,ph);
  float h=0.0;

  h+=.145*sin(dot(q,vec2(.52,.82))+ph+.35*sin(q.x*.32-ph*2.0));
  h+=.095*sin(dot(q,vec2(-.43,.68))-ph+1.60+.22*sin(q.y*.38+ph));
  h+=.052*sin(dot(q,vec2(.78,-.34))+ph*2.0+3.15);

  float d1=q.y-.31*sin(q.x*.52+ph)-.105*cos(q.x*.91-ph*2.0+1.25)-.055*sin(ph);
  h+=.410*gaussian(d1,.115);
  h-=.176*gaussian(d1+.315,.185);

  float d2=.58*q.x+.79*q.y-.205*sin(q.x*.34-q.y*.22-ph+1.55)-.065*cos(ph*2.0+q.y*.24);
  h+=.305*gaussian(d2,.165);
  h-=.128*gaussian(d2-.355,.240);

  float d3=-.42*q.x+.86*q.y-.178*sin(q.x*.31+q.y*.26+ph+2.35)+.052*sin(ph*2.0);
  h+=.244*gaussian(d3,.205);
  h-=.095*gaussian(d3+.420,.290);

  vec2 c=q-vec2(.30*sin(ph+.8),.19*cos(ph*2.0-.4));
  float along=c.x*.82+c.y*.57;
  float across=-c.x*.57+c.y*.82-.095*sin(along*.66-ph);
  h+=.255*exp(-(across*across/.080+along*along/3.45));
  h-=.090*exp(-((across+.30)*(across+.30)/.145+along*along/3.80));

  return h;
}

// 纯高度分层：固定顺序 青→蓝→品红→红→黄(高→低)，按各色占比分割
vec3 colorField(float h){
  float t=clamp((h+0.3)/1.2,0.0,1.0);
  t=pow(t,0.9);
  float b0=u_bounds.x,b1=u_bounds.y,b2=u_bounds.z,b3=u_bounds.w;
  vec3 c;
  if(t<b0){c=mix(u_color0,u_color1,smoothstep(0.0,b0,t));}
  else if(t<b1){c=mix(u_color1,u_color2,smoothstep(b0,b1,t));}
  else if(t<b2){c=mix(u_color2,u_color3,smoothstep(b1,b2,t));}
  else if(t<b3){c=mix(u_color3,u_color4,smoothstep(b2,b3,t));}
  else{c=u_color4;}
  return c;
}

void main(){
  float aspect=u_resolution.x/max(u_resolution.y,1.0);
  vec2 p=(v_uv-.5)*vec2(1.5*aspect,1.5);  // 缩小坐标范围 → 丝绸细节放大
  float ph=mod(u_time,12.6)*(TAU/12.6);

  float e=.0045;
  float h0=heightField(p,ph);
  float hxp=heightField(p+vec2(e,0.0),ph);
  float hxm=heightField(p-vec2(e,0.0),ph);
  float hyp=heightField(p+vec2(0.0,e),ph);
  float hym=heightField(p-vec2(0.0,e),ph);
  float hx=(hxp-hxm)/(2.0*e);
  float hy=(hyp-hym)/(2.0*e);
  float lap=(hxp+hxm+hyp+hym-4.0*h0)/(e*e);

  float relief=.50;
  vec3 n=normalize(vec3(-hx*relief,-hy*relief,1.0));
  vec3 v=vec3(0.0,0.0,1.0);
  vec3 l=normalize(vec3(-.30+.075*sin(ph),.38+.055*cos(ph),.88));
  vec3 halfV=normalize(l+v);
  float ndl=max(dot(n,l),0.0);
  float ndh=max(dot(n,halfV),0.0);

  vec3 tangent=normalize(vec3(1.0,0.0,hx*relief));
  vec3 bitangent=normalize(cross(n,tangent));
  float ht=dot(halfV,tangent);
  float hb=dot(halfV,bitangent);
  float hn=max(dot(halfV,n),.035);
  float ward=exp(-((ht*ht)/(.52*.52)+(hb*hb)/(.18*.18))/(hn*hn));

  float broad=pow(ndh,3.2)*.235;
  float tight=pow(ndh,17.0)*.145;
  float anisotropic=ward*.255;
  float curvature=clamp(abs(lap)*.00092,0.0,1.0);
  float crest=smoothstep(.10,.75,curvature)*pow(ndh,2.0)*.038;

  vec3 base=colorField(h0);
  float diffuse=.865+.165*ndl;
  float ambientLift=.030+.020*sin(h0*1.15+ph);
  vec3 silkLight=vec3(.130,.460,.510)*(broad+tight+anisotropic+crest);
  vec3 coolGlint=vec3(.200,.680,.740)*pow(ndh,7.0)*.034;
  vec3 color=base*(diffuse+ambientLift)+silkLight+coolGlint;

  float lum=dot(color,vec3(.2126,.7152,.0722));
  color+=max(0.0,.235-lum)*vec3(.006,.150,.480);
  color=clamp(color,0.0,1.0);
  color=pow(color,vec3(.955));
  outColor=vec4(color,1.0);
}`;

function compile(type,source){
  const shader=gl.createShader(type);
  gl.shaderSource(shader,source);
  gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const message=gl.getShaderInfoLog(shader)||'shader compile failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}
function makeProgram(){
  const program=gl.createProgram();
  gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'program link failed');
  return program;
}
let program;
try{program=makeProgram()}catch(error){
  window.__silkRenderer='shader-error';
  window.__silkShaderOK=false;
  window.__silkError=String(error&&error.message||error);
  console.error(error);
  return;
}
const buffer=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
const position=gl.getAttribLocation(program,'a_position');
gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
gl.useProgram(program);
const uniforms={
  resolution:gl.getUniformLocation(program,'u_resolution'),
  time:gl.getUniformLocation(program,'u_time'),
  blobs:[0,1,2,3,4].map(i=>gl.getUniformLocation(program,'u_blob'+i)),
  colors:[0,1,2,3,4].map(i=>gl.getUniformLocation(program,'u_color'+i)),
  bounds:gl.getUniformLocation(program,'u_bounds')
};
// 默认色（无封面或取色失败时回退）：红、品红、紫、青、蓝
const DEFAULT_COLORS=[[.760,.070,.035],[.780,.012,.130],[.440,.012,.340],[.028,.560,.670],[.006,.170,.520]];
let bgColors=DEFAULT_COLORS.map(c=>c.slice());

// 智能排序：按亮度主序，同时保证相邻层色相相近（避免黄/蓝等冲突色相邻）
function hueOf(r,g,b){
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  if(d===0)return 0;
  let h;
  if(mx===r)h=((g-b)/d)%6;
  else if(mx===g)h=(b-r)/d+2;
  else h=(r-g)/d+4;
  return (h<0?h+6:h)/6; // 0~1
}
// 色相环距离（0~0.5，越小越近）
function hueDist(a,b){
  let d=Math.abs(hueOf(a[0],a[1],a[2])-hueOf(b[0],b[1],b[2]));
  return d>0.5?1-d:d;
}
// 固定顺序（高→低）：青、蓝、品红、红、黄。把提取色按色相最近匹配到这5个目标位
// 同时按各色在封面中的占比分配高度区间（占比大的层更宽），返回排好的色 + 累计占比阈值
const FIXED_ORDER_TARGETS=[[0,1,1],[0,0.3,1],[1,0,0.5],[1,0,0],[1,1,0]]; // 青蓝品红红黄
function mapToFixedOrder(items){
  // items: [{color,w}], 每个匹配到最接近的固定目标位（一对一，匈牙利贪心）
  const n=items.length;
  const usedItem=new Array(n).fill(false);
  const slots=[null,null,null,null,null]; // 每个目标位放一个 item
  // 对每个目标位，找未用 item 中色相最近的
  for(let s=0;s<5;s++){
    const target=FIXED_ORDER_TARGETS[s];
    let best=-1,bestD=Infinity;
    for(let i=0;i<n;i++){
      if(usedItem[i])continue;
      const d=hueDist(items[i].color,target);
      if(d<bestD){bestD=d;best=i}
    }
    if(best>=0){slots[s]=items[best];usedItem[best]=true}
  }
  // 补未填满的位（用默认色均分）
  for(let s=0;s<5;s++)if(!slots[s])slots[s]={color:FIXED_ORDER_TARGETS[s],w:0.2};
  // 归一化占比，算累计阈值（层 s 的上边界 = 前 s+1 个占比之和）
  let sumW=slots.reduce((a,x)=>a+x.w,0)||1;
  let cum=0;
  const colors=[],bounds=[];
  for(let s=0;s<5;s++){
    colors.push(slots[s].color);
    cum+=slots[s].w/sumW;
    bounds.push(cum);
  }
  bounds[4]=1; // 末位封顶
  return {colors,bounds};
}
let bgColorsSorted=DEFAULT_COLORS.map(c=>c.slice());
let bgBounds=[0.2,0.4,0.6,0.8,1.0];
// 颜色 lerp 过渡：targetColors 是目标，curColors 是当前显示色，每帧逼近
let curColors=bgColorsSorted.map(c=>c.slice());
let curBounds=bgBounds.slice();
function lerpColors(){
  let changed=false;
  for(let i=0;i<5;i++){
    for(let j=0;j<3;j++){
      const d=bgColorsSorted[i][j]-curColors[i][j];
      if(Math.abs(d)>0.001){curColors[i][j]+=d*0.08;changed=true}
    }
    const db=bgBounds[i]-curBounds[i];
    if(Math.abs(db)>0.001){curBounds[i]+=db*0.08;changed=true}
  }
  return changed;
}

// 从封面提取 5 个主色：缩到 64x64 → 中位切分量化
function extractCoverColors(img){
  try{
    const cv=document.createElement('canvas');
    cv.width=64;cv.height=64;
    const cx=cv.getContext('2d',{willReadFrequently:true});
    cx.drawImage(img,0,0,64,64);
    const data=cx.getImageData(0,0,64,64).data;
    // 先算封面平均亮度，自适应决定过滤阈值（亮封面收紧防过曝，暗封面宽松保细节）
    let avgLum=0,lumCount=0;
    for(let i=0;i<data.length;i+=4){
      const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
      avgLum+=(Math.max(r,g,b)+Math.min(r,g,b))/2;lumCount++;
    }
    avgLum/=lumCount||1;
    const isBright=avgLum>0.45;  // 亮封面（如天使 avgLum≈0.49，浅色背景）
    const satMin=isBright?0.15:0.06;
    const lumMax=isBright?0.72:0.95;
    const lumMin=isBright?0.12:0.08;
    const boost=isBright?0.5:1.25;
    const clampMax=isBright?0.75:1.0;  // 亮封面压更低，给shader的sqrt提亮+高光留余量防过曝
    // 收集像素 [r,g,b]，按自适应阈值过滤
    const px=[];
    for(let i=0;i<data.length;i+=4){
      const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
      const max=Math.max(r,g,b),min=Math.min(r,g,b);
      const sat=max-min;
      const lum=(max+min)/2;
      if(sat<satMin)continue;
      if(lum<lumMin||lum>lumMax)continue;
      px.push([r,g,b]);
    }
    if(px.length<20)return null;
    // 中位切分：递归找 5 个色块（不可切的 box 跳过，避免产生空 box）
    const boxes=[px];
    while(boxes.length<5){
      // 选范围最大且可切(点数>1且range>0)的 box
      let bi=-1,bestR=-1;
      for(let i=0;i<boxes.length;i++){
        const b=boxes[i];
        if(b.length<2)continue;              // 点数不足，不可切
        const r=boxRange(b);
        if(r<=0)continue;                    // 单色，不可切
        if(r>bestR){bestR=r;bi=i}
      }
      if(bi<0)break;                         // 没有可切的 box 了，提前结束
      const cut=medianCut(boxes[bi]);
      boxes.splice(bi,1,cut[0],cut[1]);
    }
    // 每个 box 取平均色+像素占比，按像素数排序取前5，增强饱和度
    const total=px.length||1;
    const all=boxes.map(boxAvg).sort((a,b)=>b.w-a.w).slice(0,5).map(c=>{
      const max=Math.max(c.r,c.g,c.b),min=Math.min(c.r,c.g,c.b);
      return {color:[Math.min(clampMax,c.r+(c.r-(max+min)/2)*boost),Math.min(clampMax,c.g+(c.g-(max+min)/2)*boost),Math.min(clampMax,c.b+(c.b-(max+min)/2)*boost)],w:c.w/total};
    });
    // 不足5个补默认(均分占比)
    while(all.length<5)all.push({color:DEFAULT_COLORS[all.length],w:0.2});
    return all;
  }catch(e){console.warn('cover color extract failed',e);return null}
}
function boxRange(pts){if(!pts.length)return 0;const r=range(pts,0),g=range(pts,1),b=range(pts,2);return Math.max(r[1]-r[0],g[1]-g[0],b[1]-b[0])}
function range(pts,k){let mn=1/0,mx=-1/0;for(const p of pts){if(p[k]<mn)mn=p[k];if(p[k]>mx)mx=p[k]}return[mn,mx]}
function medianCut(pts){
  // 找范围最大的通道，按中位数切；保证两半都非空
  let kc=0,kv=-1;
  for(let k=0;k<3;k++){const v=range(pts,k)[1]-range(pts,k)[0];if(v>kv){kv=v;kc=k}}
  pts.sort((a,b)=>a[kc]-b[kc]);
  const mid=Math.max(1,Math.min(pts.length-1,pts.length>>1));  // 避免 mid=0 或 mid=length 产生空box
  return[pts.slice(0,mid),pts.slice(mid)];
}
function boxAvg(pts){
  let r=0,g=0,b=0;for(const p of pts){r+=p[0];g+=p[1];b+=p[2]}
  const n=pts.length||1;return{r:r/n,g:g/n,b:b/n,w:pts.length};
}
// 加载封面并提取颜色
function loadCoverColors(){
  const img=document.querySelector('.cover img')||document.querySelector('.cover');
  const src=img&&(img.src||img.getAttribute('src'));
  if(!src){return}
  const im=new Image();
  im.crossOrigin='anonymous';
  im.onload=()=>{const items=extractCoverColors(im);if(items){const r=mapToFixedOrder(items);bgColorsSorted=r.colors;bgBounds=r.bounds;console.log('[silk] 取色自封面:',bgColorsSorted.map(x=>'#'+x.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')));console.log('[silk] 高度占比阈值:',bgBounds.map(x=>x.toFixed(2)))}};
  im.onerror=()=>{};
  im.src=src;
}
loadCoverColors();
// 暴露重新取色接口，供切歌时调用
window.__reloadCoverColors=function(newSrc){loadCoverColors(newSrc)};
const fixed=new URLSearchParams(location.search).get('silkTime');
const started=performance.now();
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
// 液态色心：每个 blob 做连续李萨如漂移（不同频率/相位），像染料在液体中流动，永不跳变
const BLOB_BASE=[[-.5,.4],[-.4,-.45],[0,0],[.5,-.3],[.55,.4]];  // 5 个基准中心，分散在画面
function stateAt(time){
  return BLOB_BASE.map((b,i)=>{
    const w=0.45+0.1*i;                       // 漂移幅度
    const fx=0.13+0.029*i, fy=0.11+0.037*i;   // 不同频率避免同步
    const px=0.7*i, py=1.3+0.5*i;             // 不同相位
    const x=b[0]+w*Math.sin(time*fx+px)+0.12*Math.sin(time*fx*2.3+px);
    const y=b[1]+w*Math.cos(time*fy+py)+0.12*Math.cos(time*fy*1.9+py);
    const z=0.85+0.45*Math.sin(time*0.08+i*1.7);  // 强度缓慢起伏
    return [x,y,Math.max(0.3,z)];
  });
}
function resize(){
  const dpr=Math.min(devicePixelRatio||1,1.45);
  const w=Math.max(2,Math.round(innerWidth*dpr));
  const h=Math.max(2,Math.round(innerHeight*dpr));
  if(canvas.width!==w||canvas.height!==h){
    canvas.width=w;canvas.height=h;
    gl.viewport(0,0,w,h);
  }
}
function draw(time){
  resize();
  const blobs=stateAt(time);
  gl.useProgram(program);
  gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);
  gl.uniform1f(uniforms.time,time);
  for(let i=0;i<5;i++)gl.uniform3f(uniforms.blobs[i],blobs[i][0],blobs[i][1],blobs[i][2]);
  lerpColors();  // 颜色平滑过渡
  for(let i=0;i<5;i++)gl.uniform3f(uniforms.colors[i],curColors[i][0],curColors[i][1],curColors[i][2]);
  gl.uniform4f(uniforms.bounds,curBounds[0],curBounds[1],curBounds[2],curBounds[3]);
  gl.drawArrays(gl.TRIANGLES,0,6);
}
const frameTimes=[];
let lastFrame=0;
function loop(now){
  const time=fixed!==null?Number(fixed):(now-started)/1000;
  draw(time);
  if(lastFrame){
    const dt=now-lastFrame;
    if(dt>0&&dt<250){frameTimes.push(dt);if(frameTimes.length>180)frameTimes.shift()}
  }
  lastFrame=now;
  window.__silkFrames=(window.__silkFrames||0)+1;
  requestAnimationFrame(loop);
}
function readAudit(time){
  draw(time);
  gl.finish();
  const w=canvas.width,h=canvas.height;
  const rgba=new Uint8Array(w*h*4);
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  const step=Math.max(1,Math.floor(Math.min(w,h)/140));
  let edge=0,edgeN=0,center=0,centerN=0,dx=0,dxN=0,dy=0,dyN=0,sharp=0,minLuma=1,maxLuma=0,edgeMinLuma=1,maxJump=0;
  const lumAt=(x,y)=>{
    const k=(y*w+x)*4;
    return (.2126*rgba[k]+.7152*rgba[k+1]+.0722*rgba[k+2])/255;
  };
  for(let y=0;y<h;y+=step){
    for(let x=0;x<w;x+=step){
      const l=lumAt(x,y);
      minLuma=Math.min(minLuma,l);maxLuma=Math.max(maxLuma,l);
      const border=x<w*.08||x>w*.92||y<h*.08||y>h*.92;
      if(border){edge+=l;edgeN++;edgeMinLuma=Math.min(edgeMinLuma,l)}else if(x>w*.30&&x<w*.70&&y>h*.25&&y<h*.75){center+=l;centerN++}
      if(x+step<w){const d=Math.abs(l-lumAt(x+step,y));dx+=d;dxN++;maxJump=Math.max(maxJump,d);if(d>.18)sharp++}
      if(y+step<h){const d=Math.abs(l-lumAt(x,y+step));dy+=d;dyN++;maxJump=Math.max(maxJump,d)}
    }
  }
  const sampleLuma=[];
  for(let sy=1;sy<=5;sy++)for(let sx=1;sx<=8;sx++)sampleLuma.push(lumAt(Math.min(w-1,Math.round(w*sx/9)),Math.min(h-1,Math.round(h*sy/6))));
  return {
    edgeLuma:edge/Math.max(edgeN,1),
    centerLuma:center/Math.max(centerN,1),
    edgeToCenter:(edge/Math.max(edgeN,1))/(center/Math.max(centerN,1)),
    meanHorizontalJump:dx/Math.max(dxN,1),
    meanVerticalJump:dy/Math.max(dyN,1),
    sharpHorizontalJumpRatio:sharp/Math.max(dxN,1),
    minLuma,maxLuma,edgeMinLuma,maxJump,
    sampleLuma,
    width:w,height:h
  };
}
window.__silkRenderer='webgl2-heightfield-normal-lighting';
window.__silkShaderOK=true;
window.__silkAudit=readAudit;
window.__silkStats=()=>({
  renderer:window.__silkRenderer,
  shaderOK:window.__silkShaderOK,
  frames:window.__silkFrames||0,
  averageFps:frameTimes.length?1000/(frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length):0,
  canvas:[canvas.width,canvas.height]
});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();window.__silkContextLost=true;console.error('WebGL context lost')});
addEventListener('resize',resize,{passive:true});
requestAnimationFrame(loop);
})();
