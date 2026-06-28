// player.js v6 (word-by-word karaoke + 歌单切换)
console.log('[player.js] v6 loaded, crossOrigin=', document.getElementById('audio').crossOrigin, 'protocol=', location.protocol);

const list=document.getElementById('list'),audio=document.getElementById('audio'),play=document.getElementById('play'),player=document.getElementById('player'),fill=document.getElementById('fill'),buffer=document.getElementById('buffer'),now=document.getElementById('now'),track=document.getElementById('track'),hint=document.getElementById('hint'),total=document.getElementById('total'),wave=document.getElementById('wave'),queueBtn=document.getElementById('queue'),songPicker=document.getElementById('song-picker'),pickerTrack=document.getElementById('picker-track');
const bilibiliVideoBg=document.getElementById('bilibili-video-bg');
const playShapeLeft=document.getElementById('play-shape-left'),playShapeRight=document.getElementById('play-shape-right'),modeButton=document.getElementById('play-mode'),muteButton=document.getElementById('mute'),settingsButton=document.getElementById('settings'),eqOverlay=document.getElementById('eq-overlay'),eqPanel=document.getElementById('eq-panel'),eqReset=document.getElementById('eq-reset'),cacheCurrentButton=document.getElementById('cache-current-track'),cacheCurrentLabel=document.getElementById('cache-current-label'),cacheCurrentStatus=document.getElementById('cache-current-status');
const prevButton=document.getElementById('prev'),nextButton=document.getElementById('next'),eqSliders=[...document.querySelectorAll('[data-eq]')],eqPresetButtons=[...document.querySelectorAll('[data-eq-preset]')];
let active=0,running=false,targetOffset=0;
let data=[],wordEls=[];
let currentSongIdx=0;
let playRequestId=0;
let pendingAudioReady=Promise.resolve(true);

const ADDED_TRACKS_KEY='player_added_tracks';
const PLAY_MODE_KEY='player_play_mode';
const EQ_KEY='player_eq';
const GLOBAL_PROGRESS_KEY='player_progress';
const TRACK_PROGRESS_KEY='player_track_progress';
const NETEASE_STREAM_LEVELS=['standard','higher','exhigh'];
const EMPTY_COVER_SRC='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="rgba(255,255,255,.34)" offset="0"/><stop stop-color="rgba(255,255,255,.08)" offset="1"/></linearGradient></defs><rect width="360" height="360" rx="26" fill="url(#g)"/><circle cx="180" cy="180" r="66" fill="none" stroke="rgba(255,255,255,.58)" stroke-width="12"/><circle cx="180" cy="180" r="16" fill="rgba(255,255,255,.62)"/><path d="M224 118v96a28 28 0 1 1-12-23V143l-74 16v72a28 28 0 1 1-12-23v-86l98-22Z" fill="rgba(255,255,255,.72)"/></svg>');
const EQ_BANDS=[
  {id:'sub',type:'lowshelf',freq:64,q:0.7},
  {id:'bass',type:'peaking',freq:180,q:0.95},
  {id:'mid',type:'peaking',freq:850,q:1.0},
  {id:'presence',type:'peaking',freq:3200,q:1.05},
  {id:'air',type:'highshelf',freq:9800,q:0.72},
];
const EQ_PRESETS={
  flat:{label:'原声',values:{sub:0,bass:0,mid:0,presence:0,air:0}},
  warm:{label:'暖声',values:{sub:2,bass:3,mid:0,presence:-1,air:-2}},
  vocal:{label:'人声',values:{sub:-2,bass:-1,mid:2,presence:4,air:2}},
  bass:{label:'低频',values:{sub:5,bass:4,mid:-1,presence:0,air:1}},
  spark:{label:'通透',values:{sub:-1,bass:0,mid:-1,presence:3,air:5}},
};
const PLAY_MODES=[
  {id:'sequential',label:'顺序播放',icon:'<svg class="stroke-icon sequence-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h17m-3-3 3 3-3 3"/><circle cx="5" cy="12" r="1.45"/><circle cx="10.5" cy="12" r="1.45"/><circle cx="16" cy="12" r="1.45"/></svg>'},
  {id:'repeat-one',label:'单曲循环',icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-2-2 1.4-1.4L21 8l-4.6 4.4L15 11l2-2H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5Zm10 10H7l2 2-1.4 1.4L3 16l4.6-4.4L9 13l-2 2h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5Z"/><path d="M11 9h2v7h-2z"/></svg>'},
  {id:'repeat-all',label:'列表循环',icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-2.2-2.2L16.2 3 21 7.8l-4.8 4.8-1.4-1.8L17 9H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5Zm10 10H7l2.2 2.2L7.8 21 3 16.2l4.8-4.8 1.4 1.8L7 15h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5Z"/></svg>'},
  {id:'shuffle',label:'随机播放',icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5h-2V6.4l-3.8 3.8-1.4-1.4L17.6 5H16V3ZM3 6h4.5c2 0 3.5 1 4.7 2.6l4.5 6.1c.6.8 1.3 1.3 2.3 1.3V14h2v5h-5v-2h1.5c-1-.4-1.8-1-2.5-1.9L10.5 9C9.7 8 8.8 8 7.5 8H3V6Zm0 10h4.5c1.2 0 2.1-.5 2.9-1.5l1.2-1.6 1.3 1.8-1 1.3c-1.1 1.4-2.5 2-4.4 2H3v-2Z"/></svg>'},
  {id:'play-once',label:'单曲播放',icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14l10-7L6 5Z"/><path d="M18 5h2v14h-2z"/></svg>'},
];
let playMode=loadPlayMode();
let shuffleBag=[];
let eqState=loadEqState();
const PLAY_POINTS={left:[[8,5],[12,8],[12,16],[8,19]],right:[[12,8],[18,12],[18,12],[12,16]]};
const PAUSE_POINTS={left:[[7,5],[11,5],[11,19],[7,19]],right:[[13,5],[17,5],[17,19],[13,19]]};
let morphPoints={left:PLAY_POINTS.left.map(p=>p.slice()),right:PLAY_POINTS.right.map(p=>p.slice())};
let morphFrame=0;
function triggerIcon(button,className='icon-hit',duration=520){
  if(!button)return;
  button.classList.remove(className);
  void button.offsetWidth;
  button.classList.add(className);
  setTimeout(()=>button.classList.remove(className),duration);
}
function triggerSoundIcon(muted){
  if(!muteButton)return;
  muteButton.classList.remove('muting','unmuting');
  void muteButton.offsetWidth;
  const className=muted?'muting':'unmuting';
  muteButton.classList.add(className);
  setTimeout(()=>muteButton.classList.remove(className),560);
}
function providerOf(track){return track&&track.source==='bilibili'?'bilibili':(track&&track.source==='qq'?'qq':(track&&track.source==='netease'?'netease':'local'))}
function providerTrackId(track){return track&&track.source==='bilibili'?(track.bilibiliId||((track.bvid&&track.cid)?track.bvid+':'+track.cid:track.id)):(track&&track.source==='qq'?(track.qqId||track.songmid||track.id):(track&&(track.neteaseId||track.id)))}
function playlistKey(track){const p=providerOf(track);return p==='local'?'local:'+track.id:p+':'+providerTrackId(track)}
function providerStreamUrl(provider,id,level){let url='/api/stream/'+encodeURIComponent(id)+'?level='+encodeURIComponent(level||'standard');if(provider&&provider!=='netease')url+='&provider='+encodeURIComponent(provider);return url}
function providerCoverUrl(provider,id){let url='/api/cover/'+encodeURIComponent(id);if(provider&&provider!=='netease')url+='?provider='+encodeURIComponent(provider);return url}
function bilibiliLocalMediaUrl(mediaId,kind){return '/api/bilibili/media/'+encodeURIComponent(mediaId)+'/'+encodeURIComponent(kind)}
function cachedMediaUrl(mediaId,kind){return '/api/cache/media/'+encodeURIComponent(mediaId)+'/'+encodeURIComponent(kind||'audio')}
function cachedAudioUrl(mediaId){return cachedMediaUrl(mediaId,'audio')}
const BiliAssets=(function(){
  const DB='player_bilibili_assets',STORE='assets',VERSION=1;
  let dbPromise=null;
  function open(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB,VERSION);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'})};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB 打开失败'));
    });
    return dbPromise;
  }
  async function putBlob(key,blob,meta){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(Object.assign({key,blob,updatedAt:Date.now()},meta||{}));
      tx.oncomplete=()=>resolve(key);
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB 写入失败'));
    });
  }
  async function getRecord(key){
    if(!key)return null;
    const db=await open();
    return new Promise((resolve,reject)=>{
      const req=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||new Error('IndexedDB 读取失败'));
    });
  }
  async function getText(key){
    const record=await getRecord(key);
    if(!record||!record.blob)return'';
    return await record.blob.text();
  }
  async function getObjectUrl(key){
    const record=await getRecord(key);
    if(!record||!record.blob)return'';
    return URL.createObjectURL(record.blob);
  }
  async function remove(key){
    if(!key)return;
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB 删除失败'));
    });
  }
  async function enoughSpace(size){
    if(!navigator.storage||!navigator.storage.estimate)return true;
    const estimate=await navigator.storage.estimate();
    const quota=Number(estimate.quota||0),usage=Number(estimate.usage||0);
    return !quota||quota-usage>size+1024*1024;
  }
  return{putBlob,getText,getObjectUrl,remove,enoughSpace};
})();
window.BiliAssets=BiliAssets;
function normalizeAddedTrack(track){
  const provider=providerOf(track);
  if(!track||!(provider==='netease'||provider==='qq'||provider==='bilibili'))return null;
  const id=String(providerTrackId(track)||'').trim();
  if(!id)return null;
  const normalized={
    source:provider,
    id:id,
    title:String(track.title||track.name||'Untitled'),
    artist:String(track.artist||''),
    audio:track.cacheMediaId?cachedAudioUrl(track.cacheMediaId):(track.audio&&String(track.audio).startsWith('/api/cache/')?track.audio:providerStreamUrl(provider,id,'standard')),
    cover:(track.cacheMediaId&&track.cacheCover)?cachedMediaUrl(track.cacheMediaId,'cover'):(track.cover||providerCoverUrl(provider,id)),
    duration:Number(track.duration)||0,
    vip:track.vip||null,
    bvid:track.bvid||undefined,
    cid:track.cid||undefined,
    aid:track.aid||undefined,
    pageTitle:track.pageTitle||undefined,
    localMediaId:track.localMediaId||undefined,
    cacheMediaId:track.cacheMediaId||undefined,
    cachedAt:track.cachedAt||undefined,
    cacheCover:!!track.cacheCover,
    cacheLyrics:!!track.cacheLyrics,
    lyrics:track.lyrics||undefined,
    subtitleAssetKey:track.subtitleAssetKey||undefined,
    coverAssetKey:track.coverAssetKey||undefined,
    backgroundVideo:!!track.backgroundVideo,
    video:(provider==='bilibili'&&track.localMediaId&&track.backgroundVideo)?bilibiliLocalMediaUrl(track.localMediaId,'video'):(track.video||undefined),
    _key:provider+':'+id,
  };
  if(provider==='netease')normalized.neteaseId=id;
  if(provider==='qq'){normalized.qqId=id;normalized.songmid=track.songmid||id;normalized.qqSongId=track.qqSongId||undefined}
  if(provider==='bilibili')normalized.bilibiliId=id;
  return normalized;
}
function loadAddedTracks(){
  try{
    const raw=localStorage.getItem(ADDED_TRACKS_KEY);
    if(!raw)return;
    const saved=JSON.parse(raw);
    if(!Array.isArray(saved))return;
    saved.map(normalizeAddedTrack).filter(Boolean).forEach(track=>{
      if(!window.PLAYLIST.some(song=>playlistKey(song)===track._key))window.PLAYLIST.push(track);
    });
  }catch(e){try{localStorage.removeItem(ADDED_TRACKS_KEY)}catch(_){}}
}
function saveAddedTracks(){
  try{
    const added=window.PLAYLIST.map(normalizeAddedTrack).filter(Boolean);
    localStorage.setItem(ADDED_TRACKS_KEY,JSON.stringify(added));
  }catch(e){}
}
function isRemovableTrack(track){
  const key=String(track&&track._key||'');
  return !!(track&&(track.source==='netease'||track.source==='qq'||track.source==='bilibili'||key.startsWith('netease:')||key.startsWith('qq:')||key.startsWith('bilibili:')));
}
function isPlayInterruptedError(e){
  const message=String(e&&e.message||e||'');
  return e&&e.name==='AbortError'||message.includes('interrupted by a call to pause')||message.includes('interrupted by a new load request');
}
function loadPlayMode(){
  try{
    const saved=localStorage.getItem(PLAY_MODE_KEY);
    return PLAY_MODES.some(mode=>mode.id===saved)?saved:'repeat-all';
  }catch(e){return'repeat-all'}
}
function loadEqState(){
  const fallback=eqValuesFromPreset('flat');
  try{
    const saved=JSON.parse(localStorage.getItem(EQ_KEY)||'null');
    if(!saved||typeof saved!=='object')return fallback;
    if(Object.prototype.hasOwnProperty.call(saved,'low')||Object.prototype.hasOwnProperty.call(saved,'high')){
      saved.sub=saved.sub??saved.low;
      saved.bass=saved.bass??saved.low;
      saved.mid=saved.mid??0;
      saved.presence=saved.presence??saved.high;
      saved.air=saved.air??saved.high;
    }
    for(const band of EQ_BANDS){
      const value=Number(saved[band.id]);
      fallback[band.id]=Number.isFinite(value)?Math.max(-12,Math.min(12,value)):0;
    }
  }catch(e){}
  return fallback;
}
function eqValuesFromPreset(name){
  const preset=EQ_PRESETS[name]||EQ_PRESETS.flat;
  return Object.assign({},preset.values);
}
function matchingEqPreset(){
  for(const [name,preset] of Object.entries(EQ_PRESETS)){
    if(EQ_BANDS.every(band=>Number(eqState[band.id]||0)===Number(preset.values[band.id]||0)))return name;
  }
  return '';
}
function saveEqState(){
  try{localStorage.setItem(EQ_KEY,JSON.stringify(eqState))}catch(e){}
}
function updateEqUi(){
  for(const input of eqSliders){
    const id=input.dataset.eq;
    const value=Number(eqState[id]||0);
    input.value=String(value);
    const output=input.parentElement&&input.parentElement.querySelector('output');
    if(output)output.textContent=(value>0?'+':'')+value;
  }
  const activePreset=matchingEqPreset();
  for(const button of eqPresetButtons){
    button.classList.toggle('active',button.dataset.eqPreset===activePreset);
  }
}
function applyEqState(){
  if(!eqFilters)return;
  const at=audioCtx?audioCtx.currentTime:0;
  for(const band of EQ_BANDS){
    const filter=eqFilters[band.id];
    if(filter)filter.gain.setTargetAtTime(Number(eqState[band.id]||0),at,0.018);
  }
}
function setEqBand(id,value){
  if(!Object.prototype.hasOwnProperty.call(eqState,id))return;
  eqState[id]=Math.max(-12,Math.min(12,Number(value)||0));
  updateEqUi();
  applyEqState();
  saveEqState();
}
function setEqPreset(name){
  eqState=eqValuesFromPreset(name);
  updateEqUi();
  applyEqState();
  saveEqState();
}
function setEqOpen(open){
  if(!eqOverlay||!settingsButton)return;
  eqOverlay.classList.toggle('show',open);
  eqOverlay.setAttribute('aria-hidden',open?'false':'true');
  settingsButton.classList.toggle('open',open);
  settingsButton.setAttribute('aria-expanded',open?'true':'false');
  if(open)updateCacheControls();
}
function currentCacheTarget(){
  if(!hasTracks())return null;
  const index=Math.max(0,Math.min(currentSongIdx,window.PLAYLIST.length-1));
  return window.PLAYLIST[index]||null;
}
function updateCacheControls(){
  if(!cacheCurrentButton)return;
  const song=currentCacheTarget();
  const box=cacheCurrentButton.closest('.settings-cache');
  const cached=!!(song&&(song.cacheMediaId||(song.source==='bilibili'&&song.localMediaId)));
  const loading=!!(song&&song._caching);
  cacheCurrentButton.disabled=!song||providerOf(song)==='local'||loading||cached;
  if(box){
    box.classList.toggle('cached',cached);
    box.classList.toggle('loading',loading);
  }
  if(cacheCurrentLabel)cacheCurrentLabel.textContent=loading?'缓存中...':(cached?'已缓存':'缓存当前歌曲');
  if(cacheCurrentStatus){
    if(!song)cacheCurrentStatus.textContent='歌单为空，无法缓存';
    else if(providerOf(song)==='local')cacheCurrentStatus.textContent='本地歌曲无需额外缓存';
    else if(cached)cacheCurrentStatus.textContent='音频、歌词和封面已保存到本地，可离线播放';
    else cacheCurrentStatus.textContent='缓存会保存音频、歌词和封面，用于离线播放';
  }
}
function updateModeButton(showHint){
  const mode=PLAY_MODES.find(item=>item.id===playMode)||PLAY_MODES[0];
  modeButton.innerHTML=mode.icon;
  modeButton.title=mode.label;
  modeButton.setAttribute('aria-label',mode.label);
  modeButton.classList.toggle('active',playMode!=='sequential');
  if(showHint){
    hint.textContent='播放模式：'+mode.label;
    hint.classList.add('show');
    setTimeout(()=>hint.classList.remove('show'),1400);
  }
}
function cyclePlayMode(){
  const index=PLAY_MODES.findIndex(item=>item.id===playMode);
  playMode=PLAY_MODES[(index+1)%PLAY_MODES.length].id;
  shuffleBag=[];
  try{localStorage.setItem(PLAY_MODE_KEY,playMode)}catch(e){}
  updateModeButton(true);
}
function makeShuffleBag(){
  const bag=window.PLAYLIST.map((_,i)=>i).filter(i=>i!==currentSongIdx);
  for(let i=bag.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [bag[i],bag[j]]=[bag[j],bag[i]];
  }
  shuffleBag=bag;
}
function nextShuffleIndex(){
  if(window.PLAYLIST.length<2)return currentSongIdx;
  if(!shuffleBag.length)makeShuffleBag();
  return shuffleBag.shift();
}
function nextTrackIndex(){
  if(!window.PLAYLIST.length)return null;
  if(playMode==='shuffle')return nextShuffleIndex();
  if(currentSongIdx<window.PLAYLIST.length-1)return currentSongIdx+1;
  if(playMode==='repeat-all')return 0;
  return null;
}
function previousTrackIndex(){
  if(!window.PLAYLIST.length)return null;
  if(currentSongIdx>0)return currentSongIdx-1;
  if(playMode==='repeat-all')return window.PLAYLIST.length-1;
  return null;
}
function pointsPath(points){
  return`M${points[0][0]} ${points[0][1]} L${points[1][0]} ${points[1][1]} L${points[2][0]} ${points[2][1]} L${points[3][0]} ${points[3][1]} Z`;
}
function morphPlayIcon(toPause,immediate){
  const target=toPause?PAUSE_POINTS:PLAY_POINTS;
  cancelAnimationFrame(morphFrame);
  if(immediate){
    morphPoints={left:target.left.map(p=>p.slice()),right:target.right.map(p=>p.slice())};
    playShapeLeft.setAttribute('d',pointsPath(morphPoints.left));
    playShapeRight.setAttribute('d',pointsPath(morphPoints.right));
    return;
  }
  const from={left:morphPoints.left.map(p=>p.slice()),right:morphPoints.right.map(p=>p.slice())};
  const started=performance.now(),duration=240;
  const frame=now=>{
    const raw=Math.min(1,(now-started)/duration);
    const t=raw<.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2;
    for(const side of['left','right']){
      morphPoints[side]=from[side].map((point,i)=>[
        point[0]+(target[side][i][0]-point[0])*t,
        point[1]+(target[side][i][1]-point[1])*t,
      ]);
    }
    playShapeLeft.setAttribute('d',pointsPath(morphPoints.left));
    playShapeRight.setAttribute('d',pointsPath(morphPoints.right));
    if(raw<1)morphFrame=requestAnimationFrame(frame);
  };
  morphFrame=requestAnimationFrame(frame);
}

// 用歌词数据重建歌词 DOM + wordEls 缓存（切歌时调用）
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function lyricWordSeparator(previous,current){
  previous=String(previous||'');
  current=String(current||'');
  if(!previous||!current||/\s$/.test(previous)||/^\s/.test(current))return'';
  const left=previous.slice(-1),right=current.slice(0,1);
  const cjk=/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
  if(cjk.test(left)&&cjk.test(right))return'';
  if(/[，。！？、；：,.!?;:）)\]】》」』]/.test(right))return'';
  if(/[（(\[【《「『]/.test(left))return'';
  return' ';
}
function renderLyricWords(words){
  return words.map((word,index)=>{
    const separator=index?lyricWordSeparator(words[index-1][0],word[0]):'';
    return separator+`<span class="word" data-w="${index}">${esc(word[0])}</span>`;
  }).join('');
}
function buildLyrics(rawData){
  list.innerHTML='';
  data=rawData.map(it=>({en:it.en,cn:it.cn,words:it.words||[],t:it.words&&it.words.length?it.words[0][1]:0}));
  data.forEach((x,i)=>{
    const d=document.createElement('div');d.className='line';if(i===1)d.classList.add('more');
    let enHTML;
    if(x.words.length){
      enHTML='<div class="en">'+renderLyricWords(x.words)+'</div>';
    }else{
      enHTML=`<div class="en">${esc(x.en)}</div>`;
    }
    d.innerHTML=enHTML+(x.cn?`<div class="cn">${esc(x.cn)}</div>`:'');
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
  if(window[varName])return Promise.resolve(window[varName]);
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='js/lyrics-timed-'+songId+'.js';
    s.onload=()=>{ if(window[varName])resolve(window[varName]); else { s.remove(); reject(new Error('歌词文件无数据: '+songId)); } };
    s.onerror=()=>{ s.remove(); reject(new Error('歌词加载失败: '+songId)); };
    document.body.appendChild(s);
  });
}

/* ============================================================
 * Player 数据层 + LyricsStore —— 必须在 switchSong 之前声明
 * （switchSong 内部调用 LyricsStore.load，const 有暂时性死区）
 * ============================================================ */
// 歌词缓存 key 按 source 区分，避免本地/在线源同 ID 互相污染
function _lyricsKey(song){const p=providerOf(song);return p==='local'?'local:'+(song.id||song.neteaseId):p+':'+providerTrackId(song)}
function looksLikeEmptyLyrics(lines){
  return !Array.isArray(lines)||!lines.length||(lines.length===1&&lines[0]&&lines[0].en==='暂无歌词'&&!lines[0].cn&&!(lines[0].words&&lines[0].words.length));
}
function shouldRetryLyrics(song){
  const provider=providerOf(song);
  return provider==='netease'||provider==='qq'||provider==='bilibili'||!!(song&&song.localMediaId);
}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function hasTranslatedLyrics(lines){
  return Array.isArray(lines)&&lines.some(line=>String(line&&line.cn||'').trim());
}
function lyricWordTotal(lines){
  return Array.isArray(lines)?lines.reduce((sum,line)=>sum+(Array.isArray(line&&line.words)?line.words.length:0),0):0;
}
function shouldUpgradeQqLyrics(song,lines){
  return providerOf(song)==='qq'&&Array.isArray(lines)&&lines.length&&!looksLikeEmptyLyrics(lines)&&!hasTranslatedLyrics(lines);
}
async function refreshQqLyricsIfUpgraded(song,generation,previous){
  if(!shouldUpgradeQqLyrics(song,previous))return;
  await wait(2600);
  if(generation!==switchGeneration)return;
  const key=_lyricsKey(song);
  if(window.LyricsStore&&window.LyricsStore._cache)delete window.LyricsStore._cache[key];
  const upgraded=await LyricsStore.load(song);
  if(generation!==switchGeneration||!Array.isArray(upgraded)||looksLikeEmptyLyrics(upgraded))return;
  const hasBetterTranslation=hasTranslatedLyrics(upgraded)&&!hasTranslatedLyrics(previous);
  const hasBetterWords=lyricWordTotal(upgraded)>lyricWordTotal(previous)+2;
  if(hasBetterTranslation||hasBetterWords)buildLyrics(upgraded);
}

const LyricsStore = {
  _cache: {},
  async load(song) {
    const key = _lyricsKey(song);
    const provider = providerOf(song);
    const id = providerTrackId(song);
    if (!id) return null;
    const cached = this._cache[key];
    if (cached && cached.state === 'loaded') {
      if (looksLikeEmptyLyrics(cached.data) && shouldRetryLyrics(song) && Date.now() - (cached.at || 0) > 5000) {
        delete this._cache[key];
      } else {
        return cached.data;
      }
    }
    if (cached && cached.state === 'loading') return cached.promise;
    this._cache[key] = { state: 'loading' };
    const promise = (async () => {
      try {
        if (song.cacheMediaId) {
          try {
            const result = await fetch(cachedMediaUrl(song.cacheMediaId,'lyrics'), { credentials: 'same-origin' }).then(resp => resp.json());
            const parsed = result && result.ok ? result.data : result;
            const legacy = this._toLegacy(parsed);
            this._cache[key] = { state: 'loaded', data: legacy, at: Date.now() };
            return legacy;
          } catch (cacheError) {
            console.warn('[LyricsStore] 缓存歌词读取失败，回退在线歌词', cacheError);
          }
        }
        if (provider === 'bilibili' && song.localMediaId) {
          const result = await fetch(bilibiliLocalMediaUrl(song.localMediaId,'lyrics'), { credentials: 'same-origin' }).then(resp => resp.json());
          const parsed = result && result.ok ? result.data : result;
          const legacy = this._toLegacy(parsed);
          this._cache[key] = { state: 'loaded', data: legacy, at: Date.now() };
          return legacy;
        }
        if (provider === 'bilibili' && song.subtitleAssetKey && window.BiliAssets) {
          const text = await window.BiliAssets.getText(song.subtitleAssetKey);
          const legacy = parseUploadedLyricsText(text);
          this._cache[key] = { state: 'loaded', data: legacy, at: Date.now() };
          return legacy;
        }
        if (provider === 'netease' || provider === 'qq' || provider === 'bilibili') {
          const result = await NetEase.lyrics(id, song.duration, provider, { qqSongId: song.qqSongId });
          const legacy = this._toLegacy(result);
          this._cache[key] = { state: 'loaded', data: legacy, at: Date.now() };
          return legacy;
        }
        const data = await loadLyricsFile(id);
        this._cache[key] = { state: 'loaded', data: data, at: Date.now() };
        return data;
      } catch (e) {
        console.error('[LyricsStore] 加载歌词失败', id, e);
        this._cache[key] = { state: 'failed' };
        return null;
      }
    })();
    this._cache[key].promise = promise;
    return promise;
  },
  _toLegacy(parsed) {
    if (!parsed || !parsed.lines || !parsed.lines.length) {
      return [{ en: '暂无歌词', cn: '', words: [] }];
    }
    return parsed.lines.map(line => ({
      en: line.text,
      cn: line.translation || '',
      words: (line.words || []).map(w => [w.text, w.start, w.end]),
    }));
  },
};
function parseUploadedLyricsText(text){
  text=String(text||'').replace(/\r/g,'').trim();
  if(!text)return[{en:'暂无歌词',cn:'',words:[]}];
  try{
    const parsed=JSON.parse(text);
    if(Array.isArray(parsed))return parsed.map(item=>({en:item.en||item.text||'',cn:item.cn||item.translation||'',words:item.words||timeWords(item.text||item.en||'',Number(item.start||0),Number(item.end||Number(item.start||0)+2))}));
    if(parsed&&Array.isArray(parsed.lines))return LyricsStore._toLegacy(parsed);
  }catch(e){}
  if(/^\s*WEBVTT/i.test(text)||/-->/.test(text))return parseCueLyrics(text);
  if(/\[[0-9]{1,2}:[0-9]{2}/.test(text))return parseLrcLyrics(text);
  const plainLines=text.split('\n').map((line,i)=>{
    const start=i*3,end=start+3,clean=line.trim();
    return{en:clean,cn:'',words:timeWords(clean,start,end)};
  }).filter(line=>line.en);
  return plainLines.length?plainLines:[{en:'暂无歌词',cn:'',words:[]}];
}
function parseCueLyrics(text){
  const blocks=text.replace(/^\s*WEBVTT[^\n]*\n/i,'').split(/\n\s*\n/);
  const lines=[];
  for(const block of blocks){
    const rows=block.split('\n').map(s=>s.trim()).filter(Boolean);
    const timeRow=rows.findIndex(row=>row.includes('-->'));
    if(timeRow<0)continue;
    const parts=rows[timeRow].split('-->');
    const start=parseTimestamp(parts[0]),end=parseTimestamp((parts[1]||'').split(/\s+/)[0]);
    const body=rows.slice(timeRow+1).join(' ').trim();
    if(body&&isFinite(start)&&isFinite(end))lines.push({en:body,cn:'',words:timeWords(body,start,end)});
  }
  return lines.length?lines:[{en:'暂无歌词',cn:'',words:[]}];
}
function parseLrcLyrics(text){
  const lines=[];
  text.split('\n').forEach(row=>{
    const match=row.match(/\[([0-9]{1,2}:[0-9]{2}(?:\.[0-9]{1,3})?)\](.*)/);
    if(!match)return;
    const start=parseTimestamp(match[1]),body=match[2].trim();
    if(body&&isFinite(start))lines.push({start,en:body,cn:'',words:[]});
  });
  lines.sort((a,b)=>a.start-b.start);
  for(let i=0;i<lines.length;i++){
    const end=lines[i+1]?lines[i+1].start:lines[i].start+3;
    lines[i].words=timeWords(lines[i].en,lines[i].start,end);
    delete lines[i].start;
  }
  return lines.length?lines:[{en:'暂无歌词',cn:'',words:[]}];
}
function parseTimestamp(raw){
  raw=String(raw||'').trim().replace(',','.');
  const parts=raw.split(':').map(Number);
  if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];
  if(parts.length===2)return parts[0]*60+parts[1];
  return Number(raw);
}
function timeWords(text,start,end){
  text=String(text||'');
  const chars=[...text].filter(ch=>ch.trim());
  if(!chars.length)return[];
  const span=Math.max(.05,(end-start)/chars.length);
  return chars.map((ch,i)=>[ch,start+i*span,Math.min(end,start+(i+1)*span)]);
}

function hasTracks(){
  return Array.isArray(window.PLAYLIST)&&window.PLAYLIST.length>0;
}
function showEmptyHint(){
  hint.textContent='歌单为空，请先从搜索添加歌曲';
  hint.classList.add('show');
  setTimeout(()=>hint.classList.remove('show'),1800);
}
function updateEmptyControls(empty){
  for(const button of [play,prevButton,nextButton,queueBtn]){
    if(button)button.disabled=!!empty;
  }
}
function setEmptyState(empty){
  const isEmpty=!!empty;
  const app=document.querySelector('.app');
  if(app)app.classList.toggle('empty',isEmpty);
  updateEmptyControls(isEmpty);
  updateCacheControls();
  if(!isEmpty){
    if(play)play.disabled=false;
    setButton();
    return;
  }
  suppressProgressSave=true;
  playRequestId++;
  running=false;
  currentSongIdx=-1;
  pendingAudioReady=Promise.resolve(false);
  try{audio.pause();audio.removeAttribute('src');audio.load()}catch(e){}
  if(bilibiliVideoBg){
    bilibiliVideoBg.pause();
    bilibiliVideoBg.removeAttribute('src');
    bilibiliVideoBg.classList.remove('show');
  }
  const coverImg=document.querySelector('img.cover');
  if(coverImg){coverImg.src=EMPTY_COVER_SRC;coverImg.alt='歌单为空'}
  if(window.__reloadCoverColors)window.__reloadCoverColors();
  const tEl=titleEl||document.querySelector('.title');
  const aEl=artistEl||document.querySelector('.artist');
  if(tEl)tEl.textContent='歌单为空';
  if(aEl)aEl.textContent='从搜索添加歌曲';
  total.textContent='--:--';
  setPlaybackPositionUi(0,0);
  buildLyrics([{en:'歌单为空',cn:'从搜索添加歌曲',words:[]}]);
  if(pickerTrack)pickerTrack.innerHTML='';
  if(songPicker)songPicker.classList.remove('show');
  setButton();
  suppressProgressSave=false;
}

const Player = {
  notifyPlaylistChanged() {
    shuffleBag=[];
    window.dispatchEvent(new CustomEvent('player:playlist-changed'));
  },
  addTrack(track) {
    const key = playlistKey(track);
    const exist = this.findIndexByKey(key);
    if (exist >= 0) return { index: exist, added: false };
    const wasEmpty=!hasTracks();
    const entry = Object.assign({}, track, { _key: key });
    if (track.neteaseId && !entry.id) entry.id = track.neteaseId;
    if (track.qqId && !entry.id) entry.id = track.qqId;
    window.PLAYLIST.push(entry);
    saveAddedTracks();
    if(wasEmpty){
      setEmptyState(false);
      currentSongIdx=-1;
      switchSong(window.PLAYLIST.length-1);
    }
    this.rebuildPicker();
    this.notifyPlaylistChanged();
    return { index: window.PLAYLIST.length - 1, added: true };
  },
  async removeTrack(index) {
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= window.PLAYLIST.length) return false;
    const removed = window.PLAYLIST[index];
    if (!isRemovableTrack(removed)) return false;
    const removedKey = removed._key || playlistKey(removed);
    const removingCurrent = index === currentSongIdx;
    const pickerVisible = !!(songPicker && songPicker.classList.contains('show'));
    const oldPickerCenter = pickerCenter;
    window.PLAYLIST.splice(index, 1);
    if (removedKey && window.LyricsStore && window.LyricsStore._cache) {
      delete window.LyricsStore._cache[removedKey];
    }
    removeTrackProgress(removed);
    if (removed && removed.source === 'bilibili' && window.BiliAssets) {
      window.BiliAssets.remove(removed.subtitleAssetKey).catch(()=>{});
      window.BiliAssets.remove(removed.coverAssetKey).catch(()=>{});
    }
    if (removed && removed.cacheMediaId && window.NetEase && typeof window.NetEase.deleteCachedMedia === 'function') {
      window.NetEase.deleteCachedMedia(removed.cacheMediaId).catch(()=>{});
    }
    if (index < currentSongIdx) currentSongIdx -= 1;
    saveAddedTracks();
    if (window.PLAYLIST.length) {
      const nextIndex = Math.min(index, window.PLAYLIST.length - 1);
      let nextPickerCenter = oldPickerCenter;
      if (index < oldPickerCenter) nextPickerCenter -= 1;
      else if (index === oldPickerCenter) nextPickerCenter = nextIndex;
      nextPickerCenter = Math.max(0, Math.min(nextPickerCenter, window.PLAYLIST.length - 1));
      if (pickerVisible) {
        pickerCenter = nextPickerCenter;
        animatePickerRemoval(index, pickerCenter);
      }
      if (removingCurrent) {
        currentSongIdx = -1;
        switchSong(nextIndex);
      }
      saveProgress();
    } else {
      try{localStorage.removeItem(GLOBAL_PROGRESS_KEY)}catch(e){}
      setEmptyState(true);
    }
    this.notifyPlaylistChanged();
    return true;
  },
  hasTrack(key) { return this.findIndexByKey(key) >= 0; },
  findIndexByKey(key) { return window.PLAYLIST.findIndex(s => playlistKey(s) === key); },
  async cacheTrack(index) {
    if(index==null)index=currentSongIdx;
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= window.PLAYLIST.length) return false;
    const song = window.PLAYLIST[index];
    if (!song || providerOf(song) === 'local') return false;
    if (song.cacheMediaId || (song.source === 'bilibili' && song.localMediaId)) {
      hint.textContent='已缓存，可离线播放';
      hint.classList.add('show');
      setTimeout(()=>hint.classList.remove('show'),1600);
      return true;
    }
    if (song._caching) return false;
    song._caching = true;
    updateCacheControls();
    try {
      const provider = providerOf(song);
      const id = providerTrackId(song);
      const result = await NetEase.cacheTrack({
        provider,
        id,
        level: getTrackStreamLevel(song) || 'standard',
        title: song.title || '',
        artist: song.artist || '',
        duration: song.duration || 0,
        qqSongId: song.qqSongId || '',
        cover: song.cover || '',
      });
      song.cacheMediaId = result.mediaId;
      song.cachedAt = Date.now();
      song.cacheCover = !!result.cover;
      song.cacheLyrics = !!result.lyrics;
      song.audio = result.audio || cachedAudioUrl(result.mediaId);
      if (result.cover) song.cover = result.cover;
      if (window.LyricsStore && window.LyricsStore._cache) delete window.LyricsStore._cache[_lyricsKey(song)];
      delete song._caching;
      saveAddedTracks();
      updateCacheControls();
      if (index === currentSongIdx) {
        const coverImg=document.querySelector('img.cover');
        if(coverImg && result.cover)coverImg.src=result.cover;
      }
      hint.textContent='缓存完成，可离线播放';
      hint.classList.add('show');
      setTimeout(()=>hint.classList.remove('show'),1800);
      return true;
    } catch (e) {
      delete song._caching;
      updateCacheControls();
      hint.textContent='缓存失败：'+((e&&e.message)||e||'未知错误');
      hint.classList.add('show');
      setTimeout(()=>hint.classList.remove('show'),2600);
      return false;
    }
  },
  // 仅当 picker 打开时才重建（避免 addTrack 把主标题 DOM 移进隐藏 picker）
  rebuildPicker(options) {
    if (typeof songPicker !== 'undefined' && songPicker && songPicker.classList.contains('show')) {
      if (typeof buildPicker === 'function') buildPicker(options);
    }
  },
  playTrack(index) { if (typeof switchSong === 'function') switchSong(index); },
};
window.Player = Player;
window.LyricsStore = LyricsStore;
loadAddedTracks();

function progressKeyForSong(song){
  if(!song)return'';
  try{return playlistKey(song)||''}catch(e){return song._key||''}
}
function loadTrackProgressMap(){
  try{
    const raw=localStorage.getItem(TRACK_PROGRESS_KEY);
    if(!raw)return{};
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch(e){
    try{localStorage.removeItem(TRACK_PROGRESS_KEY)}catch(_){}
    return{};
  }
}
function saveTrackProgress(song,time){
  const key=progressKeyForSong(song);
  if(!key)return;
  const t=Number(time);
  const map=loadTrackProgressMap();
  if(!isFinite(t)||t<1){
    delete map[key];
  }else{
    map[key]=Math.round(t*10)/10;
  }
  const keys=Object.keys(map);
  if(keys.length>300){
    keys.slice(0,keys.length-300).forEach(k=>delete map[k]);
  }
  try{localStorage.setItem(TRACK_PROGRESS_KEY,JSON.stringify(map))}catch(e){}
}
function removeTrackProgress(song){
  const key=progressKeyForSong(song);
  if(!key)return;
  const map=loadTrackProgressMap();
  if(Object.prototype.hasOwnProperty.call(map,key)){
    delete map[key];
    try{localStorage.setItem(TRACK_PROGRESS_KEY,JSON.stringify(map))}catch(e){}
  }
}
function savedTimeForSong(song){
  const key=progressKeyForSong(song);
  if(!key)return 0;
  const t=Number(loadTrackProgressMap()[key]);
  if(!isFinite(t)||t<=0)return 0;
  const d=Number(song&&song.duration);
  if(isFinite(d)&&d>0&&t>=d-5)return 0;
  return t;
}

// 切歌 generation：防止快速切歌时旧歌词覆盖新歌词
let switchGeneration = 0;
let suppressProgressSave = false;

function saveProgressForSong(index,song,time){
  if(!song)return;
  const t=Number(time);
  const safeTime=isFinite(t)?t:0;
  saveTrackProgress(song,safeTime);
  try{localStorage.setItem(GLOBAL_PROGRESS_KEY,JSON.stringify({song:index,key:progressKeyForSong(song),time:safeTime}))}catch(e){}
}

function setPlaybackPositionUi(time,duration){
  const t=Number(time)||0;
  const d=Number(duration);
  now.textContent=fmt(t);
  if(isFinite(d)&&d>0)fill.style.width=`${Math.min(100,Math.max(0,t)/d*100)}%`;
  else fill.style.width='0%';
  if(buffer)buffer.style.width='0%';
}

function prewarmOnlineAudio(song){
  if(!song||!isRemovableTrack(song))return;
  const provider=providerOf(song);
  const id=providerTrackId(song);
  const token=document.querySelector('meta[name="api-token"]')?.content;
  if(!id||!token)return;
  let url='/api/song-url/'+encodeURIComponent(id)+'?level='+encodeURIComponent(getTrackStreamLevel(song));
  if(provider!=='netease')url+='&provider='+encodeURIComponent(provider);
  fetch(url,{
    headers:{'X-Player-Token':token},
    credentials:'same-origin',
  }).catch(()=>{});
}

function prewarmLyrics(song){
  if(!song||!window.LyricsStore)return;
  const provider=providerOf(song);
  if(provider!=='netease'&&provider!=='qq'&&provider!=='bilibili')return;
  window.LyricsStore.load(song).catch(()=>{});
}

async function ensureOnlineAudioReady(song){
  if(!song||!isRemovableTrack(song))return true;
  const provider=providerOf(song);
  const id=providerTrackId(song);
  try{
    const info=await NetEase.songUrl(id,getTrackStreamLevel(song),provider,true);
    return !!(info&&info.playable);
  }catch(e){
    console.warn('[player] 切歌预加载失败',id,e);
    return false;
  }
}

async function loadLyricsForSong(song,generation){
  try{
    let raw=await LyricsStore.load(song);
    if(providerOf(song)==='local'&&!raw)raw=await loadLyricsFile(song.id);
    if(generation!==switchGeneration)return;
    if((!raw||looksLikeEmptyLyrics(raw))&&shouldRetryLyrics(song)){
      const key=_lyricsKey(song);
      if(window.LyricsStore&&window.LyricsStore._cache)delete window.LyricsStore._cache[key];
      await wait(900);
      if(generation!==switchGeneration)return;
      raw=await LyricsStore.load(song);
    }
    if(generation!==switchGeneration)return;
    if(!raw)raw=[{en:'暂无歌词',cn:'',words:[]}];
    buildLyrics(raw);
    refreshQqLyricsIfUpgraded(song,generation,raw).catch(e=>console.warn('[player] QQ lyric upgrade failed',e));
    console.log('[player] 切歌:',song.title,'歌词',raw.length,'行');
  }catch(e){
    if(generation!==switchGeneration)return;
    buildLyrics([{en:'歌词加载失败',cn:'',words:[]}]);
    console.error(e);
  }
}
async function displayCoverForSong(song){
  if(song&&song.localMediaId)return bilibiliLocalMediaUrl(song.localMediaId,'cover');
  if(song&&song.coverAssetKey&&window.BiliAssets){
    try{
      const objectUrl=await window.BiliAssets.getObjectUrl(song.coverAssetKey);
      if(objectUrl)return objectUrl;
    }catch(e){console.warn('[player] B站封面读取失败',e)}
  }
  return song&&song.cover||'';
}
function setBilibiliVideoBackground(song){
  if(!bilibiliVideoBg)return;
  const provider=providerOf(song);
  const id=providerTrackId(song);
  if(provider!=='bilibili'||!song.backgroundVideo||!id){
    bilibiliVideoBg.pause();
    bilibiliVideoBg.removeAttribute('src');
    bilibiliVideoBg.classList.remove('show');
    try{bilibiliVideoBg.load()}catch(e){}
    return;
  }
  const nextSrc=song.localMediaId?bilibiliLocalMediaUrl(song.localMediaId,'video'):NetEase.bilibiliVideoUrl(id);
  if(bilibiliVideoBg.getAttribute('src')!==nextSrc)bilibiliVideoBg.src=nextSrc;
  bilibiliVideoBg.classList.add('show');
  if(isFinite(audio.currentTime)&&bilibiliVideoBg.readyState>=1){
    try{bilibiliVideoBg.currentTime=audio.currentTime}catch(e){}
  }
  if(running)bilibiliVideoBg.play().catch(()=>{});
}

// 切换到某首歌
async function switchSong(idx,seekTime){
  if(idx===currentSongIdx&&data.length)return true;
  const song=window.PLAYLIST[idx];
  if(!song){setEmptyState(true);return false}
  setEmptyState(false);
  if(seekTime==null)seekTime=savedTimeForSong(song);
  seekTime=Number(seekTime)||0;
  const generation=++switchGeneration; // 快速切歌保护
  // 停止当前播放
  const previousIdx=currentSongIdx;
  const previousSong=window.PLAYLIST[previousIdx];
  if(previousSong)saveProgressForSong(previousIdx,previousSong,audio.currentTime||0);
  suppressProgressSave=true;
  playRequestId++;
  audio.pause();running=false;setButton();
  try{audio.removeAttribute('src');audio.load()}catch(e){}
  currentSongIdx=idx;
  updateCacheControls();
  if(isRemovableTrack(song)) song._failedLevels=[];
  prewarmOnlineAudio(window.PLAYLIST[idx+1]);
  prewarmOnlineAudio(window.PLAYLIST[idx-1]);
  prewarmLyrics(window.PLAYLIST[idx+1]);
  prewarmLyrics(window.PLAYLIST[idx-1]);
  total.textContent='--:--';
  setPlaybackPositionUi(seekTime, song.duration);
  const tEl=titleEl||document.querySelector('.title');if(tEl)tEl.textContent=song.title;
  const aEl=artistEl||document.querySelector('.artist');if(aEl)aEl.textContent=song.artist;
  const coverImg=document.querySelector('img.cover');
  const coverSrc=await displayCoverForSong(song);
  if(generation!==switchGeneration)return false;
  if(coverImg&&coverSrc){coverImg.src=coverSrc;coverImg.alt=song.title+' cover'}
  setBilibiliVideoBackground(song);
  // 触发背景重新取色（等封面图加载后）
  if(window.__reloadCoverColors){const ci=coverImg;const reload=()=>window.__reloadCoverColors();if(ci.complete)reload();else ci.addEventListener('load',reload,{once:true})}
  setPlaybackPositionUi(seekTime, song.duration);
  if(providerOf(song)==='netease' || providerOf(song)==='qq' || providerOf(song)==='bilibili'){
    buildLyrics([{en:'歌词加载中...',cn:'',words:[]}]);
  }
  loadLyricsForSong(song,generation);
  // 若选择器开着，更新居中位置
  if(songPicker.classList.contains('show')){pickerCenter=currentSongIdx;updatePickerPosition(true)}
  const readyPromise=(async()=>{
    await ensureOnlineAudioReady(song);
    if(generation!==switchGeneration)return false;
    audio.src=song.audio;
    try{audio.load()}catch(e){}
    setTimeout(()=>{if(generation===switchGeneration)suppressProgressSave=false},120);
    if(seekTime>0){const _s=()=>{if(generation!==switchGeneration)return;audio.currentTime=seekTime;const nr=rowAt(seekTime);if(nr>=0){setLine(nr);highlightWords(seekTime)}const _d=audio.duration;if(isFinite(_d)&&_d>0){fill.style.width=Math.min(100,seekTime/_d*100)+"%";now.textContent=fmt(seekTime)}};if(audio.readyState>=1){_s()}else{audio.addEventListener("loadedmetadata",()=>{if(generation===switchGeneration)_s()},{once:true})}}
    return true;
  })();
  pendingAudioReady=readyPromise;
  return await readyPromise;
}

// 歌单 UI
// 轮播式歌曲选择器
// 拖动只切背景颜色(lerp平滑)，松手吸附后才完整切歌(音频/歌词/标题)
// 轮播封面图固定不变；标题/歌手从原 .player 移到居中封面下方(DOM移动)
let pickerCenter=0;
const COVER_W=300,SLOT_W=COVER_W+60;
let titleEl=null,artistEl=null,titleParent=null,artistParent=null;
function buildPicker(options){
  const requestedCenter = options && Number.isFinite(options.center) ? options.center : null;
  // 先把标题歌手移回原位（避免被 innerHTML='' 删除）
  if(!titleEl){
    titleEl=document.querySelector('.title');
    artistEl=document.querySelector('.artist');
    titleParent=titleEl&&titleEl.parentNode;
    artistParent=artistEl&&artistEl.parentNode;
  }
  pickerTrack.innerHTML='';
  if(!hasTracks())return;
  window.PLAYLIST.forEach((song,i)=>{
    const div=document.createElement('div');
    div.className='picker-cover';
    div.dataset.idx=i;
    const img=document.createElement('img');
    img.src=song.cover;img.alt=song.title;
    div.appendChild(img);
    if(false&&providerOf(song)!=='local'){
      const cache=document.createElement('button');
      const cached=!!(song.cacheMediaId||(song.source==='bilibili'&&song.localMediaId));
      cache.type='button';
      cache.className='picker-cache'+(cached?' cached':'')+(song._caching?' loading':'');
      cache.setAttribute('aria-label',cached?'已缓存':'缓存歌曲');
      cache.title=song._caching?'缓存中':(cached?'已缓存，可离线播放':'缓存歌曲');
      cache.innerHTML=song._caching?'<span class="cache-dots"><i></i><i></i><i></i></span>':(cached?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 16.8 4.9 13l1.4-1.4 2.4 2.4 9-9 1.4 1.4L8.7 16.8Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v9.2l3.4-3.4 1.4 1.4L12 16l-4.8-4.8 1.4-1.4 3.4 3.4V4h2ZM5 18h14v2H5v-2Z"/></svg>');
      cache.addEventListener('mousedown',e=>e.stopPropagation());
      cache.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
      cache.onclick=async e=>{e.preventDefault();e.stopPropagation();await Player.cacheTrack(Number(div.dataset.idx))};
      div.appendChild(cache);
    }
    if(isRemovableTrack(song)){
      const del=document.createElement('button');
      del.type='button';
      del.className='picker-delete';
      del.setAttribute('aria-label','删除歌曲');
      del.title='删除歌曲';
      del.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5.2 6.2 10.9 12l-5.7 5.8L6.4 19l5.8-5.7 5.8 5.7 1.2-1.2-5.7-5.8 5.7-5.8L18 5l-5.8 5.7L6.4 5Z"/></svg>';
      del.addEventListener('mousedown',e=>e.stopPropagation());
      del.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
      del.onclick=async e=>{e.preventDefault();e.stopPropagation();await Player.removeTrack(Number(div.dataset.idx))};
      div.appendChild(del);
    }
    const name=document.createElement('div');
    name.className='pc-title';
    name.textContent=song.title;
    const by=document.createElement('div');
    by.className='pc-artist';
    by.textContent=song.artist;
    div.appendChild(name);
    div.appendChild(by);
    div.onclick=e=>{if(dragMoved)return;commitPickerSong(Number(div.dataset.idx));toggleQueue(false)};
    pickerTrack.appendChild(div);
  });
  pickerCenter=requestedCenter===null?currentSongIdx:Math.max(0,Math.min(requestedCenter,window.PLAYLIST.length-1));
  dragOffset=0;
  updatePickerPosition(false);
}
function animatePickerRemoval(removedIndex,nextCenter){
  const removedEl=pickerTrack.querySelector(`.picker-cover[data-idx="${removedIndex}"]`);
  if(!removedEl){
    buildPicker();
    return;
  }
  const rect=removedEl.getBoundingClientRect();
  const ghost=removedEl.cloneNode(true);
  ghost.classList.add('picker-removing');
  Object.assign(ghost.style,{
    position:'fixed',
    left:rect.left+'px',
    top:rect.top+'px',
    width:rect.width+'px',
    minHeight:rect.height+'px',
    height:rect.height+'px',
    margin:'0',
    transform:'none',
    transformOrigin:'center',
    opacity:getComputedStyle(removedEl).opacity,
    pointerEvents:'none',
    zIndex:'35',
  });
  document.body.appendChild(ghost);
  removedEl.remove();
  [...pickerTrack.children].forEach((el,i)=>{el.dataset.idx=i});
  pickerCenter=Math.max(0,Math.min(nextCenter,window.PLAYLIST.length-1));
  pickerTrack.classList.remove('dragging');
  requestAnimationFrame(()=>requestAnimationFrame(()=>updatePickerPosition(true)));
  const animation=ghost.animate([
    {opacity:Number(ghost.style.opacity)||1,transform:'scale(1)'},
    {opacity:0,transform:'scale(.82) translateY(10px)'},
  ],{duration:240,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
  animation.finished.finally(()=>ghost.remove());
}
function attachTitleArtist(centerEl){
}
function updatePickerPosition(animate){
  pickerTrack.classList.toggle('dragging',!animate);
  const w=innerWidth,cx=w/2;
  const covers=[...pickerTrack.children];
  const baseGap=COVER_W+60;
  const fadeRange=baseGap*0.4;
  const dragCenter=pickerCenter-dragOffset/baseGap;
  let centerEl=null,minDist=Infinity,browsingIdx=pickerCenter;
  covers.forEach((el,i)=>{
    const rel=i-dragCenter;
    let posX=0;
    const dir=rel>=0?1:-1;
    const absRel=Math.abs(rel);
    for(let k=0;k<Math.floor(absRel);k++){
      const localScale=Math.max(.4,1-k*0.35);
      posX+=dir*baseGap*localScale;
    }
    const frac=absRel-Math.floor(absRel);
    if(frac>0){
      const d=Math.floor(absRel);
      const localScale=Math.max(.4,1-d*0.35);
      posX+=dir*baseGap*localScale*frac;
    }
    const elCenter=cx+posX;
    const dist=Math.abs(elCenter-cx);
    if(dist<minDist){minDist=dist;centerEl=el;browsingIdx=i}
    const scale=Math.max(.4,1-dist/800);
    const op=Math.max(.2,1-dist/600);
    el.style.left=elCenter+'px';
    el.style.transform='translate(-50%,-50%) scale('+scale+')';
    el.style.opacity=op;
    const titleOp=Math.max(0,1-dist/fadeRange);
    const name=el.querySelector('.pc-title');
    const by=el.querySelector('.pc-artist');
    if(name)name.style.opacity=titleOp;
    if(by)by.style.opacity=titleOp;
  });
if(false&&centerEl&&titleEl){
const song=window.PLAYLIST[browsingIdx];
if(song){
titleEl.textContent=song.title;
artistEl.textContent=song.artist;
attachTitleArtist(centerEl);
// 标题透明度跟位置绑定：完全居中(opacity=1)到两张之间(opacity=0)
const fadeRange=(COVER_W+60)*0.4;
const titleOp=Math.max(0,1-minDist/fadeRange);
titleEl.style.opacity=titleOp;
artistEl.style.opacity=titleOp;
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
async function commitPickerSong(idx){
  if(idx===currentSongIdx)return;
  const shouldResume=running;
  const ready=await switchSong(idx);
  if(shouldResume&&ready)startPlaybackFlow();
}
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
const shift=Math.round(-dragOffset/(COVER_W+60));
pickerCenter=Math.max(0,Math.min(window.PLAYLIST.length-1,pickerCenter+shift));
// 双 rAF：第一帧恢复 transition，第二帧才设目标值，确保 CSS 过渡启动
pickerTrack.classList.remove('dragging');
requestAnimationFrame(()=>{requestAnimationFrame(()=>{
  dragOffset=0;
  updatePickerPosition(true);
})});
if(dragMoved){
const blocker=e2=>{
songPicker.removeEventListener('click',blocker,true);
if(e2.target.closest('.picker-delete'))return;
e2.stopPropagation();e2.preventDefault()
};
songPicker.addEventListener('click',blocker,true);
}
setTimeout(()=>{dragMoved=false},100);
}
songPicker.addEventListener('mousedown',e=>{onDragStart(e.clientX);e.preventDefault()});
addEventListener('mousemove',e=>onDragMove(e.clientX));
addEventListener('mouseup',onDragEnd);
pickerTrack.addEventListener('touchstart',e=>{onDragStart(e.touches[0].clientX)},{passive:true});
pickerTrack.addEventListener('touchmove',e=>{onDragMove(e.touches[0].clientX);e.preventDefault()},{passive:false});
pickerTrack.addEventListener('touchend',onDragEnd);
function toggleQueue(force){
  if(!hasTracks()){
    setEmptyState(true);
    showEmptyHint();
    return;
  }
  const show=force!==undefined?force:!songPicker.classList.contains('show');
  songPicker.classList.toggle('show',show);
  document.querySelector('.app').classList.toggle('blurred',show);
  if(show){
    buildPicker();
    lastPreview=currentSongIdx;
  }
}
queueBtn.onclick=e=>{triggerIcon(queueBtn);toggleQueue();e.stopPropagation()};
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

function setButton(){
  const empty=!hasTracks();
  updateEmptyControls(empty);
  if(empty){
    morphPlayIcon(false,true);
    play.setAttribute('aria-label','歌单为空');
    play.title='歌单为空';
    player.classList.add('paused');
    return;
  }
  morphPlayIcon(running);
  play.setAttribute('aria-label',running?'暂停':'播放');
  play.title=running?'暂停':'播放';
  player.classList.toggle('paused',!running);
}
function fmt(t){if(!isFinite(t))return'0:00';return`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`}
function updateBuffer(){
  if(!buffer)return;
  const d=audio.duration;
  if(!isFinite(d)||d<=0||!audio.buffered||audio.buffered.length===0){
    buffer.style.width='0%';
    return;
  }
  let end=0;
  const t=audio.currentTime||0;
  for(let i=0;i<audio.buffered.length;i++){
    const s=audio.buffered.start(i),e=audio.buffered.end(i);
    if(t>=s&&t<=e){end=e;break}
    if(e>end)end=e;
  }
  buffer.style.width=Math.min(100,end/d*100)+'%';
}
function showPlaybackFailure(message){
  hint.textContent='播放失败：'+message;
  hint.classList.add('show');
  setTimeout(()=>hint.classList.remove('show'),2500);
}
function getTrackStreamLevel(song){
  if(song&&song._streamLevel)return song._streamLevel;
  const audioUrl=String(song&&song.audio||'');
  const match=audioUrl.match(/[?&]level=([^&]+)/);
  return match?decodeURIComponent(match[1]):'standard';
}
async function retryNextProviderSource(){
  const song=window.PLAYLIST[currentSongIdx];
  if(!song||!isRemovableTrack(song))return false;
  const provider=providerOf(song);
  const id=providerTrackId(song);
  if(!id)return false;
  if(provider==='qq'||provider==='bilibili'){
    try{
      const info=await NetEase.songUrl(id,'standard',provider);
      if(!info||!info.playable)return false;
      song.audio=providerStreamUrl(provider,id,'standard');
      saveAddedTracks();
      audio.pause();
      audio.src=song.audio;
      total.textContent='--:--';
      try{audio.load()}catch(e){}
      return true;
    }catch(e){return false}
  }
  const failed=song._failedLevels||(song._failedLevels=[]);
  const current=getTrackStreamLevel(song);
  if(!failed.includes(current))failed.push(current);
  for(const level of NETEASE_STREAM_LEVELS){
    if(failed.includes(level))continue;
    try{
      const info=await NetEase.songUrl(id,level,'netease');
      if(!info||!info.playable){
        failed.push(level);
        continue;
      }
      song._streamLevel=level;
      song.audio=providerStreamUrl('netease',id,level);
      saveAddedTracks();
      audio.pause();
      audio.src=song.audio;
      total.textContent='--:--';
      try{audio.load()}catch(e){}
      return true;
    }catch(e){
      failed.push(level);
    }
  }
  return false;
}
async function describeCurrentAudioFailure(fallback){
  const song=window.PLAYLIST[currentSongIdx];
  const fallbackMessage=(fallback&&fallback.message)||'音频源不可用';
  if(!song||!isRemovableTrack(song)||!song.audio)return fallbackMessage;
  try{
    const level=getTrackStreamLevel(song);
    const provider=providerOf(song);
    const info=await NetEase.songUrl(providerTrackId(song),level,provider);
    if(info&&info.playable)return fallbackMessage;
    return info&&info.reason?info.reason:fallbackMessage;
  }catch(e){
    return (e&&e.message)||fallbackMessage;
  }
}
// 每帧从真实音频读取时间，驱动进度条/时间文本/歌词行+逐词高亮
function tick(){const t=audio.currentTime,d=audio.duration;updateBuffer();if(running&&isFinite(d)&&d>0){fill.style.width=`${Math.min(100,t/d*100)}%`;now.textContent=fmt(t);const newRow=rowAt(t);if(newRow!==active){clearWordHighlight(active);setLine(newRow);lastWordKey=''}highlightWords(t);const _tn=performance.now();if(_tn-lastSave>2000){lastSave=_tn;saveProgress()}}requestAnimationFrame(tick)}
async function startPlaybackFlow(){
  running=true;
  const requestId=++playRequestId;
  setButton();
  try{
    await playStart();
    if(requestId===playRequestId)setButton();
    return true;
  }catch(e){
    if(requestId!==playRequestId||isPlayInterruptedError(e))return false;
    console.error('play failed',e);
    if(await retryNextProviderSource()){
      const retryId=++playRequestId;
      running=true;
      setButton();
      try{
        await playStart();
        if(retryId===playRequestId)setButton();
        return true;
      }catch(retryError){
        if(retryId!==playRequestId||isPlayInterruptedError(retryError))return false;
        console.error('play retry failed',retryError);
      }
    }
    showPlaybackFailure(await describeCurrentAudioFailure(e));
    running=false;
    setButton();
    return false;
  }
}
async function switchTrackFromControl(index){
  if(index==null||index<0||index>=window.PLAYLIST.length)return;
  const shouldResume=running;
  const ready=await switchSong(index);
  if(shouldResume&&ready)startPlaybackFlow();
}
play.onclick=async()=>{
  triggerIcon(play);
  if(running){
    playRequestId++;
    audio.pause();
    setButton();
    return;
  }
  await startPlaybackFlow();
};
async function playStart(){
  const ready=await pendingAudioReady;
  if(!ready)throw new DOMException('切歌请求已取消','AbortError');
  initAudio();
  if(audioCtx&&audioCtx.state==='suspended')await audioCtx.resume();
  await audio.play();
}
modeButton.onclick=()=>{triggerIcon(modeButton,'mode-switch',640);cyclePlayMode()};
muteButton.onclick=()=>{
  audio.muted=!audio.muted;
  triggerSoundIcon(audio.muted);
  muteButton.classList.toggle('muted',audio.muted);
  muteButton.title=audio.muted?'取消静音':'静音';
  muteButton.setAttribute('aria-label',muteButton.title);
};
if(settingsButton){
  settingsButton.onclick=e=>{
    triggerIcon(settingsButton);
    setEqOpen(!(eqOverlay&&eqOverlay.classList.contains('show')));
    e.stopPropagation();
  };
}
if(eqOverlay)eqOverlay.addEventListener('click',e=>{if(e.target===eqOverlay)setEqOpen(false)});
if(eqPanel)eqPanel.addEventListener('click',e=>e.stopPropagation());
for(const input of eqSliders)input.addEventListener('input',()=>setEqBand(input.dataset.eq,input.value));
for(const button of eqPresetButtons)button.addEventListener('click',()=>setEqPreset(button.dataset.eqPreset));
if(cacheCurrentButton)cacheCurrentButton.onclick=()=>Player.cacheTrack();
if(eqReset)eqReset.onclick=()=>{
  setEqPreset('flat');
};
prevButton.onclick=()=>{
  if(audio.currentTime>3){
    audio.currentTime=0;
    now.textContent='0:00';
    fill.style.width='0%';
    return;
  }
  switchTrackFromControl(previousTrackIndex());
};
nextButton.onclick=()=>switchTrackFromControl(nextTrackIndex());
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
function stopAtTrackEnd(){
  running=false;
  audio.currentTime=0;
  fill.style.width='0%';
  now.textContent='0:00';
  clearWordHighlight(active);
  setLine(0);
  setButton();
}
audio.addEventListener('ended',async()=>{
  saveTrackProgress(window.PLAYLIST[currentSongIdx],0);
  if(playMode==='repeat-one'){
    audio.currentTime=0;
    startPlaybackFlow();
    return;
  }
  if(playMode==='play-once'){
    stopAtTrackEnd();
    return;
  }
  const nextIndex=nextTrackIndex();
  if(nextIndex==null){
    stopAtTrackEnd();
    return;
  }
  const ready=await switchSong(nextIndex);
  if(ready)startPlaybackFlow();
});
audio.addEventListener('error',async()=>{
  if(!audio.src)return;
  const shouldResume=running;
  if(await retryNextProviderSource()){
    if(shouldResume){
      const retryId=++playRequestId;
      running=true;
      try{
        await playStart();
        if(retryId===playRequestId)setButton();
      }catch(e){
        if(retryId===playRequestId&&!isPlayInterruptedError(e)){
          showPlaybackFailure(await describeCurrentAudioFailure(e));
          running=false;
          setButton();
        }
      }
    }
    return;
  }
  const message=await describeCurrentAudioFailure(audio.error);
  showPlaybackFailure(message);
  running=false;
  setButton();
});

/* === 真实音波：Web Audio API AnalyserNode 驱动，低音在左高音在右 === */
const BAR_COUNT=68;
const bars=[];
for(let i=0;i<BAR_COUNT;i++){const s=document.createElement('span');wave.appendChild(s);bars.push(s.style)}
let audioCtx=null,analyser=null,freqData=null,audioSourceNode=null,eqFilters=null;
let spectrumRAFId=null; // P0-81: 只允许一个 RAF 循环
function initAudio(){
  if(audioCtx)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const src=audioCtx.createMediaElementSource(audio);
    audioSourceNode=src;
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=256;
    analyser.smoothingTimeConstant=0.78;
    eqFilters={};
    let node=src;
    for(const band of EQ_BANDS){
      const filter=audioCtx.createBiquadFilter();
      filter.type=band.type;
      filter.frequency.value=band.freq;
      filter.Q.value=band.q;
      filter.gain.value=Number(eqState[band.id]||0);
      node.connect(filter);
      node=filter;
      eqFilters[band.id]=filter;
    }
    node.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData=new Uint8Array(analyser.frequencyBinCount);
    console.log('[initAudio] AudioContext state='+audioCtx.state+', analyser ready');
    // 切换到真实频谱数据驱动（不再启动新 RAF，复用同一个）
  }catch(e){console.error('[initAudio] FAILED:',e)}
}
function drawSpectrum(){
  // analyser 就绪后用真实数据，否则用装饰性动画
  if(analyser&&freqData){
    analyser.getByteFrequencyData(freqData);
    const usable=80;
    const maxH=32;
    for(let i=0;i<BAR_COUNT;i++){
      const fi=Math.min(usable-1,Math.floor(i*(usable/BAR_COUNT)));
      const v=freqData[fi]/255;
      bars[i].setProperty('--h',`${3+v*maxH}px`);
    }
  }else{
    // 装饰性待机动画（analyser 未就绪时）
    for(let i=0;i<BAR_COUNT;i++)bars[i].setProperty('--h',`${6+Math.abs(Math.sin(i*.54)+Math.cos(i*.18))*8}px`);
  }
  spectrumRAFId=requestAnimationFrame(drawSpectrum);
}
drawSpectrum(); // 唯一一次启动，整个生命周期复用
updateEqUi();setEqOpen(false);updateModeButton(false);morphPlayIcon(false,true);setButton();requestAnimationFrame(tick);requestAnimationFrame(physicsTick);

// P0-84: 播放状态以音频事件为准，避免与按钮不同步
audio.addEventListener('play',()=>{running=true;setButton();if(bilibiliVideoBg&&bilibiliVideoBg.classList.contains('show'))bilibiliVideoBg.play().catch(()=>{})});
audio.addEventListener('pause',()=>{running=false;setButton();if(bilibiliVideoBg)bilibiliVideoBg.pause()});
audio.addEventListener('waiting',()=>{player.classList.add('paused')});
audio.addEventListener('playing',()=>{player.classList.remove('paused')});
audio.addEventListener('seeked',()=>{if(bilibiliVideoBg&&bilibiliVideoBg.classList.contains('show')&&bilibiliVideoBg.readyState>=1){try{bilibiliVideoBg.currentTime=audio.currentTime}catch(e){}}});

// P0-85: 进度保存在更多事件触发
function saveProgress(){
  if(suppressProgressSave||!hasTracks())return;
  const idx=Math.max(0,Math.min(currentSongIdx,window.PLAYLIST.length-1));
  const song=window.PLAYLIST[idx];
  const t=audio.currentTime||0;
  saveProgressForSong(idx,song,t);
}
audio.addEventListener('pause',saveProgress);
addEventListener('pagehide',saveProgress);
addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveProgress()});
let lastSave=0;
// P0-78/79: 安全解析 localStorage
function loadSavedProgress(){
  try{
    const raw=localStorage.getItem(GLOBAL_PROGRESS_KEY);
    if(!raw)return{song:0,time:0};
    const saved=JSON.parse(raw);
    if(typeof saved!=='object'||saved===null)return{song:0,time:0};
    let song=Number(saved.song); let time=Number(saved.time);
    const key=typeof saved.key==='string'?saved.key:'';
    if(key){
      const idx=window.PLAYLIST.findIndex(item=>progressKeyForSong(item)===key);
      if(idx>=0)song=idx;
    }
    if(!isFinite(song)||song<0)song=0;
    if(!isFinite(time)||time<0)time=0;
    return{song,time,key};
  }catch(e){ try{localStorage.removeItem(GLOBAL_PROGRESS_KEY)}catch(_){} return{song:0,time:0}; }
}
const saved=loadSavedProgress();
if(hasTracks()){
  const startIdx=Math.min(saved.song,window.PLAYLIST.length-1);
  const startSong=window.PLAYLIST[startIdx];
  const startTrackTime=savedTimeForSong(startSong);
  const startTime=startTrackTime||(saved.key?0:(saved.time||0));
  // player.js 在在线 provider 客户端之前加载；延迟一轮，避免恢复在线歌曲时
  // 因 NetEase 尚未定义而把歌词错误缓存成“暂无歌词”。
  setTimeout(()=>switchSong(startIdx,startTime),0);
}else{
  setTimeout(()=>setEmptyState(true),0);
}
