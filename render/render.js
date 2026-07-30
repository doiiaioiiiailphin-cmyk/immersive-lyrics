(()=>{
const token=document.querySelector('meta[name="api-token"]')?.content||'';
const els={
  tracks:document.getElementById('tracks'),refresh:document.getElementById('refresh'),
  resolution:document.getElementById('resolution'),fps:document.getElementById('fps'),
  start:document.getElementById('start'),end:document.getElementById('end'),
  test:document.getElementById('test'),preview30:document.getElementById('preview30'),render:document.getElementById('render'),cancel:document.getElementById('cancel'),
  stage:document.getElementById('stage'),detail:document.getElementById('detail'),fill:document.getElementById('progress-fill'),errorLog:document.getElementById('error-log'),
  jobs:document.getElementById('jobs'),refreshJobs:document.getElementById('refresh-jobs'),toast:document.getElementById('toast')
};
let tracks=[],jobs=[],selected='',focusedJobId='',pollTimer=0;
const activeStatuses=new Set(['queued','running']);
const statusNames={queued:'等待中',running:'渲染中',complete:'已完成',failed:'失败',cancelled:'已取消'};

async function request(path,options={}){
  const headers=Object.assign({'X-Player-Token':token},options.headers||{});
  if(options.body&&!headers['Content-Type'])headers['Content-Type']='application/json';
  const res=await fetch(path,Object.assign({},options,{headers}));
  const body=await res.json().catch(()=>null);
  if(!res.ok||!body?.ok)throw new Error(body?.error?.message||`请求失败 (${res.status})`);
  return body.data;
}
function toast(message){els.toast.textContent=message;els.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove('show'),2300)}
function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function attr(value){return esc(value).replace(/`/g,'&#96;')}
function segment(root){root.addEventListener('click',event=>{const btn=event.target.closest('button');if(!btn||btn.disabled)return;root.querySelectorAll('button').forEach(item=>item.classList.toggle('selected',item===btn))})}
function value(root){return root.querySelector('.selected')?.dataset.value}
function parseTime(raw,optional=false){const text=String(raw??'').trim();if(!text&&optional)return null;if(!text)return NaN;const parts=text.split(':').map(Number);if(parts.length>2||parts.some(n=>!Number.isFinite(n)||n<0))return NaN;return parts.length===1?parts[0]:parts[0]*60+parts[1]}
function formatTime(seconds){if(seconds==null||!Number.isFinite(Number(seconds)))return '歌曲结束';const value=Math.max(0,Math.round(Number(seconds)));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}
function formatDate(timestamp){if(!timestamp)return '';return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(timestamp*1000))}
function formatBytes(bytes){const value=Number(bytes)||0;if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024/1024).toFixed(1)} MB`}

async function loadTracks(){
  els.tracks.innerHTML='<div class="empty">正在读取缓存...</div>';
  try{
    const data=await request('/api/render/tracks');tracks=data.tracks||[];
    if(!tracks.length){selected='';els.tracks.innerHTML='<div class="empty">还没有完整缓存的歌曲<br>请先回到播放器缓存歌曲</div>';return}
    if(!tracks.some(track=>track.mediaId===selected))selected=tracks[0].mediaId;
    renderTracks();
  }catch(error){els.tracks.innerHTML=`<div class="empty">${esc(error.message)}</div>`}
}
function renderTracks(){
  els.tracks.innerHTML=tracks.map(track=>`<button class="track${track.mediaId===selected?' selected':''}" data-id="${attr(track.mediaId)}"><img src="${attr(track.cover||'/assets/app-icon.svg')}" alt=""><span><strong>${esc(track.title)}</strong><span>${esc(track.artist)}</span></span><em>已缓存</em></button>`).join('');
  els.tracks.querySelectorAll('.track').forEach(btn=>btn.onclick=()=>{selected=btn.dataset.id;renderTracks()});
}

async function start(previewSeconds=0){
  if(!selected)return toast('请先选择一首已缓存歌曲');
  const startAt=parseTime(els.start.value),endAt=parseTime(els.end.value,true);
  if(!Number.isFinite(startAt))return toast('开始时间格式应为 分:秒');
  if(endAt!==null&&!Number.isFinite(endAt))return toast('结束时间格式应为 分:秒，或留空');
  if(endAt!==null&&endAt<=startAt)return toast('结束时间必须晚于开始时间');
  setBusy(true);resetSummary();
  try{
    const job=await request('/api/render/jobs',{method:'POST',body:JSON.stringify({mediaId:selected,resolution:value(els.resolution),fps:Number(value(els.fps)),test:previewSeconds>0,previewSeconds,start:startAt,end:endAt})});
    focusedJobId=job.id;updateSummary(job);await loadJobs(true);schedulePoll(500);
  }catch(error){setBusy(false);toast(error.message);await loadJobs(true)}
}
async function loadJobs(silent=false){
  try{
    const data=await request('/api/render/jobs');jobs=data.jobs||[];
    if(focusedJobId&&!jobs.some(job=>job.id===focusedJobId))focusedJobId='';
    const active=jobs.find(job=>activeStatuses.has(job.status));
    if(active&&!focusedJobId)focusedJobId=active.id;
    renderJobs();
    const focused=jobs.find(job=>job.id===focusedJobId)||active||jobs[0];
    if(focused)updateSummary(focused);else showIdleSummary();
    setBusy(Boolean(active));
    return Boolean(active);
  }catch(error){if(!silent)toast(error.message);return false}
}
function renderJobs(){
  if(!jobs.length){els.jobs.innerHTML='<div class="jobs-empty">还没有渲染任务</div>';return}
  els.jobs.innerHTML=jobs.map(job=>{
    const progress=Math.max(0,Math.min(100,Number(job.progress)||0));
    const range=`${formatTime(job.start)} - ${formatTime(job.end)}`;
    const frame=job.totalFrames?`${job.frame||0} / ${job.totalFrames} 帧`:(job.stage||statusNames[job.status]||'处理中');
    const action=activeStatuses.has(job.status)
      ?`<button class="job-cancel" data-cancel="${attr(job.id)}">取消</button>`
      :job.status==='complete'?`<a class="job-download" href="/api/render/output/${attr(job.id)}" download="${attr(job.outputName||'immersive-lyrics.mp4')}"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/></svg>下载</a>`:'';
    return `<article class="job job-${attr(job.status)}${job.id===focusedJobId?' focused':''}" data-focus="${attr(job.id)}"><div class="job-state"><i></i><span>${esc(statusNames[job.status]||job.status)}</span></div><div class="job-copy"><strong>${esc(job.title||'未命名歌曲')}</strong><span>${esc(job.resolution?.toUpperCase()||'')} · ${esc(job.fps||'')} FPS · ${esc(range)}</span><div class="job-progress"><i style="width:${progress}%"></i></div><small>${esc(frame)}${job.size?` · ${esc(formatBytes(job.size))}`:''}</small></div><time>${esc(formatDate(job.createdAt))}</time><div class="job-action">${action}</div></article>`;
  }).join('');
}
function updateSummary(job){
  focusedJobId=job.id;els.stage.textContent=job.stage||statusNames[job.status]||'处理中';
  els.fill.style.width=`${Math.max(0,Math.min(100,Number(job.progress)||0))}%`;
  const range=`${formatTime(job.start)} - ${formatTime(job.end)}`;
  els.detail.textContent=job.totalFrames?`${job.frame||0} / ${job.totalFrames} 帧 · ${job.width} × ${job.height} · ${job.fps} FPS · ${range}`:`${job.title||'渲染任务'} · ${range}`;
  els.errorLog.classList.toggle('hidden',!job.error);els.errorLog.textContent=job.error||'';
  els.cancel.classList.toggle('hidden',!activeStatuses.has(job.status));
  renderFocusedState();
}
function renderFocusedState(){els.jobs.querySelectorAll('.job').forEach(item=>item.classList.toggle('focused',item.dataset.focus===focusedJobId))}
function showIdleSummary(){els.stage.textContent='尚未开始';els.detail.textContent='设置起止位置后，可渲染测试片段或完整区间。';els.fill.style.width='0';els.errorLog.classList.add('hidden');els.errorLog.textContent='';els.cancel.classList.add('hidden')}
function setBusy(busy){els.test.disabled=busy;els.preview30.disabled=busy;els.render.disabled=busy;if(!busy&&!jobs.some(job=>activeStatuses.has(job.status)))els.cancel.classList.add('hidden')}
function resetSummary(){els.errorLog.classList.add('hidden');els.errorLog.textContent='';els.fill.style.width='0';els.stage.textContent='准备渲染';els.detail.textContent='正在锁定本地资源...'}
async function cancelJob(id){
  try{focusedJobId=id;const job=await request(`/api/render/jobs/${id}`,{method:'DELETE'});updateSummary(job);toast('任务已取消');await loadJobs(true)}catch(error){toast(error.message)}
}
function schedulePoll(delay){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{const active=await loadJobs(true);schedulePoll(active?650:4000)},delay)}

segment(els.resolution);segment(els.fps);
els.refresh.onclick=loadTracks;els.refreshJobs.onclick=()=>loadJobs();
els.test.onclick=()=>start(3);els.preview30.onclick=()=>start(30);els.render.onclick=()=>start(0);
els.cancel.onclick=()=>{const active=jobs.find(job=>job.id===focusedJobId&&activeStatuses.has(job.status))||jobs.find(job=>activeStatuses.has(job.status));if(active)cancelJob(active.id)};
els.jobs.addEventListener('click',event=>{const cancel=event.target.closest('[data-cancel]');if(cancel){event.stopPropagation();cancelJob(cancel.dataset.cancel);return}const item=event.target.closest('[data-focus]');if(item){focusedJobId=item.dataset.focus;const job=jobs.find(entry=>entry.id===focusedJobId);if(job)updateSummary(job)}});
Promise.all([loadTracks(),loadJobs()]).finally(()=>schedulePoll(1500));
})();