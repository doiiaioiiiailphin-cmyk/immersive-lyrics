// player.js v6 (word-by-word karaoke + 歌单切换)
console.log('[player.js] v6 loaded, crossOrigin=', document.getElementById('audio').crossOrigin, 'protocol=', location.protocol);
const OFFLINE_RENDER_MODE=!!window.__OFFLINE_RENDER_MODE;

const list=document.getElementById('list'),audio=document.getElementById('audio'),play=document.getElementById('play'),player=document.getElementById('player'),fill=document.getElementById('fill'),buffer=document.getElementById('buffer'),now=document.getElementById('now'),track=document.getElementById('track'),hint=document.getElementById('hint'),total=document.getElementById('total'),wave=document.getElementById('wave'),queueBtn=document.getElementById('queue'),songPicker=document.getElementById('song-picker'),pickerTrack=document.getElementById('picker-track');
const bilibiliVideoBg=document.getElementById('bilibili-video-bg');
const playShapeLeft=document.getElementById('play-shape-left'),playShapeRight=document.getElementById('play-shape-right'),modeButton=document.getElementById('play-mode'),muteButton=document.getElementById('mute'),settingsButton=document.getElementById('settings'),eqOverlay=document.getElementById('eq-overlay'),eqPanel=document.getElementById('eq-panel'),eqReset=document.getElementById('eq-reset'),cacheCurrentButton=document.getElementById('cache-current-track'),cacheCurrentLabel=document.getElementById('cache-current-label'),cacheCurrentStatus=document.getElementById('cache-current-status');
const prevButton=document.getElementById('prev'),nextButton=document.getElementById('next'),eqSliders=[...document.querySelectorAll('[data-eq]')],eqPresetButtons=[...document.querySelectorAll('[data-eq-preset]')];
const cacheCurrentIcon=document.querySelector('.cache-current-icon');
let active=0,running=false,targetOffset=0;
let data=[],wordEls=[];
let currentSongIdx=0;
let playRequestId=0;
let pendingAudioReady=Promise.resolve(true);
let cacheProgressTimer=0;
const IS_ANDROID_APP=!!window.__ANDROID_NATIVE_AUDIO__||document.documentElement.classList.contains('android-app');

const ADDED_TRACKS_KEY='player_added_tracks';
const PLAYLISTS_KEY='player_playlists_v1';
const PLAY_MODE_KEY='player_play_mode';
const EQ_KEY='player_eq';
const GLOBAL_PROGRESS_KEY='player_progress';
const TRACK_PROGRESS_KEY='player_track_progress';
const NETEASE_STREAM_LEVELS=['standard','higher','exhigh'];
const EMPTY_COVER_SRC='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="rgba(255,255,255,.34)" offset="0"/><stop stop-color="rgba(255,255,255,.08)" offset="1"/></linearGradient></defs><rect width="360" height="360" rx="26" fill="url(#g)"/><circle cx="180" cy="180" r="66" fill="none" stroke="rgba(255,255,255,.58)" stroke-width="12"/><circle cx="180" cy="180" r="16" fill="rgba(255,255,255,.62)"/><path d="M224 118v96a28 28 0 1 1-12-23V143l-74 16v72a28 28 0 1 1-12-23v-86l98-22Z" fill="rgba(255,255,255,.72)"/></svg>');
const CACHE_VINYL_ICON='<svg viewBox="-60 -60 120 120" aria-hidden="true"><defs><g id="cache-vinyl"><circle cx="0" cy="0" r="48"/><circle class="cache-label-disc" cx="0" cy="0" r="14"/><circle class="cache-hole" cx="0" cy="0" r="3"/><circle class="cache-label-dash" cx="0" cy="0" r="10"/><circle class="cache-groove g1" cx="0" cy="0" r="20"/><circle class="cache-groove g2" cx="0" cy="0" r="28"/><circle class="cache-groove g3" cx="0" cy="0" r="38"/><circle class="cache-groove g4" cx="0" cy="0" r="44"/></g><clipPath id="cache-cp0"><path d="M5.41-.09 3.13-92.44 17.95-197.23 64.07-150.74 17.67-3.04Z"/></clipPath><clipPath id="cache-cp1"><path d="M46.36 16.38 167.83 52.78 231.45.26 62.82-151.81 16.42-4.11Z"/></clipPath><clipPath id="cache-cp2"><path d="M1.17 2.51 5.46-1.51 17.72-4.46 47.65 16.03 20.97 16.25Z"/></clipPath><clipPath id="cache-cp3"><path d="M20.74 15.01 47.43 14.79 168.9 51.2-.5 228.85-31.49 190.23-3.16 31.02Z"/></clipPath><clipPath id="cache-cp4"><path d="M1.4 2.39 21.19 16.13-2.71 32.14-5.78 5.38Z"/></clipPath><clipPath id="cache-cp5"><path d="M-5 4.81-17.26-1.82-188.3 32.63-30.25 190.78-1.93 31.58Z"/></clipPath><clipPath id="cache-cp6"><path d="M-16.96.14 4.48-92.58 19.3-197.37 1.03-220.3-230.3 1.19-188 34.59Z"/></clipPath><clipPath id="cache-cp7"><path d="M1.49 2.86 5.78-1.16 3.5-93.51-17.95-.79-5.69 5.85Z"/></clipPath></defs><g class="cache-outer-ring"><circle class="cache-ring-base" cx="0" cy="0" r="55"/><circle class="cache-ring-dash" cx="0" cy="0" r="55"/></g><g class="cache-vinyl-assembly"><g class="cache-fragment" style="--i:0;--cx:21.65;--cy:-88.71" clip-path="url(#cache-cp0)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:1;--cx:104.98;--cy:-17.3" clip-path="url(#cache-cp1)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:2;--cx:18.59;--cy:5.77" clip-path="url(#cache-cp2)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:3;--cx:33.65;--cy:88.52" clip-path="url(#cache-cp3)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:4;--cx:3.53;--cy:14.01" clip-path="url(#cache-cp4)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:5;--cx:-48.55;--cy:51.6" clip-path="url(#cache-cp5)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:6;--cx:-68.41;--cy:-79.06" clip-path="url(#cache-cp6)"><use href="#cache-vinyl"/></g><g class="cache-fragment" style="--i:7;--cx:-2.57;--cy:-17.35" clip-path="url(#cache-cp7)"><use href="#cache-vinyl"/></g></g><g class="cache-import-mark"><path class="cache-import-arrow" d="M0-22V4m-10-10L0 4l10-10"/><path d="M-18 12h36v12h-36z"/></g></svg>';
if(cacheCurrentIcon)cacheCurrentIcon.innerHTML=CACHE_VINYL_ICON;
const DEFAULT_PLAYLIST_ID='default';
const BUILTIN_TRACKS=(window.PLAYLIST||[]).map(track=>Object.assign({},track));
let playlists=[];
let activePlaylistId=DEFAULT_PLAYLIST_ID;
let pickerPlaylistId=DEFAULT_PLAYLIST_ID;
let playlistRailEl=null;
let playlistTooltipEl=null;
let playlistTooltipHideTimer=0;
let playlistDialogEl=null;
let playlistSwitching=false;
let playlistPreviewLayer=null;
let playlistDragDirection=0;
let playlistDragTargetId='';
let playlistRailDrag=null;
let suppressRailClick=false;
let playlistRailProgress=0;
let playlistRailAnimFrame=0;
let playlistSwitchTimer=0;
let playlistSwitchCancelFinish=null;
let playlistSwitchTargetId='';
let playlistSwitchDirection=0;
let dragStartPlaylistIndex=0;
let playlistTooltipAnchorEl=null;
let playlistTooltipPointerHandler=null;
let seenPlaylistRailIds=new Set();
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
function providerStreamUrl(provider,id,level,options){options=options||{};let url='/api/stream/'+encodeURIComponent(id)+'?level='+encodeURIComponent(level||'standard');if(provider&&provider!=='netease')url+='&provider='+encodeURIComponent(provider);if(options.mediaMid)url+='&media_mid='+encodeURIComponent(options.mediaMid);return url}
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
    audio:track.cacheMediaId?cachedAudioUrl(track.cacheMediaId):(track.audio&&String(track.audio).startsWith('/api/cache/')?track.audio:providerStreamUrl(provider,id,'standard',{mediaMid:track.mediaMid||track.media_mid||''})),
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
  if(provider==='qq'){normalized.qqId=id;normalized.songmid=track.songmid||id;normalized.mediaMid=track.mediaMid||track.media_mid||undefined;normalized.qqSongId=track.qqSongId||undefined}
  if(provider==='bilibili')normalized.bilibiliId=id;
  return normalized;
}
function makePlaylistId(){return 'pl_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7)}
function defaultPlaylistName(index){return index?('歌单 '+(index+1)):'默认歌单'}
function playlistIndexById(id){return playlists.findIndex(list=>list&&list.id===id)}
function getPlaylistById(id){return playlists[playlistIndexById(id)]||null}
function defaultPlaylist(){
  let list=getPlaylistById(DEFAULT_PLAYLIST_ID);
  if(!list){
    list={id:DEFAULT_PLAYLIST_ID,name:'默认歌单',tracks:[],lastKey:''};
    playlists.unshift(list);
  }
  return list;
}
function uniqueTracks(tracks){
  const seen=new Set();
  return (Array.isArray(tracks)?tracks:[]).map(normalizeAddedTrack).filter(track=>{
    if(!track||seen.has(track._key))return false;
    seen.add(track._key);
    return true;
  });
}
function normalizePlaylistRecord(record,index){
  if(!record||typeof record!=='object')return null;
  const id=String(record.id||'').trim()||(index===0?DEFAULT_PLAYLIST_ID:makePlaylistId());
  const safeId=id===DEFAULT_PLAYLIST_ID?DEFAULT_PLAYLIST_ID:id.replace(/[^a-zA-Z0-9_-]/g,'')||makePlaylistId();
  return {
    id:safeId,
    name:String(record.name||defaultPlaylistName(index)).trim()||defaultPlaylistName(index),
    tracks:uniqueTracks(record.tracks),
    lastKey:typeof record.lastKey==='string'?record.lastKey:'',
  };
}
function tracksForPlaylist(id){
  const list=getPlaylistById(id)||defaultPlaylist();
  if(list.id===DEFAULT_PLAYLIST_ID)return BUILTIN_TRACKS.map(track=>Object.assign({},track)).concat(list.tracks.map(track=>Object.assign({},track)));
  return list.tracks.map(track=>Object.assign({},track));
}
function assignTracksToPlaylist(id,tracks){
  const list=getPlaylistById(id)||defaultPlaylist();
  list.tracks=uniqueTracks(tracks);
}
function activePlaylist(){return getPlaylistById(activePlaylistId)||defaultPlaylist()}
function pickerPlaylist(){return getPlaylistById(pickerPlaylistId)||activePlaylist()}
function pickerTracks(){return tracksForPlaylist(pickerPlaylistId)}
function targetPlaylistForAdd(){return songPicker&&songPicker.classList.contains('show')?pickerPlaylist():activePlaylist()}
function materializeActivePlaylist(){
  if(!getPlaylistById(activePlaylistId))activePlaylistId=DEFAULT_PLAYLIST_ID;
  window.PLAYLIST=tracksForPlaylist(activePlaylistId);
  if(currentSongIdx>=window.PLAYLIST.length)currentSongIdx=Math.max(0,window.PLAYLIST.length-1);
}
function savePlaylists(){
  try{
    defaultPlaylist();
    const payload={version:1,activePlaylistId,playlists:playlists.map((list,index)=>({
      id:list.id,
      name:String(list.name||defaultPlaylistName(index)),
      tracks:uniqueTracks(list.tracks),
      lastKey:typeof list.lastKey==='string'?list.lastKey:'',
    }))};
    localStorage.setItem(PLAYLISTS_KEY,JSON.stringify(payload));
    localStorage.setItem(ADDED_TRACKS_KEY,JSON.stringify((getPlaylistById(DEFAULT_PLAYLIST_ID)||{tracks:[]}).tracks||[]));
  }catch(e){}
}
function saveAddedTracks(){
  assignTracksToPlaylist(activePlaylistId,window.PLAYLIST);
  savePlaylists();
}
function loadLegacyAddedTracks(){
  try{
    const raw=localStorage.getItem(ADDED_TRACKS_KEY);
    if(!raw)return[];
    const saved=JSON.parse(raw);
    return Array.isArray(saved)?uniqueTracks(saved):[];
  }catch(e){try{localStorage.removeItem(ADDED_TRACKS_KEY)}catch(_){} return[]}
}
function loadAddedTracks(){
  try{
    const raw=localStorage.getItem(PLAYLISTS_KEY);
    if(raw){
      const saved=JSON.parse(raw);
      const loaded=Array.isArray(saved&&saved.playlists)?saved.playlists.map(normalizePlaylistRecord).filter(Boolean):[];
      playlists=loaded.length?loaded:[];
      defaultPlaylist();
      activePlaylistId=getPlaylistById(saved.activePlaylistId)?saved.activePlaylistId:DEFAULT_PLAYLIST_ID;
      pickerPlaylistId=activePlaylistId;
      materializeActivePlaylist();
      return;
    }
  }catch(e){try{localStorage.removeItem(PLAYLISTS_KEY)}catch(_){}}
  playlists=[{id:DEFAULT_PLAYLIST_ID,name:'默认歌单',tracks:loadLegacyAddedTracks(),lastKey:''}];
  activePlaylistId=DEFAULT_PLAYLIST_ID;
  pickerPlaylistId=activePlaylistId;
  materializeActivePlaylist();
  savePlaylists();
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
function cacheProgressOf(song,cached,loading){
  if(cached)return 1;
  if(loading)return Math.max(0.02,Math.min(0.98,Number(song&&song._cacheProgress)||0));
  return 0;
}
function setCacheProgress(song,value){
  if(!song)return;
  song._cacheProgress=Math.max(0,Math.min(1,Number(value)||0));
  updateCacheControls();
}
function clearCacheProgressTimer(){
  if(cacheProgressTimer){clearInterval(cacheProgressTimer);cacheProgressTimer=0}
}
function startCacheProgress(song){
  clearCacheProgressTimer();
  setCacheProgress(song,0.04);
  cacheProgressTimer=setInterval(()=>{
    if(!song||!song._caching){clearCacheProgressTimer();return}
    const current=Number(song._cacheProgress)||0;
    const next=current+(0.92-current)*0.055+0.003;
    setCacheProgress(song,Math.min(0.92,next));
  },180);
}
function pulseCacheStart(song){
  if(!song)return;
  song._cacheStarting=true;
  updateCacheControls();
  setTimeout(()=>{delete song._cacheStarting;updateCacheControls()},420);
}
function showCacheFailure(song){
  if(!song)return;
  song._cacheFailed=true;
  song._cacheProgress=0;
  updateCacheControls();
  setTimeout(()=>{delete song._cacheFailed;updateCacheControls()},520);
}
function updateCacheControls(){
  if(!cacheCurrentButton)return;
  const song=currentCacheTarget();
  const box=cacheCurrentButton.closest('.settings-cache');
  const cached=!!(song&&(song.cacheMediaId||(song.source==='bilibili'&&song.localMediaId)));
  const loading=!!(song&&song._caching);
  const progress=cacheProgressOf(song,cached,loading);
  cacheCurrentButton.style.setProperty('--cache-progress',String(progress));
  cacheCurrentButton.disabled=!song||providerOf(song)==='local'||loading||cached;
  if(box){
    box.classList.toggle('cached',cached);
    box.classList.toggle('loading',loading);
    box.classList.toggle('starting',!!(song&&song._cacheStarting));
    box.classList.toggle('failed',!!(song&&song._cacheFailed));
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
  for(const button of [play,prevButton,nextButton]){
    if(button)button.disabled=!!empty;
  }
  if(queueBtn)queueBtn.disabled=false;
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

function playlistTitle(id){
  const list=getPlaylistById(id)||activePlaylist();
  return String(list&&list.name||'默认歌单');
}
function nextPlaylistDefaultName(){
  let n=playlists.length+1;
  const names=new Set(playlists.map(list=>String(list.name||'')));
  while(names.has('歌单 '+n))n++;
  return '歌单 '+n;
}
function centerForPlaylist(id){
  const list=getPlaylistById(id)||defaultPlaylist();
  const songs=tracksForPlaylist(list.id);
  let center=list.lastKey?songs.findIndex(song=>playlistKey(song)===list.lastKey):-1;
  return center>=0?center:0;
}
function ensurePlaylistRail(){
  if(playlistRailEl||!songPicker)return playlistRailEl;
  playlistRailEl=document.createElement('div');
  playlistRailEl.className='playlist-rail';
  playlistRailEl.innerHTML='<div class="playlist-rail-dots" role="tablist" aria-label="歌单"></div><button class="playlist-rail-add" type="button" aria-label="新建歌单"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg></button><i class="playlist-rail-marker" aria-hidden="true"></i>';
  playlistRailEl.addEventListener('click',e=>e.stopPropagation());
  playlistRailEl.addEventListener('pointerdown',e=>e.stopPropagation());
  const add=playlistRailEl.querySelector('.playlist-rail-add');
  if(add)add.onclick=e=>{e.preventDefault();e.stopPropagation();if(!playlistSwitching)createEmptyPlaylistFromRail()};
  songPicker.appendChild(playlistRailEl);
  return playlistRailEl;
}
function renderPlaylistRail(){
  const rail=ensurePlaylistRail();
  if(!rail)return;
  const dots=rail.querySelector('.playlist-rail-dots');
  if(!dots)return;
  dots.innerHTML='';
  playlists.forEach((list,index)=>{
    const item=document.createElement('div');
    item.className='playlist-rail-item'+(seenPlaylistRailIds.has(list.id)?'':' rail-enter');
    item.dataset.id=list.id;
    item.dataset.index=String(index);
    item.innerHTML='<button class="playlist-dot" type="button" role="tab" aria-selected="false" aria-label="'+esc(playlistTitle(list.id))+'"></button>';
    const dot=item.querySelector('.playlist-dot');
    if(!IS_ANDROID_APP){
      item.addEventListener('pointerenter',()=>showPlaylistTooltip(list.id,item));
      item.addEventListener('focusin',()=>showPlaylistTooltip(list.id,item));
      item.addEventListener('pointerleave',scheduleHidePlaylistTooltip);
      item.addEventListener('focusout',scheduleHidePlaylistTooltip);
    }
    if(dot){
      dot.onclick=e=>{
        e.preventDefault();e.stopPropagation();
        if(suppressRailClick)return;
        const from=playlistIndexById(pickerPlaylistId),to=playlistIndexById(list.id);
        if(list.id!==pickerPlaylistId)animatePlaylistSwitchTo(list.id,to>=from?1:-1);
        if(IS_ANDROID_APP)showPlaylistTooltip(list.id,item);
      };
      dot.addEventListener('pointerdown',e=>startPlaylistRailDrag(e,list.id));
    }
    dots.appendChild(item);
    seenPlaylistRailIds.add(list.id);
  });
  updatePlaylistRailActive(true);
  requestAnimationFrame(()=>ensurePlaylistRailItemVisible(Math.max(0,playlistIndexById(pickerPlaylistId)),false));
}
function ensurePlaylistRailItemVisible(index,smooth){
  const rail=ensurePlaylistRail();
  const dots=rail&&rail.querySelector('.playlist-rail-dots');
  const item=dots&&dots.querySelector('.playlist-rail-item[data-index="'+index+'"]');
  if(!dots||!item||dots.clientWidth<=0)return;
  const pad=5;
  const left=item.offsetLeft;
  const right=left+item.offsetWidth;
  let target=dots.scrollLeft;
  if(left<dots.scrollLeft+pad)target=Math.max(0,left-pad);
  else if(right>dots.scrollLeft+dots.clientWidth-pad)target=right-dots.clientWidth+pad;
  if(Math.abs(target-dots.scrollLeft)>1)dots.scrollTo({left:target,behavior:smooth?'smooth':'auto'});
}
function setPlaylistRailProgress(value){
  const rail=ensurePlaylistRail();
  if(!rail)return;
  const max=Math.max(0,playlists.length-1);
  playlistRailProgress=Math.max(0,Math.min(max,Number(value)||0));
  const items=[...rail.querySelectorAll('.playlist-rail-item')];
  const nearest=Math.round(playlistRailProgress);
  items.forEach((item,index)=>{
    const dot=item.querySelector('.playlist-dot');
    const dist=Math.abs(index-playlistRailProgress);
    const weight=Math.max(0,1-dist);
    const soft=Math.max(0,1-dist/1.8);
    item.classList.toggle('active',index===nearest&&Math.abs(index-playlistRailProgress)<.5);
    item.style.width=(18+6*weight)+'px';
    item.style.height='30px';
    item.style.flexBasis=(18+6*weight)+'px';
    item.style.transform='translateX('+((index-playlistRailProgress)*soft*1.5)+'px)';
    item.style.opacity=String(.72+.28*soft);
    if(dot){
      dot.setAttribute('aria-selected',index===nearest?'true':'false');
      dot.style.width=(10+12*weight)+'px';
      dot.style.height='10px';
      dot.style.borderRadius=weight>.02?'999px':'50%';
      dot.style.background='rgba(255,255,255,'+(.48+.52*weight).toFixed(3)+')';
      dot.style.boxShadow=weight>.05?'0 0 '+(8+14*weight).toFixed(1)+'px rgba(255,255,255,'+(.12+.28*weight).toFixed(3)+'),0 0 0 1px rgba(255,255,255,.16)':'0 0 0 1px rgba(255,255,255,.08)';
    }
  });
}
function updatePlaylistRailActive(animated){
  cancelAnimationFrame(playlistRailAnimFrame);
  const target=Math.max(0,playlistIndexById(pickerPlaylistId));
  if(!animated){setPlaylistRailProgress(target);return;}
  animatePlaylistRailTo(target,260);
}
function animatePlaylistRailTo(target,duration){
  cancelAnimationFrame(playlistRailAnimFrame);
  const from=playlistRailProgress;
  const start=performance.now();
  const ease=t=>1-Math.pow(1-t,3);
  function frame(now){
    const t=Math.min(1,(now-start)/(duration||360));
    setPlaylistRailProgress(from+(target-from)*ease(t));
    if(t<1)playlistRailAnimFrame=requestAnimationFrame(frame);
    else ensurePlaylistRailItemVisible(Math.round(target),true);
  }
  playlistRailAnimFrame=requestAnimationFrame(frame);
}
function ensurePlaylistTooltip(){
  if(playlistTooltipEl||!songPicker)return playlistTooltipEl;
  playlistTooltipEl=document.createElement('div');
  playlistTooltipEl.className='playlist-floating-tip';
  playlistTooltipEl.innerHTML='<strong></strong><span></span><div class="playlist-tip-actions"><button type="button" data-action="rename">改名</button><button type="button" data-action="delete">删除</button></div>';
  playlistTooltipEl.addEventListener('pointerenter',()=>{if(!IS_ANDROID_APP)clearTimeout(playlistTooltipHideTimer)});
  playlistTooltipEl.addEventListener('pointerdown',e=>{
    clearTimeout(playlistTooltipHideTimer);
    e.stopPropagation();
    if(IS_ANDROID_APP)playlistTooltipHideTimer=setTimeout(()=>hidePlaylistTooltip(),3000);
  });
  playlistTooltipEl.addEventListener('click',e=>e.stopPropagation());
  songPicker.appendChild(playlistTooltipEl);
  return playlistTooltipEl;
}
function pointInRect(x,y,rect,pad){
  pad=pad||0;
  return !!rect&&x>=rect.left-pad&&x<=rect.right+pad&&y>=rect.top-pad&&y<=rect.bottom+pad;
}
function playlistTooltipContainsPoint(x,y){
  if(!playlistTooltipEl||!playlistTooltipEl.classList.contains('show'))return false;
  const tipRect=playlistTooltipEl.getBoundingClientRect();
  const anchorRect=playlistTooltipAnchorEl&&playlistTooltipAnchorEl.getBoundingClientRect();
  return pointInRect(x,y,tipRect,1)||pointInRect(x,y,anchorRect,1);
}
function attachPlaylistTooltipPointerWatch(){
  if(playlistTooltipPointerHandler)return;
  playlistTooltipPointerHandler=e=>{
    if(!playlistTooltipContainsPoint(e.clientX,e.clientY))hidePlaylistTooltip();
  };
  window.addEventListener('pointermove',playlistTooltipPointerHandler,true);
  window.addEventListener('mousemove',playlistTooltipPointerHandler,true);
  window.addEventListener('mousedown',playlistTooltipPointerHandler,true);
  window.addEventListener('wheel',playlistTooltipPointerHandler,true);
}
function detachPlaylistTooltipPointerWatch(){
  if(!playlistTooltipPointerHandler)return;
  window.removeEventListener('pointermove',playlistTooltipPointerHandler,true);
  window.removeEventListener('mousemove',playlistTooltipPointerHandler,true);
  window.removeEventListener('mousedown',playlistTooltipPointerHandler,true);
  window.removeEventListener('wheel',playlistTooltipPointerHandler,true);
  playlistTooltipPointerHandler=null;
}
function showPlaylistTooltip(id,item){
  clearTimeout(playlistTooltipHideTimer);
  const tip=ensurePlaylistTooltip();
  const list=getPlaylistById(id);
  if(!tip||!list)return;
  playlistTooltipAnchorEl=item;
  tip.dataset.id=id;
  const title=tip.querySelector('strong');
  const sub=tip.querySelector('span');
  const del=tip.querySelector('[data-action="delete"]');
  if(title)title.textContent=playlistTitle(id);
  if(sub)sub.textContent=(tracksForPlaylist(id).length||0)+' 首歌';
  if(del){del.disabled=id===DEFAULT_PLAYLIST_ID;del.title=id===DEFAULT_PLAYLIST_ID?'默认歌单不能删除':'';}
  tip.querySelector('[data-action="rename"]').onclick=e=>{e.preventDefault();e.stopPropagation();hidePlaylistTooltip();openRenamePlaylistDialog(id)};
  if(del)del.onclick=e=>{e.preventDefault();e.stopPropagation();if(id!==DEFAULT_PLAYLIST_ID){hidePlaylistTooltip();openDeletePlaylistDialog(id)}};
  const rect=item.getBoundingClientRect();
  const pickerRect=songPicker.getBoundingClientRect();
  tip.classList.add('show');
  const tipRect=tip.getBoundingClientRect();
  const left=Math.max(18,Math.min(window.innerWidth-tipRect.width-18,rect.left+rect.width/2-tipRect.width/2));
  const top=Math.max(18,Math.min(window.innerHeight-tipRect.height-18,rect.bottom+10));
  tip.style.left=(left-pickerRect.left)+'px';
  tip.style.top=(top-pickerRect.top)+'px';
  attachPlaylistTooltipPointerWatch();
  if(IS_ANDROID_APP){
    clearTimeout(playlistTooltipHideTimer);
    playlistTooltipHideTimer=setTimeout(()=>hidePlaylistTooltip(),3000);
  }
}
function scheduleHidePlaylistTooltip(){
  clearTimeout(playlistTooltipHideTimer);
  playlistTooltipHideTimer=setTimeout(()=>hidePlaylistTooltip(),80);
}
function hidePlaylistTooltip(){
  clearTimeout(playlistTooltipHideTimer);
  playlistTooltipHideTimer=0;
  playlistTooltipAnchorEl=null;
  detachPlaylistTooltipPointerWatch();
  if(playlistTooltipEl)playlistTooltipEl.classList.remove('show');
}
function showPlaylistDialog(options){
  closePlaylistDialog(false);
  const opts=options||{};
  playlistDialogEl=document.createElement('div');
  playlistDialogEl.className='playlist-dialog'+(opts.danger?' danger':'');
  const inputHtml=opts.input===false?'':'<input class="playlist-dialog-input" type="text" maxlength="40" autocomplete="off">';
  playlistDialogEl.innerHTML='<div class="playlist-dialog-card"><h3></h3><p></p>'+inputHtml+'<div class="playlist-dialog-actions"><button type="button" data-action="cancel">取消</button><button type="button" data-action="confirm">'+esc(opts.confirmText||'确认')+'</button></div></div>';
  const card=playlistDialogEl.querySelector('.playlist-dialog-card');
  const title=playlistDialogEl.querySelector('h3');
  const body=playlistDialogEl.querySelector('p');
  const input=playlistDialogEl.querySelector('input');
  if(title)title.textContent=opts.title||'';
  if(body)body.textContent=opts.message||'';
  if(input){input.value=opts.value||'';input.placeholder=opts.placeholder||'歌单名称'}
  playlistDialogEl.addEventListener('click',e=>{if(e.target===playlistDialogEl)closePlaylistDialog(true)});
  card.addEventListener('click',e=>e.stopPropagation());
  playlistDialogEl.querySelector('[data-action="cancel"]').onclick=()=>closePlaylistDialog(true);
  playlistDialogEl.querySelector('[data-action="confirm"]').onclick=()=>{
    const value=input?input.value:'';
    const cb=opts.onConfirm;
    playlistDialogEl.remove();
    playlistDialogEl=null;
    if(cb)cb(value);
  };
  playlistDialogEl._onCancel=opts.onCancel||null;
  songPicker.appendChild(playlistDialogEl);
  requestAnimationFrame(()=>playlistDialogEl.classList.add('show'));
  if(input){setTimeout(()=>{input.focus();input.select()},40);input.onkeydown=e=>{if(e.key==='Enter')playlistDialogEl.querySelector('[data-action="confirm"]').click();if(e.key==='Escape')closePlaylistDialog(true)}}
}
function closePlaylistDialog(cancelled){
  if(!playlistDialogEl)return;
  const onCancel=playlistDialogEl._onCancel;
  const el=playlistDialogEl;
  playlistDialogEl=null;
  el.classList.remove('show');
  setTimeout(()=>el.remove(),170);
  if(cancelled&&onCancel)setTimeout(()=>onCancel(),120);
}
function openRenamePlaylistDialog(id){
  const list=getPlaylistById(id);
  if(!list)return;
  showPlaylistDialog({
    title:'重命名歌单',
    message:'给这个歌单换一个更顺耳的名字。',
    value:playlistTitle(id),
    confirmText:'保存',
    onConfirm:value=>{
      const name=String(value||'').trim()||playlistTitle(id);
      list.name=name;
      savePlaylists();
      renderPlaylistRail();
      Player.notifyPlaylistChanged();
    }
  });
}
function createEmptyPlaylistFromRail(){
  const previousId=pickerPlaylistId;
  const list={id:makePlaylistId(),name:nextPlaylistDefaultName(),tracks:[],lastKey:''};
  playlists.push(list);
  savePlaylists();
  animatePlaylistSwitchTo(list.id,1);
  showPlaylistDialog({
    title:'新建歌单',
    message:'创建一个空歌单，可以稍后从搜索或导入添加歌曲。',
    value:list.name,
    confirmText:'创建',
    onConfirm:value=>{
      list.name=String(value||'').trim()||list.name;
      savePlaylists();
      renderPlaylistRail();
      Player.notifyPlaylistChanged();
    },
    onCancel:()=>{
      if(!list.tracks.length){
        const restoreId=getPlaylistById(previousId)?previousId:activePlaylistId;
        const idx=playlistIndexById(list.id);
        if(idx>=0)playlists.splice(idx,1);
        savePlaylists();
        const returnToPrevious=()=>{
          if(pickerPlaylistId===restoreId)buildPicker({center:centerForPlaylist(restoreId)});
          else animatePlaylistSwitchTo(restoreId,-1);
          Player.notifyPlaylistChanged();
        };
        if(playlistSwitching)setTimeout(returnToPrevious,580);
        else returnToPrevious();
      }
    }
  });
}
function openDeletePlaylistDialog(id){
  const list=getPlaylistById(id);
  if(!list||list.id===DEFAULT_PLAYLIST_ID)return;
  showPlaylistDialog({
    title:'删除歌单',
    message:'删除“'+playlistTitle(id)+'”？只会移除这个歌单里的引用，不会影响其他歌单仍在使用的缓存。',
    input:false,
    danger:true,
    confirmText:'删除',
    onConfirm:()=>deletePlaylist(id,true)
  });
}
function cleanupUnreferencedTrackAssets(track){
  if(!track||mediaStillReferenced(track))return;
  const key=track._key||playlistKey(track);
  if(key&&window.LyricsStore&&window.LyricsStore._cache)delete window.LyricsStore._cache[key];
  removeTrackProgress(track);
  if(track.source==='bilibili'&&window.BiliAssets){
    window.BiliAssets.remove(track.subtitleAssetKey).catch(()=>{});
    window.BiliAssets.remove(track.coverAssetKey).catch(()=>{});
  }
  if(track.cacheMediaId&&window.NetEase&&typeof window.NetEase.deleteCachedMedia==='function')window.NetEase.deleteCachedMedia(track.cacheMediaId).catch(()=>{});
}
function deletePlaylist(id,animated){
  if(animated){
    const item=playlistRailEl&&playlistRailEl.querySelector('.playlist-rail-item[data-id="'+CSS.escape(id)+'"]');
    if(item){item.classList.add('rail-removing');setTimeout(()=>deletePlaylist(id,false),190);return true;}
  }
  const index=playlistIndexById(id);
  const list=playlists[index];
  if(index<0||!list||list.id===DEFAULT_PLAYLIST_ID)return false;
  const removedTracks=list.tracks.slice();
  playlists.splice(index,1);
  const fallback=playlists[Math.max(0,Math.min(index,playlists.length-1))]||defaultPlaylist();
  if(pickerPlaylistId===id)pickerPlaylistId=fallback.id;
  if(activePlaylistId===id){
    activePlaylistId=fallback.id;
    materializeActivePlaylist();
    currentSongIdx=centerForPlaylist(activePlaylistId);
    if(hasTracks())switchSong(currentSongIdx);else setEmptyState(true);
  }
  savePlaylists();
  removedTracks.forEach(cleanupUnreferencedTrackAssets);
  buildPicker({center:centerForPlaylist(pickerPlaylistId)});
  Player.notifyPlaylistChanged();
  return true;
}
function reorderPlaylist(id,toIndex){
  const from=playlistIndexById(id);
  if(from<0)return;
  toIndex=Math.max(0,Math.min(toIndex,playlists.length-1));
  if(from===toIndex)return;
  const [item]=playlists.splice(from,1);
  playlists.splice(toIndex,0,item);
  savePlaylists();
  renderPlaylistRail();
}
function startPlaylistRailDrag(e,id){
  if(e.button!=null&&e.button!==0)return;
  e.preventDefault();
  const dots=playlistRailEl&&playlistRailEl.querySelector('.playlist-rail-dots');
  playlistRailDrag={id,startX:e.clientX,lastX:e.clientX,dragging:false,scrolling:false,targetIndex:playlistIndexById(id),pointerId:e.pointerId,dots,startScrollLeft:dots?dots.scrollLeft:0,holdTimer:0};
  playlistRailDrag.holdTimer=setTimeout(()=>{
    const drag=playlistRailDrag;
    if(!drag||drag.scrolling)return;
    drag.dragging=true;
    suppressRailClick=true;
    hidePlaylistTooltip();
    playlistRailEl&&playlistRailEl.classList.add('dragging');
  },260);
  window.addEventListener('pointermove',movePlaylistRailDrag,true);
  window.addEventListener('pointerup',endPlaylistRailDrag,true);
  window.addEventListener('pointercancel',endPlaylistRailDrag,true);
}
function movePlaylistRailDrag(e){
  if(!playlistRailDrag)return;
  const drag=playlistRailDrag;
  drag.lastX=e.clientX;
  const dx=e.clientX-drag.startX;
  if(!drag.dragging&&Math.abs(dx)>6){
    clearTimeout(drag.holdTimer);
    drag.holdTimer=0;
    drag.scrolling=true;
    suppressRailClick=true;
    hidePlaylistTooltip();
  }
  if(drag.scrolling&&!drag.dragging){
    if(drag.dots)drag.dots.scrollLeft=drag.startScrollLeft-dx;
    return;
  }
  if(!drag.dragging)return;
  const items=[...playlistRailEl.querySelectorAll('.playlist-rail-item')];
  let targetIndex=items.length-1;
  for(let i=0;i<items.length;i++){
    const rect=items[i].getBoundingClientRect();
    if(e.clientX<rect.left+rect.width/2){targetIndex=i;break;}
  }
  drag.targetIndex=targetIndex;
  const marker=playlistRailEl.querySelector('.playlist-rail-marker');
  const railRect=playlistRailEl.getBoundingClientRect();
  const ref=items[targetIndex];
  if(marker&&ref){
    marker.style.opacity='1';
    marker.style.transform='translateX('+(ref.getBoundingClientRect().left-railRect.left-4)+'px)';
  }
}
function endPlaylistRailDrag(){
  const drag=playlistRailDrag;
  if(!drag)return;
  clearTimeout(drag.holdTimer);
  window.removeEventListener('pointermove',movePlaylistRailDrag,true);
  window.removeEventListener('pointerup',endPlaylistRailDrag,true);
  window.removeEventListener('pointercancel',endPlaylistRailDrag,true);
  playlistRailDrag=null;
  playlistRailEl&&playlistRailEl.classList.remove('dragging');
  const marker=playlistRailEl&&playlistRailEl.querySelector('.playlist-rail-marker');
  if(marker)marker.style.opacity='0';
  if(drag.dragging)reorderPlaylist(drag.id,drag.targetIndex);
  setTimeout(()=>{suppressRailClick=false},80);
}
function playlistContainsKey(id,key){return tracksForPlaylist(id).some(song=>playlistKey(song)===key)}
function mediaStillReferenced(removed){
  if(!removed)return false;
  const key=playlistKey(removed);
  const cacheId=removed.cacheMediaId||'';
  const localId=removed.localMediaId||'';
  return playlists.some(list=>list.tracks.some(track=>{
    return playlistKey(track)===key||(cacheId&&track.cacheMediaId===cacheId)||(localId&&track.localMediaId===localId);
  }));
}
function removePlaylistIfEmpty(list){
  if(!list||list.id===DEFAULT_PLAYLIST_ID||list.tracks.length)return false;
  const index=playlistIndexById(list.id);
  if(index<0)return false;
  playlists.splice(index,1);
  const fallback=playlists[Math.max(0,Math.min(index,playlists.length-1))]||defaultPlaylist();
  if(activePlaylistId===list.id){activePlaylistId=fallback.id;materializeActivePlaylist();currentSongIdx=Math.min(currentSongIdx,Math.max(0,window.PLAYLIST.length-1))}
  if(pickerPlaylistId===list.id){pickerPlaylistId=fallback.id;pickerCenter=0}
  return true;
}
function setActivePlaylist(id,preferredKey){
  const list=getPlaylistById(id)||defaultPlaylist();
  activePlaylistId=list.id;
  materializeActivePlaylist();
  const key=preferredKey||list.lastKey||'';
  let idx=key?window.PLAYLIST.findIndex(song=>playlistKey(song)===key):-1;
  if(idx<0)idx=0;
  currentSongIdx=Math.max(0,Math.min(idx,Math.max(0,window.PLAYLIST.length-1)));
  savePlaylists();
}
const Player = {
  notifyPlaylistChanged() {
    shuffleBag=[];
    window.dispatchEvent(new CustomEvent('player:playlist-changed'));
  },
  addTrack(track) {
    const key = playlistKey(track);
    const target = targetPlaylistForAdd();
    if (playlistContainsKey(target.id, key)) {
      const index = tracksForPlaylist(target.id).findIndex(song => playlistKey(song) === key);
      return { index, added: false };
    }
    const entry = Object.assign({}, track, { _key: key });
    if (track.neteaseId && !entry.id) entry.id = track.neteaseId;
    if (track.qqId && !entry.id) entry.id = track.qqId;
    const normalized = normalizeAddedTrack(entry) || entry;
    const wasEmpty = !hasTracks();
    target.tracks.push(normalized);
    target.lastKey = key;
    savePlaylists();
    let index = tracksForPlaylist(target.id).findIndex(song => playlistKey(song) === key);
    if (target.id === activePlaylistId) {
      materializeActivePlaylist();
      index = window.PLAYLIST.findIndex(song => playlistKey(song) === key);
      if (wasEmpty) {
        setEmptyState(false);
        currentSongIdx = -1;
        switchSong(index);
      }
    }
    if (songPicker && songPicker.classList.contains('show')) {
      pickerPlaylistId = target.id;
      this.rebuildPicker({ center: Math.max(0, index) });
    }
    this.notifyPlaylistChanged();
    return { index: Math.max(0, index), added: true };
  },
  async removeTrack(index) {
    index = Number(index);
    const pickerVisible = !!(songPicker && songPicker.classList.contains('show'));
    const targetId = pickerVisible ? pickerPlaylistId : activePlaylistId;
    const list = getPlaylistById(targetId);
    if (!list) return false;
    const tracks = tracksForPlaylist(targetId);
    if (!Number.isInteger(index) || index < 0 || index >= tracks.length) return false;
    const removed = tracks[index];
    if (!isRemovableTrack(removed)) return false;
    const removedKey = removed._key || playlistKey(removed);
    const removingActivePlaylist = targetId === activePlaylistId;
    const removingCurrent = removingActivePlaylist && index === currentSongIdx;
    const oldPickerCenter = pickerCenter;
    if (list.id === DEFAULT_PLAYLIST_ID) {
      const userIndex = index - BUILTIN_TRACKS.length;
      if (userIndex < 0 || userIndex >= list.tracks.length) return false;
      list.tracks.splice(userIndex, 1);
    } else {
      list.tracks.splice(index, 1);
    }
    if (removedKey && window.LyricsStore && window.LyricsStore._cache && !mediaStillReferenced(removed)) {
      delete window.LyricsStore._cache[removedKey];
    }
    removeTrackProgress(removed);
    if (!mediaStillReferenced(removed)) cleanupUnreferencedTrackAssets(removed);
    if (removingActivePlaylist) {
      materializeActivePlaylist();
      if (index < currentSongIdx) currentSongIdx -= 1;
    }
    savePlaylists();
    const activeTracks = window.PLAYLIST || [];
    if (activeTracks.length) {
      const nextIndex = Math.min(index, activeTracks.length - 1);
      let nextPickerCenter = oldPickerCenter;
      if (index < oldPickerCenter) nextPickerCenter -= 1;
      else if (index === oldPickerCenter) nextPickerCenter = Math.min(index, Math.max(0, pickerTracks().length - 1));
      nextPickerCenter = Math.max(0, Math.min(nextPickerCenter, Math.max(0, pickerTracks().length - 1)));
      if (pickerVisible) {
        pickerCenter = nextPickerCenter;
        animatePickerRemoval(index, pickerCenter);
        renderPlaylistRail();
      }
      if (removingCurrent) {
        currentSongIdx = -1;
        switchSong(nextIndex);
      }
      saveProgress();
    } else {
      if (pickerVisible) buildPicker({center:0});
      if (removingActivePlaylist) {
        try{localStorage.removeItem(GLOBAL_PROGRESS_KEY)}catch(e){}
        setEmptyState(true);
      }
    }
    this.notifyPlaylistChanged();
    return true;
  },
  hasTrack(key) { return this.findIndexByKey(key) >= 0; },
  findIndexByKey(key) {
    const target = targetPlaylistForAdd();
    return tracksForPlaylist(target.id).findIndex(s => playlistKey(s) === key);
  },  async cacheTrack(index) {
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
    song._cacheProgress = 0;
    pulseCacheStart(song);
    startCacheProgress(song);
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
        mediaMid: song.mediaMid || song.media_mid || '',
        cover: song.cover || '',
      });
      song.cacheMediaId = result.mediaId;
      song.cachedAt = Date.now();
      song.cacheCover = !!result.cover;
      song.cacheLyrics = !!result.lyrics;
      song.audio = result.audio || cachedAudioUrl(result.mediaId);
      if (result.cover) song.cover = result.cover;
      if (window.LyricsStore && window.LyricsStore._cache) delete window.LyricsStore._cache[_lyricsKey(song)];
      clearCacheProgressTimer();
      song._cacheProgress = 1;
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
      clearCacheProgressTimer();
      delete song._caching;
      showCacheFailure(song);
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
  const key=progressKeyForSong(song);
  saveTrackProgress(song,safeTime);
  const list=getPlaylistById(activePlaylistId);
  if(list&&key){list.lastKey=key;savePlaylists()}
  try{localStorage.setItem(GLOBAL_PROGRESS_KEY,JSON.stringify({song:index,key:key,playlistId:activePlaylistId,time:safeTime}))}catch(e){}
}

function playbackDuration(){
  const d=audio.duration;
  return isFinite(d)&&d>0?d:0;
}
function setPlaybackPositionUi(time,duration){
  const t=Number(time)||0;
  const d=playbackDuration(duration);
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
  if(provider==='qq'&&(song.mediaMid||song.media_mid))url+='&media_mid='+encodeURIComponent(song.mediaMid||song.media_mid);
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
    const info=await NetEase.songUrl(id,getTrackStreamLevel(song),provider,true,{mediaMid:song.mediaMid||song.media_mid||''});
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
  if(songPicker.classList.contains('show')&&pickerPlaylistId===activePlaylistId){pickerCenter=currentSongIdx;updatePickerPosition(true)}
  const readyPromise=(async()=>{
    await ensureOnlineAudioReady(song);
    if(generation!==switchGeneration)return false;
    audio.src=song.audio;
    try{audio.load()}catch(e){}
    setTimeout(()=>{if(generation===switchGeneration)suppressProgressSave=false},120);
    if(seekTime>0){const _s=()=>{if(generation!==switchGeneration)return;audio.currentTime=seekTime;const nr=rowAt(seekTime);if(nr>=0){setLine(nr);highlightWords(seekTime)}const _d=playbackDuration(song.duration);if(isFinite(_d)&&_d>0){fill.style.width=Math.min(100,seekTime/_d*100)+"%";now.textContent=fmt(seekTime)}};if(audio.readyState>=1){_s()}else{audio.addEventListener("loadedmetadata",()=>{if(generation===switchGeneration)_s()},{once:true})}}
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
function renderPickerContent(trackEl,songs){
  trackEl.innerHTML='';
  if(!songs.length){
    const empty=document.createElement('div');
    empty.className='picker-empty-card';
    empty.innerHTML='<strong>歌单为空</strong><span>从搜索或导入添加歌曲</span><button type="button" class="picker-empty-add">添加歌曲</button>';
    const add=empty.querySelector('.picker-empty-add');
    if(add){
      add.addEventListener('mousedown',e=>e.stopPropagation());
      add.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
      add.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        if(window.SearchPanel&&typeof window.SearchPanel.show==='function')window.SearchPanel.show();
        else{
          const btn=document.getElementById('search-btn');
          if(btn)btn.click();
        }
      });
    }
    trackEl.appendChild(empty);
    return;
  }
  songs.forEach((song,i)=>{
    const div=document.createElement('div');
    div.className='picker-cover';
    div.dataset.idx=i;
    const img=document.createElement('img');
    img.src=song.cover||EMPTY_COVER_SRC;img.alt=song.title||'cover';
    div.appendChild(img);
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
    name.textContent=song.title||'Untitled';
    const by=document.createElement('div');
    by.className='pc-artist';
    by.textContent=song.artist||'';
    div.appendChild(name);
    div.appendChild(by);
    div.onclick=e=>{if(dragMoved)return;commitPickerSong(Number(div.dataset.idx));toggleQueue(false)};
    trackEl.appendChild(div);
  });
}
function layoutPickerTrack(trackEl,center,offset,animate){
  const cx=innerWidth/2;
  const cy=innerHeight/2;
  const covers=[...trackEl.querySelectorAll('.picker-cover')];
  const baseGap=COVER_W+60;
  const fadeRange=baseGap*0.4;
  const dragCenter=center-offset/baseGap;
  covers.forEach((el,i)=>{
    const rel=i-dragCenter;
    let posY=0;
    const dir=rel>=0?1:-1;
    const absRel=Math.abs(rel);
    for(let k=0;k<Math.floor(absRel);k++){
      const localScale=Math.max(.4,1-k*0.35);
      posY+=dir*baseGap*localScale;
    }
    const frac=absRel-Math.floor(absRel);
    if(frac>0){
      const d=Math.floor(absRel);
      const localScale=Math.max(.4,1-d*0.35);
      posY+=dir*baseGap*localScale*frac;
    }
    const elCenter=cy+posY;
    const dist=Math.abs(elCenter-cy);
    const scale=Math.max(.4,1-dist/800);
    const op=Math.max(.2,1-dist/600);
    el.style.left=cx+'px';
    el.style.top=elCenter+'px';
    el.style.transform='translate(-50%,-50%) scale('+scale+')';
    el.style.opacity=op;
    const titleOp=Math.max(0,1-dist/fadeRange);
    const name=el.querySelector('.pc-title');
    const by=el.querySelector('.pc-artist');
    if(name)name.style.opacity=titleOp;
    if(by)by.style.opacity=titleOp;
  });
}
function buildPicker(options){
  const requestedCenter = options && Number.isFinite(options.center) ? options.center : null;
  if(!titleEl){
    titleEl=document.querySelector('.title');
    artistEl=document.querySelector('.artist');
    titleParent=titleEl&&titleEl.parentNode;
    artistParent=artistEl&&artistEl.parentNode;
  }
  pickerTrack.className='picker-track';
  pickerTrack.style.transition='';
  pickerTrack.style.transform='';
  pickerTrack.style.opacity='';
  const songs=pickerTracks();
  renderPickerContent(pickerTrack,songs);
  pickerCenter=requestedCenter===null?Math.max(0,Math.min(currentSongIdx,Math.max(0,songs.length-1))):Math.max(0,Math.min(requestedCenter,Math.max(0,songs.length-1)));
  dragOffset=0;
  updatePickerPosition(false);
  renderPlaylistRail();
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
  Object.assign(ghost.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',minHeight:rect.height+'px',height:rect.height+'px',margin:'0',transform:'none',transformOrigin:'center',opacity:getComputedStyle(removedEl).opacity,pointerEvents:'none',zIndex:'35'});
  document.body.appendChild(ghost);
  removedEl.remove();
  [...pickerTrack.querySelectorAll('.picker-cover')].forEach((el,i)=>{el.dataset.idx=i});
  pickerCenter=Math.max(0,Math.min(nextCenter,Math.max(0,pickerTracks().length-1)));
  pickerTrack.classList.remove('dragging');
  requestAnimationFrame(()=>requestAnimationFrame(()=>updatePickerPosition(true)));
  const animation=ghost.animate([{opacity:Number(ghost.style.opacity)||1,transform:'scale(1)'},{opacity:0,transform:'scale(.82) translateY(10px)'}],{duration:240,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
  animation.finished.finally(()=>ghost.remove());
}
function updatePickerPosition(animate){
  layoutPickerTrack(pickerTrack,pickerCenter,dragOffset,animate);
  onPickerCenterChange();
}
function previewPickerColor(idx){
  const song=pickerTracks()[idx];
  if(!song||!window.__reloadCoverColors)return;
  const im=new Image();
  im.crossOrigin='anonymous';
  im.onload=()=>window.__reloadCoverColors(im.src);
  im.src=song.cover||EMPTY_COVER_SRC;
}
let lastPreview=-1;
function onPickerCenterChange(){
  const key=pickerPlaylistId+':'+pickerCenter;
  if(key!==lastPreview){lastPreview=key;previewPickerColor(pickerCenter)}
}
async function commitPickerSong(idx){
  const songs=pickerTracks();
  const song=songs[idx];
  if(!song)return;
  const shouldResume=running;
  if(pickerPlaylistId!==activePlaylistId){
    activePlaylistId=pickerPlaylistId;
    materializeActivePlaylist();
    idx=window.PLAYLIST.findIndex(item=>playlistKey(item)===playlistKey(song));
    currentSongIdx=-1;
    savePlaylists();
  }
  if(idx===currentSongIdx)return;
  const ready=await switchSong(idx);
  if(shouldResume&&ready)startPlaybackFlow();
}
function createPickerLayer(id){
  const layer=document.createElement('div');
  layer.className='picker-track playlist-preview-layer';
  const songs=tracksForPlaylist(id);
  const center=centerForPlaylist(id);
  renderPickerContent(layer,songs);
  layoutPickerTrack(layer,center,0,false);
  return{layer,center};
}
function clearPlaylistPreview(){
  if(songPicker)[...songPicker.querySelectorAll('.playlist-preview-layer')].forEach(layer=>layer.remove());
  playlistPreviewLayer=null;
  playlistDragDirection=0;
  playlistDragTargetId='';
}
function playlistNeighborId(direction){
  const ids=playlists.map(list=>list.id);
  let index=ids.indexOf(pickerPlaylistId);
  if(index<0)index=ids.indexOf(activePlaylistId);
  const next=index+(direction>=0?1:-1);
  return next>=0&&next<ids.length?ids[next]:'';
}
function preparePlaylistPreview(direction){
  direction=direction>=0?1:-1;
  const id=playlistNeighborId(direction);
  if(!id)return false;
  if(playlistPreviewLayer&&playlistDragTargetId===id)return true;
  clearPlaylistPreview();
  const created=createPickerLayer(id);
  playlistPreviewLayer=created.layer;
  playlistDragTargetId=id;
  playlistDragDirection=direction;
  playlistPreviewLayer.style.pointerEvents='none';
  songPicker.appendChild(playlistPreviewLayer);
  return true;
}
function translateAxisOf(el,axis){
  if(!el)return 0;
  const transform=getComputedStyle(el).transform;
  if(!transform||transform==='none')return 0;
  const match=transform.match(/matrix\(([^)]+)\)/);
  if(match){const parts=match[1].split(',').map(Number);return parts[axis==='x'?4:5]||0;}
  const match3d=transform.match(/matrix3d\(([^)]+)\)/);
  if(match3d){const parts=match3d[1].split(',').map(Number);return parts[axis==='x'?12:13]||0;}
  return 0;
}
function translateXOf(el){return translateAxisOf(el,'x')}
function translateYOf(el){return translateAxisOf(el,'y')}
function interruptPlaylistSwitchForDrag(pointerX){
  if(!playlistSwitching)return 0;
  clearTimeout(playlistSwitchTimer);
  playlistSwitchTimer=0;
  const currentX=translateXOf(pickerTrack);
  const direction=playlistSwitchDirection||((currentX<0)?1:-1);
  const w=Math.max(innerWidth,480);
  let layer=playlistPreviewLayer||songPicker.querySelector('.playlist-preview-layer');
  if(!layer&&playlistSwitchTargetId){
    const created=createPickerLayer(playlistSwitchTargetId);
    layer=created.layer;
    songPicker.appendChild(layer);
  }
  playlistPreviewLayer=layer||null;
  playlistDragTargetId=playlistSwitchTargetId||playlistDragTargetId||playlistNeighborId(direction);
  playlistDragDirection=direction;
  playlistSwitching=false;
  playlistSwitchTargetId='';
  playlistSwitchDirection=0;
  pickerTrack.style.transition='none';
  pickerTrack.style.transform='translateX('+currentX+'px)';
  pickerTrack.style.opacity=String(Math.max(.16,1-Math.abs(currentX)/w*.84));
  if(layer){
    const layerX=translateXOf(layer)||((direction>0?w:-w)+currentX);
    layer.style.transition='none';
    layer.style.transform='translateX('+layerX+'px)';
    layer.style.opacity=String(Math.min(1,Math.max(.3,Math.abs(currentX)/160)));
  }
  return currentX;
}
function cancelPlaylistSwitchAnimation(){
  if(!playlistSwitching&&!playlistSwitchTimer)return;
  if(playlistSwitchCancelFinish){playlistSwitchCancelFinish();playlistSwitchCancelFinish=null;}
  clearTimeout(playlistSwitchTimer);
  playlistSwitchTimer=0;
  playlistSwitching=false;
  playlistSwitchTargetId='';
  playlistSwitchDirection=0;
  clearPlaylistPreview();
  pickerTrack.style.transition='';
  pickerTrack.style.transform='';
  pickerTrack.style.opacity='';
  animatePlaylistRailTo(Math.max(0,playlistIndexById(pickerPlaylistId)),180);
}
function completePlaylistSwitch(id,center){
  const incoming=playlistPreviewLayer||songPicker.querySelector('.playlist-preview-layer');
  pickerPlaylistId=id;
  pickerCenter=center;
  playlistSwitching=false;
  playlistSwitchTimer=0;
  playlistSwitchTargetId='';
  playlistSwitchDirection=0;
  if(playlistSwitchCancelFinish){playlistSwitchCancelFinish();playlistSwitchCancelFinish=null;}
  if(incoming){
    const children=[...incoming.childNodes];
    pickerTrack.replaceChildren(...children);
    incoming.remove();
    playlistPreviewLayer=null;
    playlistDragDirection=0;
    playlistDragTargetId='';
    pickerTrack.className='picker-track';
    pickerTrack.style.transition='none';
    pickerTrack.style.transform='';
    pickerTrack.style.opacity='';
    dragOffset=0;
    layoutPickerTrack(pickerTrack,pickerCenter,0,false);
    onPickerCenterChange();
    requestAnimationFrame(()=>{pickerTrack.style.transition=''});
  }else{
    clearPlaylistPreview();
    buildPicker({center:pickerCenter});
  }
  const railIndex=Math.max(0,playlistIndexById(pickerPlaylistId));
  setPlaylistRailProgress(railIndex);
  ensurePlaylistRailItemVisible(railIndex,true);
  Player.notifyPlaylistChanged();
}
function schedulePlaylistSwitchFinish(layer,id,center,fallbackMs){
  if(playlistSwitchCancelFinish){playlistSwitchCancelFinish();playlistSwitchCancelFinish=null;}
  let finished=false;
  const finish=()=>{
    if(finished)return;
    finished=true;
    if(playlistSwitchTimer){clearTimeout(playlistSwitchTimer);playlistSwitchTimer=0;}
    layer&&layer.removeEventListener('transitionend',onEnd);
    playlistSwitchCancelFinish=null;
    requestAnimationFrame(()=>requestAnimationFrame(()=>completePlaylistSwitch(id,center)));
  };
  const onEnd=e=>{
    if(e.target===layer&&(!e.propertyName||e.propertyName==='transform'))finish();
  };
  if(layer)layer.addEventListener('transitionend',onEnd);
  playlistSwitchCancelFinish=()=>{
    layer&&layer.removeEventListener('transitionend',onEnd);
    if(playlistSwitchTimer){clearTimeout(playlistSwitchTimer);playlistSwitchTimer=0;}
    finished=true;
  };
  playlistSwitchTimer=setTimeout(finish,fallbackMs||760);
}
function animatePlaylistSwitchTo(id,direction){
  if(!id||id===pickerPlaylistId)return;
  if(playlistSwitching)cancelPlaylistSwitchAnimation();
  hidePlaylistTooltip();
  const list=getPlaylistById(id);
  if(!list)return;
  if(!songPicker.classList.contains('show')){
    pickerPlaylistId=id;
    buildPicker({center:centerForPlaylist(id)});
    Player.notifyPlaylistChanged();
    return;
  }
  playlistSwitching=true;
  playlistSwitchTargetId=id;
  direction=direction>=0?1:-1;
  playlistSwitchDirection=direction;
  clearPlaylistPreview();
  const created=createPickerLayer(id);
  const layer=created.layer;
  const w=Math.max(innerWidth,480);
  layer.style.transform='translateX('+(direction*w)+'px)';
  layer.style.opacity='.82';
  songPicker.appendChild(layer);
  pickerTrack.style.transition='transform .52s cubic-bezier(.16,.86,.18,1),opacity .32s ease';
  layer.style.transition='transform .52s cubic-bezier(.16,.86,.18,1),opacity .32s ease';
  animatePlaylistRailTo(Math.max(0,playlistIndexById(id)),520);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    pickerTrack.style.transform='translateX('+(-direction*w)+'px)';
    pickerTrack.style.opacity='.18';
    layer.style.transform='translateX(0)';
    layer.style.opacity='1';
  }));
  schedulePlaylistSwitchFinish(layer,id,created.center,820);
}
function switchPickerPlaylist(direction){
  const id=playlistNeighborId(direction);
  if(!id){
    animatePlaylistRailTo(Math.max(0,playlistIndexById(pickerPlaylistId)),120);
    return false;
  }
  animatePlaylistSwitchTo(id,direction);
  return true;
}
let dragStartX=0,dragStartY=0,lastDragX=0,lastDragY=0,dragOffset=0,dragMoved=false,dragging=false,dragAxis='';
let lastPlaylistWheel=0;
let playlistWheelUnlockTimer=0;
function onDragStart(x,y){const carryX=playlistSwitching?interruptPlaylistSwitchForDrag(x):0;hidePlaylistTooltip();dragging=true;dragMoved=false;dragStartX=x-carryX;dragStartY=y;lastDragX=x;lastDragY=y;dragOffset=0;dragAxis=carryX?'x':'';dragStartPlaylistIndex=playlistRailProgress;pickerTrack.classList.add('dragging')}
function onDragMove(x,y){
  if(!dragging)return;
  lastDragX=x;lastDragY=y;
  const dx=x-dragStartX,dy=y-dragStartY;
  if(!dragAxis&&Math.max(Math.abs(dx),Math.abs(dy))>10)dragAxis=Math.abs(dx)>=Math.abs(dy)?'x':'y';
  if(dragAxis==='x'){
    if(Math.abs(dx)>12)dragMoved=true;
    const direction=dx<0?1:-1;
    const hasTarget=preparePlaylistPreview(direction);
    const w=Math.max(innerWidth,480);
    const limited=hasTarget?Math.max(-w,Math.min(w,dx)):Math.max(-48,Math.min(48,dx*.24));
    pickerTrack.style.transition='none';
    pickerTrack.style.transform='translateX('+limited+'px)';
    const progress=Math.min(1,Math.abs(limited)/w);
    setPlaylistRailProgress(dragStartPlaylistIndex+(hasTarget?direction*progress:(limited/w)*.35));
    if(playlistPreviewLayer){
      playlistPreviewLayer.style.transition='none';
      playlistPreviewLayer.style.transform='translateX('+((direction>0?w:-w)+limited)+'px)';
      playlistPreviewLayer.style.opacity=String(Math.min(1,Math.max(.3,Math.abs(limited)/160)));
    }
    return;
  }
  dragOffset=dy;
  if(Math.abs(dragOffset)>5)dragMoved=true;
  updatePickerPosition(false);
}
function onDragEnd(e){
  if(!dragging)return;dragging=false;
  const point=e&&e.changedTouches&&e.changedTouches[0];
  const dx=(point?point.clientX:lastDragX)-dragStartX;
  const dy=(point?point.clientY:lastDragY)-dragStartY;
  if(dragAxis==='x'){
    const direction=dx<0?1:-1;
    const w=Math.max(innerWidth,480);
    const shouldSwitch=playlistPreviewLayer&&playlistDragTargetId&&Math.abs(dx)>72;
    pickerTrack.classList.remove('dragging');
    pickerTrack.style.transition='transform .42s cubic-bezier(.18,.9,.2,1),opacity .28s ease';
    if(playlistPreviewLayer)playlistPreviewLayer.style.transition='transform .42s cubic-bezier(.18,.9,.2,1),opacity .28s ease';
    if(shouldSwitch){
      playlistSwitching=true;
      const targetId=playlistDragTargetId;
      pickerTrack.style.transform='translateX('+(-direction*w)+'px)';
      pickerTrack.style.opacity='.16';
      playlistPreviewLayer.style.transform='translateX(0)';
      playlistPreviewLayer.style.opacity='1';
      animatePlaylistRailTo(Math.max(0,playlistIndexById(targetId)),420);
      schedulePlaylistSwitchFinish(playlistPreviewLayer,targetId,centerForPlaylist(targetId),680);
    }else{
      pickerTrack.style.transform='translateX(0)';
      pickerTrack.style.opacity='1';
      if(playlistPreviewLayer){
        playlistPreviewLayer.style.transform='translateX('+((direction>0?w:-w))+'px)';
        playlistPreviewLayer.style.opacity='0';
      }
      animatePlaylistRailTo(dragStartPlaylistIndex,260);
      setTimeout(()=>{clearPlaylistPreview();pickerTrack.style.transform='';pickerTrack.style.transition='';pickerTrack.style.opacity=''},440);
    }
    dragOffset=0;dragAxis='';
  }else{
    const songs=pickerTracks();
    const shift=Math.round(-dragOffset/(COVER_W+60));
    pickerCenter=Math.max(0,Math.min(Math.max(0,songs.length-1),pickerCenter+shift));
    pickerTrack.classList.remove('dragging');
    requestAnimationFrame(()=>{requestAnimationFrame(()=>{dragOffset=0;updatePickerPosition(true)})});
  }
  if(dragMoved){
    const blocker=e2=>{
      songPicker.removeEventListener('click',blocker,true);
      if(e2.target.closest('.picker-delete,.playlist-rail,.playlist-dialog,.playlist-floating-tip'))return;
      e2.stopPropagation();e2.preventDefault()
    };
    songPicker.addEventListener('click',blocker,true);
  }
  setTimeout(()=>{dragMoved=false;dragAxis=''},100);
}
songPicker.addEventListener('mousedown',e=>{if(e.target.closest('.playlist-rail,.playlist-dialog,.playlist-floating-tip'))return;onDragStart(e.clientX,e.clientY);e.preventDefault()});
addEventListener('mousemove',e=>onDragMove(e.clientX,e.clientY));
addEventListener('mouseup',e=>onDragEnd(e));
pickerTrack.addEventListener('touchstart',e=>{onDragStart(e.touches[0].clientX,e.touches[0].clientY)},{passive:true});
pickerTrack.addEventListener('touchmove',e=>{onDragMove(e.touches[0].clientX,e.touches[0].clientY);if(dragAxis)e.preventDefault()},{passive:false});
pickerTrack.addEventListener('touchend',e=>onDragEnd(e));
let lastSongWheel=0;
songPicker.addEventListener('wheel',e=>{
  if(!songPicker.classList.contains('show'))return;
  if(playlistSwitching)return;
  const absX=Math.abs(e.deltaX),absY=Math.abs(e.deltaY);
  if(absX>absY&&absX>=18){
    e.preventDefault();
    const direction=e.deltaX>0?1:-1;
    const id=playlistNeighborId(direction);
    if(!id){
      animatePlaylistRailTo(Math.max(0,playlistIndexById(pickerPlaylistId)),120);
      return;
    }
    const t=performance.now();
    if(t-lastPlaylistWheel<620)return;
    lastPlaylistWheel=t;
    clearTimeout(playlistWheelUnlockTimer);
    playlistWheelUnlockTimer=setTimeout(()=>{lastPlaylistWheel=0},700);
    animatePlaylistSwitchTo(id,direction);
    return;
  }
  if(absY>=18){
    e.preventDefault();
    const t=performance.now();
    if(t-lastSongWheel<160)return;
    lastSongWheel=t;
    const songs=pickerTracks();
    const direction=e.deltaY>0?1:-1;
    pickerCenter=Math.max(0,Math.min(Math.max(0,songs.length-1),pickerCenter+direction));
    dragOffset=0;
    updatePickerPosition(true);
  }
},{passive:false});
function toggleQueue(force){
  const show=force!==undefined?force:!songPicker.classList.contains('show');
  if(!show)closePlaylistDialog(true);
  songPicker.classList.toggle('show',show);
  document.querySelector('.app').classList.toggle('blurred',show);
  if(show){
    pickerPlaylistId=activePlaylistId;
    buildPicker({center:currentSongIdx});
    lastPreview=activePlaylistId+':'+currentSongIdx;
  }else{
    clearPlaylistPreview();
  }
}
queueBtn.onclick=e=>{triggerIcon(queueBtn);toggleQueue();e.stopPropagation()};
songPicker.addEventListener('click',e=>{
  if(!e.target.closest('.picker-cover,.playlist-rail,.playlist-dialog,.playlist-floating-tip')){
    commitPickerSong(pickerCenter);
    toggleQueue(false)
  }
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
  if(OFFLINE_RENDER_MODE)return;
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
  const d=playbackDuration();
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
      const info=await NetEase.songUrl(id,'standard',provider,false,{mediaMid:song.mediaMid||song.media_mid||''});
      if(!info||!info.playable)return false;
      song.audio=providerStreamUrl(provider,id,'standard',{mediaMid:song.mediaMid||song.media_mid||''});
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
    const info=await NetEase.songUrl(providerTrackId(song),level,provider,false,{mediaMid:song.mediaMid||song.media_mid||''});
    if(info&&info.playable)return fallbackMessage;
    return info&&info.reason?info.reason:fallbackMessage;
  }catch(e){
    return (e&&e.message)||fallbackMessage;
  }
}
// 每帧从真实音频读取时间，驱动进度条/时间文本/歌词行+逐词高亮
function tick(){if(OFFLINE_RENDER_MODE){requestAnimationFrame(tick);return}const t=pendingSeekTime!=null?pendingSeekTime:audio.currentTime,d=playbackDuration();updateBuffer();if(isFinite(d)&&d>0){fill.style.width=`${Math.min(100,Math.max(0,t)/d*100)}%`;now.textContent=fmt(t)}if(running&&isFinite(d)&&d>0){const newRow=rowAt(t);if(newRow!==active){clearWordHighlight(active);setLine(newRow);lastWordKey=''}highlightWords(t);const _tn=performance.now();if(_tn-lastSave>2000){lastSave=_tn;saveProgress()}}requestAnimationFrame(tick)}
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
let pendingSeekTime=null;
function hasMediaTime(){return audio.readyState>=1&&isFinite(currentSeekDuration())&&currentSeekDuration()>0}
function currentSeekDuration(){return playbackDuration()}
function applyPendingSeek(){if(pendingSeekTime==null||!isFinite(pendingSeekTime)||!hasMediaTime())return false;const d=currentSeekDuration();const target=Math.max(0,Math.min(pendingSeekTime,d));try{audio.currentTime=target;pendingSeekTime=null;return true}catch(e){return false}}
function applySeekTime(target,duration){pendingSeekTime=target;if(hasMediaTime())applyPendingSeek();fill.style.width=`${Math.min(100,Math.max(0,target/Math.max(duration,1)*100))}%`;now.textContent=fmt(target);const nr=rowAt(target);if(nr!==active){clearWordHighlight(active);setLine(nr)}lastWordKey='';highlightWords(target);const song=window.PLAYLIST&&window.PLAYLIST[currentSongIdx];if(song)saveProgressForSong(currentSongIdx,song,target)}
function seekToClientX(clientX){const d=currentSeekDuration();if(!isFinite(d)||d<=0)return;const r=track.getBoundingClientRect();const ratio=Math.max(0,Math.min(1,(clientX-r.left)/r.width));applySeekTime(ratio*d,d)}
track.addEventListener('mousedown',e=>{scrubbing=true;seekToClientX(e.clientX);e.preventDefault()});
addEventListener('mousemove',e=>{if(scrubbing)seekToClientX(e.clientX)});
addEventListener('mouseup',()=>{scrubbing=false});
track.addEventListener('touchstart',e=>{scrubbing=true;seekToClientX(e.touches[0].clientX)},{passive:true});
track.addEventListener('touchmove',e=>{if(scrubbing){seekToClientX(e.touches[0].clientX);e.preventDefault()}},{passive:false});
track.addEventListener('touchend',()=>{scrubbing=false});
// 总时长：loadedmetadata + durationchange 双保险，确保任意加载顺序下都显示
function updateTotal(){const d=playbackDuration();if(isFinite(d)&&d>0)total.textContent=fmt(d)}
audio.addEventListener('loadedmetadata',updateTotal);
audio.addEventListener('loadedmetadata',()=>{applyPendingSeek()});
audio.addEventListener('canplay',()=>{applyPendingSeek()});
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
let spectrumRAFId=null;
let androidSpectrumCache=null,androidSpectrumReadAt=0; // P0-81: 只允许一个 RAF 循环
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
function readAndroidSpectrum(){
  if(!window.__ANDROID_NATIVE_AUDIO__||!window.AndroidAudioNative||typeof window.AndroidAudioNative.spectrum!=='function')return null;
  const nowMs=performance.now();
  if(nowMs-androidSpectrumReadAt<33)return androidSpectrumCache;
  androidSpectrumReadAt=nowMs;
  try{
    const packet=JSON.parse(window.AndroidAudioNative.spectrum()||'{}');
    androidSpectrumCache=packet&&packet.ok&&Array.isArray(packet.values)?packet:null;
  }catch(e){androidSpectrumCache=null}
  return androidSpectrumCache;
}
function drawSpectrum(){
  if(OFFLINE_RENDER_MODE){spectrumRAFId=requestAnimationFrame(drawSpectrum);return}
  const androidSpectrum=readAndroidSpectrum();
  if(androidSpectrum&&androidSpectrum.values&&androidSpectrum.values.length){
    const values=androidSpectrum.values;
    const maxH=34;
    for(let i=0;i<BAR_COUNT;i++){
      const v=Number(values[Math.min(values.length-1,Math.floor(i*(values.length/BAR_COUNT)))])||0;
      bars[i].setProperty('--h',Math.min(35,3+Math.max(0,Math.min(1,v))*maxH).toFixed(1)+'px');
    }
  }else if(analyser&&freqData){
    analyser.getByteFrequencyData(freqData);
    const usable=80;
    const maxH=32;
    for(let i=0;i<BAR_COUNT;i++){
      const fi=Math.min(usable-1,Math.floor(i*(usable/BAR_COUNT)));
      const v=freqData[fi]/255;
      bars[i].setProperty('--h',(3+v*maxH)+'px');
    }
  }else{
    for(let i=0;i<BAR_COUNT;i++){
      const idle=4+Math.abs(Math.sin(i*.52)+Math.cos(i*.19))*3.2;
      bars[i].setProperty('--h',idle.toFixed(1)+'px');
    }
  }
  spectrumRAFId=requestAnimationFrame(drawSpectrum);
}
drawSpectrum(); // 唯一一次启动，整个生命周期复用
if(OFFLINE_RENDER_MODE){
  let renderLastTime=0,lyricPhysicsAccumulator=0;
  const lyricAnimationStarts=new Map();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const isLyricAnimation=animation=>{
    const target=animation&&animation.effect&&animation.effect.target;
    return !!(target&&(target===list||list.contains(target)));
  };
  const animationDuration=animation=>{
    const timing=animation.effect&&animation.effect.getComputedTiming?animation.effect.getComputedTiming():null;
    const duration=Number(timing&&timing.activeDuration);
    return Number.isFinite(duration)?Math.max(0,duration):Infinity;
  };
  const captureLyricAnimations=(time,settle=false)=>{
    void list.offsetHeight;
    for(const animation of document.getAnimations()){
      if(!isLyricAnimation(animation)||lyricAnimationStarts.has(animation))continue;
      try{
        animation.pause();
        const duration=animationDuration(animation);
        lyricAnimationStarts.set(animation,settle&&Number.isFinite(duration)?time-duration/1000:time);
        animation.currentTime=settle&&Number.isFinite(duration)?duration:0;
      }catch(e){}
    }
  };
  const syncLyricAnimations=time=>{
    captureLyricAnimations(time,false);
    for(const [animation,startTime] of lyricAnimationStarts){
      try{
        const duration=animationDuration(animation);
        const elapsed=Math.max(0,(time-startTime)*1000);
        animation.pause();
        animation.currentTime=Number.isFinite(duration)?Math.min(elapsed,duration):elapsed;
      }catch(e){lyricAnimationStarts.delete(animation)}
    }
    void list.offsetHeight;
  };
  const syncAnimations=time=>{
    const timelineMs=Math.max(0,Number(time)||0)*1000;
    for(const animation of document.getAnimations()){
      if(isLyricAnimation(animation))continue;
      try{
        animation.pause();
        const duration=animationDuration(animation);
        animation.currentTime=Number.isFinite(duration)?Math.min(timelineMs,duration):timelineMs;
      }catch(e){}
    }
    void document.documentElement.offsetHeight;
  };  const physicsStep=()=>{
    const diff=targetOffset-curOffset;
    const force=diff*STIFFNESS;
    vel=(vel+force)*DAMPING;
    let step=vel;
    if(Math.abs(diff)<120)step=diff*.18;
    else{const MAXV=55;if(step>MAXV)step=MAXV;else if(step<-MAXV)step=-MAXV}
    curOffset+=step;
    if(Math.abs(targetOffset-curOffset)<.3){curOffset=targetOffset;vel=0}
    else if((diff>0&&curOffset>targetOffset)||(diff<0&&curOffset<targetOffset)){curOffset=targetOffset;vel=0}
    list.style.transform=`translateY(${-curOffset}px)`;
  };
  window.__offlineRenderer={
    async ready(){
      const deadline=performance.now()+30000;
      while(performance.now()<deadline){
        const cover=document.querySelector('img.cover');
        const lyricsReady=data.length>0&&!String(data[0]?.en||'').includes('...');
        const coverReady=!cover||!cover.src||(cover.complete&&cover.naturalWidth>0);
        if(lyricsReady&&coverReady)break;
        await sleep(50);
      }
      if(document.fonts?.ready)await document.fonts.ready;
      const cover=document.querySelector('img.cover');
      if(cover&&cover.src&&(!cover.complete||cover.naturalWidth<=0)){
        const source=String(cover.currentSrc||cover.src||'').slice(0,180);
        throw new Error('封面未就绪: complete='+cover.complete+', naturalWidth='+cover.naturalWidth+', src='+source+', lyrics='+data.length);
      }
      if(cover?.decode){try{await cover.decode()}catch(error){if(cover.naturalWidth<=0)throw error}}
      if(cover&&cover.src&&(!cover.complete||cover.naturalWidth<=0))throw new Error('缓存封面加载失败，已停止渲染');
      syncAnimations(0);
      songPicker.classList.remove('show');
      document.querySelector('.app')?.classList.remove('blurred');
      if(eqOverlay)eqOverlay.classList.remove('show');
      running=true;setButton();
      return {duration:Number(window.PLAYLIST[currentSongIdx]?.duration)||0,title:window.PLAYLIST[currentSongIdx]?.title||''};
    },
    reset(time=0){
      renderLastTime=Math.max(0,Number(time)||0);
      lyricPhysicsAccumulator=0;
      lyricAnimationStarts.clear();
      const row=rowAt(renderLastTime);
      setLine(row);lastWordKey='';highlightWords(renderLastTime);
      curOffset=targetOffset;vel=0;list.style.transform=`translateY(${-curOffset}px)`;
      captureLyricAnimations(renderLastTime,true);
      syncAnimations(renderLastTime);syncLyricAnimations(renderLastTime);
    },
    renderFrame(time,spectrum){
      time=Math.max(0,Number(time)||0);
      const song=window.PLAYLIST[currentSongIdx]||{};
      const duration=Number(song.duration)||Number(audio.duration)||time+1;
      const nextRow=rowAt(time);
      if(nextRow!==active){clearWordHighlight(active);setLine(nextRow);lastWordKey=''}
      highlightWords(time);
      captureLyricAnimations(time,false);
      const elapsed=Math.max(0,time-renderLastTime);
      lyricPhysicsAccumulator+=elapsed*60;
      const steps=Math.min(120,Math.floor(lyricPhysicsAccumulator+1e-7));
      lyricPhysicsAccumulator-=steps;
      for(let i=0;i<steps;i++)physicsStep();
      renderLastTime=time;
      now.textContent=fmt(time);total.textContent=fmt(duration);
      fill.style.width=`${Math.min(100,time/duration*100)}%`;
      if(buffer)buffer.style.width='100%';
      const values=Array.isArray(spectrum)?spectrum:[];
      for(let i=0;i<BAR_COUNT;i++){
        const v=Number(values[Math.min(values.length-1,Math.floor(i*Math.max(1,values.length)/BAR_COUNT))])||0;
        bars[i].setProperty('--h',`${(3+Math.max(0,Math.min(1,v))*34).toFixed(1)}px`);
      }
      if(window.__silkRenderFrame)window.__silkRenderFrame(time);
      syncAnimations(time);syncLyricAnimations(time);
      return {time,row:active};
    }
  };
}updateEqUi();setEqOpen(false);updateModeButton(false);morphPlayIcon(false,true);setButton();requestAnimationFrame(tick);requestAnimationFrame(physicsTick);

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
  const t=pendingSeekTime!=null&&isFinite(pendingSeekTime)?pendingSeekTime:(audio.currentTime||0);
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
    const playlistId=typeof saved.playlistId==='string'?saved.playlistId:'';
    if(key){
      const idx=window.PLAYLIST.findIndex(item=>progressKeyForSong(item)===key);
      if(idx>=0)song=idx;
    }
    if(!isFinite(song)||song<0)song=0;
    if(!isFinite(time)||time<0)time=0;
    return{song,time,key,playlistId};
  }catch(e){ try{localStorage.removeItem(GLOBAL_PROGRESS_KEY)}catch(_){} return{song:0,time:0}; }
}
const saved=loadSavedProgress();
if(saved.playlistId&&getPlaylistById(saved.playlistId)){
  activePlaylistId=saved.playlistId;
  pickerPlaylistId=activePlaylistId;
  materializeActivePlaylist();
}
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
