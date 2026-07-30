'use strict';
const fs=require('fs');
const path=require('path');
const {spawn,spawnSync}=require('child_process');
const {once}=require('events');
const {chromium}=require('playwright');

function args(){const out={};for(let i=2;i<process.argv.length;i+=2)out[process.argv[i].replace(/^--/,'')]=process.argv[i+1];return out}
function event(value){process.stdout.write(JSON.stringify(value)+'\n')}
function fail(message){event({type:'error',message:String(message)});process.exitCode=1}
function probeDuration(path,ffprobe){const result=spawnSync(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',path],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw new Error((result.stderr||'ffprobe 无法读取音频时长').trim());const value=Number(result.stdout.trim());if(!Number.isFinite(value)||value<=0)throw new Error('缓存音频时长无效');return value}
function decodeAudio(path,ffmpeg){const result=spawnSync(ffmpeg,['-v','error','-i',path,'-vn','-ac','1','-ar','44100','-f','f32le','pipe:1'],{encoding:null,maxBuffer:768*1024*1024,windowsHide:true});if(result.status!==0)throw new Error(Buffer.from(result.stderr||'').toString('utf8')||'音频解码失败');return new Float32Array(result.stdout.buffer,result.stdout.byteOffset,Math.floor(result.stdout.byteLength/4))}
function fftMagnitudes(samples,center,bins=80){const n=256,re=new Float64Array(n),im=new Float64Array(n);for(let i=0;i<n;i++){const idx=center-n/2+i;const sample=idx>=0&&idx<samples.length?samples[idx]:0;re[i]=sample*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))}for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len;for(let i=0;i<n;i+=len){for(let j=0;j<len/2;j++){const c=Math.cos(angle*j),s=Math.sin(angle*j),ur=re[i+j],ui=im[i+j],vr=re[i+j+len/2]*c-im[i+j+len/2]*s,vi=re[i+j+len/2]*s+im[i+j+len/2]*c;re[i+j]=ur+vr;im[i+j]=ui+vi;re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi}}}const out=[];for(let i=0;i<bins;i++){const mag=Math.hypot(re[i],im[i])/n;out.push(Math.max(0,Math.min(1,(20*Math.log10(mag+1e-6)+62)/62)))}return out}
async function write(stream,buffer,onWait){if(stream.destroyed||stream.writableEnded)throw new Error('FFmpeg image pipe is closed');if(stream.write(buffer))return;let elapsed=0;const heartbeat=setInterval(()=>{elapsed+=5;onWait?.(elapsed)},5000);let timeout;try{await Promise.race([once(stream,'drain'),once(stream,'error').then(([error])=>{throw error}),once(stream,'close').then(()=>{throw new Error('FFmpeg image pipe closed early')}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('FFmpeg encoder pipe did not recover for 180 seconds')),180000)})])}finally{clearInterval(heartbeat);clearTimeout(timeout)}}

let activeBrowser=null,activeFfmpeg=null;
(async()=>{
 const a=args(),width=Number(a.width),height=Number(a.height),fps=Number(a.fps),start=Math.max(0,Number(a.start)||0),requested=a.duration?Number(a.duration):null,requestedEnd=a.end?Number(a.end):null;
 if(!a['base-url']||!a.audio||!a.output||!a['media-id']||!a['track-json'])throw new Error('渲染参数不完整');
 const duration=probeDuration(a.audio,a.ffprobe),end=Number.isFinite(requestedEnd)?Math.min(duration,requestedEnd):duration,available=end-start,clipDuration=Math.max(0,Math.min(requested||available,available));
 if(clipDuration<=0)throw new Error('开始位置已超过歌曲时长');
 const totalFrames=Math.max(1,Math.ceil(clipDuration*fps));
 const track=JSON.parse(a['track-json']);if(a.cover){const mime=String(track.coverMime||'image/jpeg').split(';')[0];track.cover='data:'+mime+';base64,'+fs.readFileSync(a.cover).toString('base64')}else{const fallback=path.join(__dirname,'..','build','icon.png');track.cover='data:image/png;base64,'+fs.readFileSync(fallback).toString('base64')}track.duration=duration;track.source=track.provider||'netease';track.id=track.songId;track._key=`${track.source}:${track.songId}`;track.audio=`/api/cache/media/${a['media-id']}/audio`;track.cover=track.cover||'/assets/app-icon.svg';track.cacheMediaId=a['media-id'];track.cacheCover=false;track.cacheLyrics=!!track.lyrics;
 event({type:'metadata',duration,clipDuration,totalFrames});event({type:'progress',stage:'解码音频频谱',frame:0,totalFrames,progress:1});
 const samples=decodeAudio(a.audio,a.ffmpeg),smoothed=new Array(80).fill(0);
 const browser=activeBrowser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--enable-webgl','--use-angle=d3d11','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:width/1920});
 await context.addInitScript(({track})=>{window.__OFFLINE_RENDER_MODE=true;localStorage.clear();localStorage.setItem('player_playlists_v1',JSON.stringify({version:1,activePlaylistId:'render',playlists:[{id:'render',name:'视频渲染',tracks:[track],lastKey:track._key}]}));localStorage.setItem('player_progress',JSON.stringify({song:0,key:track._key,playlistId:'render',time:0}));localStorage.setItem('player_track_progress',JSON.stringify({[track._key]:0}));},{track});
 const page=await context.newPage();
 page.on('console',msg=>{if(msg.type()==='error')process.stderr.write('[browser] '+msg.text()+'\n')});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===a['base-url'])route.continue();else route.abort()});
 event({type:'progress',stage:'加载播放器界面',frame:0,totalFrames,progress:3});
 await page.goto(a['base-url']+'/?render=1',{waitUntil:'domcontentloaded',timeout:30000});
 event({type:'progress',stage:'等待播放器脚本',frame:0,totalFrames,progress:3});
 await page.waitForFunction(()=>window.__offlineRenderer&&window.__silkRenderFrame,{timeout:30000});
 event({type:'progress',stage:'等待封面与歌词',frame:0,totalFrames,progress:4});
 await page.evaluate(()=>window.__offlineRenderer.ready());
 event({type:'progress',stage:'播放器资源就绪',frame:0,totalFrames,progress:5});
 await page.evaluate(t=>window.__offlineRenderer.reset(t),Math.max(0,start-2));
 for(let t=Math.max(0,start-2);t<start;t+=1/60)await page.evaluate(time=>window.__offlineRenderer.renderFrame(time,[]),t);
 const temp=a.output+'.part.mp4';
 const ffArgs=['-y','-v','error','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-ss',String(start),'-i',a.audio,'-t',String(clipDuration),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart',temp];
 const ff=activeFfmpeg=spawn(a.ffmpeg,ffArgs,{stdio:['pipe','ignore','pipe'],windowsHide:true});let ffError='';ff.stderr.on('data',chunk=>{ffError+=chunk.toString()});
 event({type:'progress',stage:'逐帧渲染',frame:0,totalFrames,progress:5});
 for(let frame=0;frame<totalFrames;frame++){
   const time=start+frame/fps,raw=fftMagnitudes(samples,Math.floor(time*44100));for(let i=0;i<smoothed.length;i++)smoothed[i]=smoothed[i]*.72+raw[i]*.28;
   event({type:'progress',stage:'设置第 '+(frame+1)+' 帧',frame,totalFrames,progress:5+frame/totalFrames*92});
   await page.evaluate(({time,values})=>window.__offlineRenderer.renderFrame(time,values),{time,values:smoothed});
   event({type:'progress',stage:'截取第 '+(frame+1)+' 帧',frame,totalFrames,progress:5+frame/totalFrames*92});
   const png=await page.screenshot({type:'jpeg',quality:95});
   event({type:'progress',stage:'写入第 '+(frame+1)+' 帧',frame,totalFrames,progress:5+frame/totalFrames*92});
   await write(ff.stdin,png,seconds=>event({type:'progress',stage:'FFmpeg encoding frame '+(frame+1)+' - waiting '+seconds+'s',frame,totalFrames,progress:5+frame/totalFrames*92}));
   if(frame%Math.max(1,Math.floor(fps/2))===0||frame===totalFrames-1)event({type:'progress',stage:'逐帧渲染',frame:frame+1,totalFrames,progress:5+(frame+1)/totalFrames*92});
 }
 ff.stdin.end();const [code]=await once(ff,'close');await browser.close();activeBrowser=null;if(code!==0)throw new Error(ffError.trim()||'FFmpeg 合成失败');
 fs.renameSync(temp,a.output);event({type:'progress',stage:'渲染完成',frame:totalFrames,totalFrames,progress:100});
})().catch(async error=>{if(activeFfmpeg&&activeFfmpeg.exitCode==null){try{activeFfmpeg.kill()}catch(e){}}if(activeBrowser){try{await activeBrowser.close()}catch(e){}}fail(error&&error.stack||error)});