// player.js v6 (word-by-word karaoke + 歌单切换)
console.log('[player.js] v6 loaded, crossOrigin=', document.getElementById('audio').crossOrigin, 'protocol=', location.protocol);

const list=document.getElementById('list'),audio=document.getElementById('audio'),play=document.getElementById('play'),player=document.getElementById('player'),fill=document.getElementById('fill'),now=document.getElementById('now'),track=document.getElementById('track'),hint=document.getElementById('hint'),total=document.getElementById('total'),wave=document.getElementById('wave'),queueBtn=document.getElementById('queue'),songPicker=document.getElementById('song-picker'),pickerTrack=document.getElementById('picker-track');
const pauseIcon='<span class="pause-mark"></span>',playIcon='<span class="play-mark"></span>';
let active=0,running=false,targetOffset=0;
let data=[],wordEls=[];
let currentSongIdx=0;

// 用歌词数据重建歌词 DOM + wordEls 缓存（切歌时调用）
function buildLyrics(rawData){
  list.innerHTML='';
  data=rawData.map(it=>({en:it.en,cn:it.cn,words:it.words||[],t:it.words&&it.words.length?it.words[0][1]:0}));
  data.forEach((x,i)=>{
    const d=document.createElement('div');d.className='line';if(i===1)d.classList.add('more');
    let enHTML;
    if(x.words.length){
      enHTML='<div class="en">'+x.words.map((w,wi)=>`<span class="word" data-w="${wi}">${w[0]}</span>`).join(' ')+'</div>';
    }else{
      enHTML=`<div class="en">${x.en}</div>`;
    }
    d.innerHTML=enHTML+(x.cn?`<div class="cn">${x.cn}</div>`:'');
    d.onclick=()=>{if(isFinite(x.t)&&x.t>0){audio.currentTime=x.t;setLine(i)}};
    list.appendChild(d);
  });
  wordEls=[...list.children].map(line=>[...line.querySelectorAll('.word')]);
  active=0;targetOffset=0;lastWordKey='';curOffset=0;vel=0;
  setLine(0);
}

// 歌单：动态加载某首歌的歌词 js 文件，返回 Promise
// 每首歌用独立全局变量 window.LYRICS_{songId}，避免互相覆盖
function loadLyricsFile(songId){
  const varName='LYRICS_'+songId;
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='js/lyrics-timed-'+songId+'.js';
    s.onload=()=>resolve(window[varName]);
    s.onerror=()=>reject(new Error('歌词加载失败: '+songId));
    document.body.appendChild(s);
  });
}

// 切换到某首歌
async function switchSong(idx){
  if(idx===currentSongIdx&&data.length)return;
  const song=window.PLAYLIST[idx];
  if(!song)return;
  // 停止当前播放
  audio.pause();running=false;setButton();
  currentSongIdx=idx;
  // 换音频源 + 标题 + 封面
  audio.src=song.audio;
  const tEl=titleEl||document.querySelector('.title');if(tEl)tEl.textContent=song.title;
  const aEl=artistEl||document.querySelector('.artist');if(aEl)aEl.textContent=song.artist;
  const coverImg=document.querySelector('img.cover');
  if(coverImg&&song.cover){coverImg.src=song.cover;coverImg.alt=song.title+' cover'}
  // 触发背景重新取色（等封面图加载后）
  if(window.__reloadCoverColors){const ci=coverImg;const reload=()=>window.__reloadCoverColors();if(ci.complete)reload();else ci.addEventListener('load',reload,{once:true})}
  fill.style.width='0%';now.textContent='0:00';
  // 加载歌词
  try{
    const raw=await loadLyricsFile(song.id);
    buildLyrics(raw);
    console.log('[player] 切歌:',song.title,'歌词',raw.length,'行');
  }catch(e){
    buildLyrics([{en:'歌词加载失败',cn:'',words:[]}]);
    console.error(e);
  }
  // 若选择器开着，更新居中位置
  if(songPicker.classList.contains('show')){pickerCenter=currentSongIdx;updatePickerPosition(true)}
}

// 歌单 UI
// 轮播式歌曲选择器
// 拖动只切背景颜色(lerp平滑)，松手吸附后才完整切歌(音频/歌词/标题)
// 轮播封面图固定不变；标题/歌手从原 .player 移到居中封面下方(DOM移动)
let pickerCenter=0;
const COVER_W=300,SLOT_W=COVER_W+60;
let titleEl=null,artistEl=null,titleParent=null,artistParent=null;
function buildPicker(){
  // 先把标题歌手移回原位（避免被 innerHTML='' 删除）
  if(titleEl&&titleParent&&titleEl.parentNode!==titleParent){titleEl.className='title';titleParent.appendChild(titleEl)}
  if(artistEl&&artistParent&&artistEl.parentNode!==artistParent){artistEl.className='artist';artistParent.appendChild(artistEl)}
  pickerTrack.innerHTML='';
  window.PLAYLIST.forEach((song,i)=>{
    const div=document.createElement('div');
    div.className='picker-cover';
    div.dataset.idx=i;
    const img=document.createElement('img');
    img.src=song.cover;img.alt=song.title;
    div.appendChild(img);
    div.onclick=e=>{if(dragMoved)return;commitPickerSong(i);toggleQueue(false)};
    pickerTrack.appendChild(div);
  });
  pickerCenter=currentSongIdx;
  dragOffset=0;
  if(!titleEl){
    titleEl=document.querySelector('.title');
    artistEl=document.querySelector('.artist');
    titleParent=titleEl.parentNode;
    artistParent=artistEl.parentNode;
  }
  updatePickerPosition(false);
}
function attachTitleArtist(centerEl){
  if(!centerEl||!titleEl)return;
  titleEl.className='pc-title';
  artistEl.className='pc-artist';
  centerEl.appendChild(titleEl);
  centerEl.appendChild(artistEl);
}
function updatePickerPosition(animate){
  pickerTrack.classList.toggle('dragging',!animate);
  const w=innerWidth;
  const offset=-(pickerCenter*SLOT_W+COVER_W/2)+dragOffset;
  pickerTrack.style.transform='translateX('+offset+'px)';
  const covers=[...pickerTrack.children];
  let centerEl=null,minDist=Infinity,browsingIdx=pickerCenter;
  covers.forEach((el,i)=>{
    const elCenter=w/2+i*SLOT_W+COVER_W/2+offset;
    const dist=Math.abs(elCenter-w/2);
    if(dist<minDist){minDist=dist;centerEl=el;browsingIdx=i}
    const scale=Math.max(.4,1-dist/800);
    const op=Math.max(.2,1-dist/600);
    el.style.transform='scale('+scale+')';
    el.style.opacity=op;
  });
  // 标题歌手移到当前浏览的封面下，文字实时更新为该歌
  if(centerEl&&titleEl){
    const song=window.PLAYLIST[browsingIdx];
    if(song){
      titleEl.textContent=song.title;
      artistEl.textContent=song.artist;
      attachTitleArtist(centerEl);
    }
  }
}
function previewPickerColor(idx){
  const song=window.PLAYLIST[idx];
  if(!song||!window.__reloadCoverColors)return;
  const im=new Image();
  im.crossOrigin='anonymous';
  im.onload=()=>window.__reloadCoverColors(im.src);
  im.src=song.cover;
}
let lastPreview=-1;
function onPickerCenterChange(){
  if(pickerCenter!==lastPreview){lastPreview=pickerCenter;previewPickerColor(pickerCenter)}
}
function commitPickerSong(idx){if(idx!==currentSongIdx)switchSong(idx)}
let dragStartX=0,dragOffset=0,dragMoved=false,dragging=false;
function onDragStart(x){dragging=true;dragMoved=false;dragStartX=x;dragOffset=0;pickerTrack.classList.add('dragging')}
function onDragMove(x){
  if(!dragging)return;
  dragOffset=x-dragStartX;
  if(Math.abs(dragOffset)>5)dragMoved=true;
  updatePickerPosition(false);
  // 拖动中不改 pickerCenter，卡片全程跟手移动，松手才定吸附位置
}
function onDragEnd(){
  if(!dragging)return;dragging=false;
  const shift=Math.round(-dragOffset/SLOT_W);
  pickerCenter=Math.max(0,Math.min(window.PLAYLIST.length-1,pickerCenter+shift));
  dragOffset=0;
  updatePickerPosition(true);
  if(dragMoved){
    const blocker=e=>{e.stopPropagation();e.preventDefault();songPicker.removeEventListener('click',blocker,true)};
    songPicker.addEventListener('click',blocker,true);
  }
  setTimeout(()=>{dragMoved=false},100);
}
pickerTrack.addEventListener('mousedown',e=>{onDragStart(e.clientX);e.preventDefault()});
addEventListener('mousemove',e=>onDragMove(e.clientX));
addEventListener('mouseup',onDragEnd);
pickerTrack.addEventListener('touchstart',e=>{onDragStart(e.touches[0].clientX)},{passive:true});
pickerTrack.addEventListener('touchmove',e=>{onDragMove(e.touches[0].clientX);e.preventDefault()},{passive:false});
pickerTrack.addEventListener('touchend',onDragEnd);
function toggleQueue(force){
  const show=force!==undefined?force:!songPicker.classList.contains('show');
  songPicker.classList.toggle('show',show);
  document.querySelector('.app').classList.toggle('blurred',show);
  if(show){
    buildPicker();
    lastPreview=currentSongIdx;
  }else{
    if(titleEl&&titleParent){titleEl.className='title';const wave=titleParent.querySelector('.wave');if(wave)titleParent.insertBefore(titleEl,wave);else titleParent.appendChild(titleEl)}
    if(artistEl&&artistParent){artistEl.className='artist';const wave=titleParent.querySelector('.wave');if(wave)titleParent.insertBefore(artistEl,wave);else titleParent.appendChild(artistEl)}
  }
}
queueBtn.onclick=e=>{toggleQueue();e.stopPropagation()};
songPicker.addEventListener('click',e=>{
  if(!e.target.closest('.picker-cover')){commitPickerSong(pickerCenter);toggleQueue(false)}
});

function setLine(i){
  active=Math.max(0,Math.min(data.length-1,i));
  // 用实际 DOM 行高累加：当前行顶部之前所有行高度 + 当前行半高，让当前行中心精确对齐窗口中线
  const lines=[...list.children];
  let offset=0;
  for(let n=0;n<active;n++)offset+=lines[n].offsetHeight;
  offset+=lines[active].offsetHeight/2;
  targetOffset=offset;  // 物理动画的目标值，由 physicsTick 平滑逼近
  // 每行按距当前行的距离设弧度/景深/透明度，并用 --pos 区分上下：上方白、下方灰
  lines.forEach((el,n)=>{
    el.classList.toggle('active',n===active);
    el.classList.toggle('near',Math.abs(n-active)===1);
    const d=Math.abs(n-active);
    const above=n<active;                     // 在当前行之上 = 已唱过
    const curve=-Math.min(d*d*6,55);          // 向右凹弧：越远越靠左，上限55px避免超出左边界
    const blur=d===0?0:Math.min(4,d*1.2);   // 渐变景深：0/1.2/2.4/3.6px
    // 透明度：当前行最实，上方(已唱)较实，下方(未唱)更淡，半透明白叠背景区分上下且不发脏
    const op=n===active?1:above?Math.max(0.4,1-d*0.18):Math.max(0.15,0.55-d*0.13);
    const pos=above?1:0;                      // 上方=1(白) 下方=0(灰)
    el.style.setProperty('--curve',`${curve}px`);
    el.style.setProperty('--blur',`${blur}px`);
    el.style.setProperty('--op',`${op}`);
    el.style.setProperty('--pos',`${pos}`);
  });
}
// 惯性滚动：接近临界阻尼，刚柔适中 = 轻微过冲、平滑滑行
let curOffset=0,vel=0;
const STIFFNESS=0.09,DAMPING=0.86;
function physicsTick(){
  const diff=targetOffset-curOffset;
  const force=diff*STIFFNESS;
  vel=(vel+force)*DAMPING;
  // 阶段性 ease-out：前期弹簧加速，接近目标(<120px)时改用减速逼近，绝不越过目标 → 零回弹
  let step=vel;
  if(Math.abs(diff)<120){
    // 减速阶段：步长与剩余距离成正比，且不超目标
    step=diff*0.18;
  }else{
    // 加速阶段：限速防冲
    const MAXV=55;
    if(step>MAXV)step=MAXV;else if(step<-MAXV)step=-MAXV;
  }
  curOffset+=step;
  if(Math.abs(targetOffset-curOffset)<0.3){curOffset=targetOffset;vel=0}
  else if((diff>0&&curOffset>targetOffset)||(diff<0&&curOffset<targetOffset)){curOffset=targetOffset;vel=0}
  list.style.transform=`translateY(${-curOffset}px)`;
  requestAnimationFrame(physicsTick);
}

// 找 time 对应的当前行（按行首词时间）
function rowAt(time){let r=0;for(let i=0;i<data.length;i++){if(time>=data[i].t)r=i;else break}return r}

// 逐词高亮：清除旧的，标记当前行内 <=time 的词为 done，正在唱的为 active
let lastWordKey='';
function highlightWords(time){
  const li=active;
  const words=data[li].words;
  if(!words.length)return;
  const spans=wordEls[li];
  if(!spans.length)return;
  // 找当前正在唱的词：最后一个 start<=time
  let curIdx=-1;
  for(let i=0;i<words.length;i++){if(time>=words[i][1])curIdx=i;else break}
  // key 含"当前词是否已唱完"状态，确保最后词唱完时(active→done)能触发更新
  const curDone=curIdx>=0&&time>=words[curIdx][2];
  const key=li+':'+curIdx+':'+(curDone?1:0);
  if(key===lastWordKey)return; // 未变化则跳过 DOM 操作
  lastWordKey=key;
  for(let i=0;i<spans.length;i++){
    spans[i].classList.remove('active','done');
    if(i<curIdx)spans[i].classList.add('done');
    else if(i===curIdx){
      // 当前词：若 time 还在其时长内则 active，否则（已唱完本词但未到下句）也算 done
      if(time<words[i][2])spans[i].classList.add('active');
      else spans[i].classList.add('done');
    }
  }
}

function clearWordHighlight(li){
  const spans=wordEls[li];if(!spans)return;
  for(const s of spans)s.classList.remove('active','done');
}

function setButton(){play.innerHTML=running?pauseIcon:playIcon;player.classList.toggle('paused',!running)}
function fmt(t){if(!isFinite(t))return'0:00';return`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`}
// 每帧从真实音频读取时间，驱动进度条/时间文本/歌词行+逐词高亮
function tick(){const t=audio.currentTime,d=audio.duration;if(running&&isFinite(d)&&d>0){fill.style.width=`${Math.min(100,t/d*100)}%`;now.textContent=fmt(t);const newRow=rowAt(t);if(newRow!==active){clearWordHighlight(active);setLine(newRow);lastWordKey=''}highlightWords(t)}requestAnimationFrame(tick)}
play.onclick=async()=>{running=!running;if(running){try{await playStart();setButton()}catch(e){console.error('play failed',e);hint.textContent='播放失败：'+(e&&e.message||e);hint.classList.add('show');setTimeout(()=>hint.classList.remove('show'),2500);running=false;setButton()}}else{audio.pause();setButton()}};
async function playStart(){initAudio();if(audioCtx&&audioCtx.state==='suspended')await audioCtx.resume();await audio.play()}
document.getElementById('mute').onclick=()=>{audio.muted=!audio.muted;document.getElementById('mute').style.opacity=audio.muted?.35:.68};
document.getElementById('prev').onclick=()=>{audio.currentTime=Math.max(0,audio.currentTime-3)};document.getElementById('next').onclick=()=>{const d=audio.duration;audio.currentTime=Math.min(d||0,audio.currentTime+3)};
// 进度条拖拽
let scrubbing=false;
function seekToClientX(clientX){const d=audio.duration;if(!isFinite(d)||d<=0)return;const r=track.getBoundingClientRect();const ratio=Math.max(0,Math.min(1,(clientX-r.left)/r.width));audio.currentTime=ratio*d;fill.style.width=`${ratio*100}%`;now.textContent=fmt(audio.currentTime);const nr=rowAt(audio.currentTime);if(nr!==active){clearWordHighlight(active);setLine(nr)}lastWordKey='';highlightWords(audio.currentTime)}
track.addEventListener('mousedown',e=>{scrubbing=true;seekToClientX(e.clientX);e.preventDefault()});
addEventListener('mousemove',e=>{if(scrubbing)seekToClientX(e.clientX)});
addEventListener('mouseup',()=>{scrubbing=false});
track.addEventListener('touchstart',e=>{scrubbing=true;seekToClientX(e.touches[0].clientX)},{passive:true});
track.addEventListener('touchmove',e=>{if(scrubbing){seekToClientX(e.touches[0].clientX);e.preventDefault()}},{passive:false});
track.addEventListener('touchend',()=>{scrubbing=false});
// 总时长：loadedmetadata + durationchange 双保险，确保任意加载顺序下都显示
function updateTotal(){if(isFinite(audio.duration)&&audio.duration>0)total.textContent=fmt(audio.duration)}
audio.addEventListener('loadedmetadata',updateTotal);
audio.addEventListener('durationchange',updateTotal);
updateTotal();
audio.addEventListener('ended',()=>{running=false;audio.currentTime=0;fill.style.width='0%';now.textContent='0:00';clearWordHighlight(active);setLine(0);setButton()});

/* === 真实音波：Web Audio API AnalyserNode 驱动，低音在左高音在右 === */
const BAR_COUNT=68;
const bars=[];
for(let i=0;i<BAR_COUNT;i++){const s=document.createElement('span');wave.appendChild(s);bars.push(s.style)}
let audioCtx=null,analyser=null,freqData=null,spectrumOn=false,audioSourceNode=null;
function initAudio(){
  if(audioCtx)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const src=audioCtx.createMediaElementSource(audio);
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=256;
    analyser.smoothingTimeConstant=0.78;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData=new Uint8Array(analyser.frequencyBinCount);
    spectrumOn=true;
    audioSourceNode=src;
    console.log('[initAudio] AudioContext state='+audioCtx.state+', analyser ready');
    drawSpectrum();
  }catch(e){console.error('[initAudio] FAILED:',e)}
}
function drawSpectrum(){
  if(spectrumOn&&analyser&&freqData){
    analyser.getByteFrequencyData(freqData);
    // 只取有能量的低中频频段(前80个)，映射到全部柱子，避免右侧高频段常年无声留白
    const usable=80;
    const maxH=32;
    for(let i=0;i<BAR_COUNT;i++){
      const fi=Math.min(usable-1,Math.floor(i*(usable/BAR_COUNT)));
      const v=freqData[fi]/255;
      bars[i].setProperty('--h',`${3+v*maxH}px`);
    }
  }
  requestAnimationFrame(drawSpectrum);
}
for(let i=0;i<BAR_COUNT;i++)bars[i].setProperty('--h',`${6+Math.abs(Math.sin(i*.54)+Math.cos(i*.18))*8}px`);
drawSpectrum();
setButton();requestAnimationFrame(tick);requestAnimationFrame(physicsTick);
// 启动：加载歌单第一首歌
switchSong(0);
