// window-titlebar.js - frameless Windows shell helpers
(function(){
  if(window.electronAPI)document.body.classList.add('desktop-shell');
  const trackEl=document.getElementById('window-track');
  const subEl=document.getElementById('window-subtitle');
  const maxButton=document.querySelector('[data-window-action="maximize"]');
  const restoreButton=document.querySelector('[data-window-action="restore"]');

  function readText(selector){
    const el=document.querySelector(selector);
    return el?String(el.textContent||'').trim():'';
  }

  function syncNowPlaying(){
    if(!trackEl||!subEl)return;
    const title=readText('.title');
    const artist=readText('.artist');
    trackEl.textContent=title&&title!=='歌单为空'?title:'沉浸歌词';
    subEl.textContent=artist||'准备播放';
  }

  function observe(selector){
    const el=document.querySelector(selector);
    if(!el)return;
    new MutationObserver(syncNowPlaying).observe(el,{childList:true,characterData:true,subtree:true});
  }

  async function callTauri(action){
    const tauriWindow=window.__TAURI__&&window.__TAURI__.window;
    if(!tauriWindow)return false;
    const appWindow=tauriWindow.getCurrentWindow?tauriWindow.getCurrentWindow():tauriWindow.appWindow;
    if(!appWindow)return false;
    if(action==='minimize'&&appWindow.minimize){await appWindow.minimize();return true}
    if(action==='maximize'&&appWindow.toggleMaximize){await appWindow.toggleMaximize();return true}
    if(action==='close'&&appWindow.close){await appWindow.close();return true}
    return false;
  }

  async function callElectron(action){
    const api=window.electronAPI||window.desktopWindow||window.windowControls;
    if(!api)return false;
    const names={
      minimize:['minimize','windowMinimize'],
      maximize:['maximize','windowMaximize'],
      restore:['restore','windowRestore','unmaximize','exitFullscreen'],
      close:['close','windowClose'],
    }[action]||[];
    for(const name of names){
      if(typeof api[name]==='function'){
        await api[name]();
        return true;
      }
    }
    return false;
  }

  async function handleWindowAction(action){
    try{
      if(await callElectron(action))return;
      if(await callTauri(action))return;
      if(action==='close')window.close();
    }catch(e){
      console.warn('[window-titlebar] action failed',action,e);
    }
  }

  function updateWindowState(state){
    const restore=!!(state&&(state.maximized||state.fullscreen));
    if(maxButton)maxButton.hidden=restore;
    if(restoreButton)restoreButton.hidden=!restore;
  }

  document.querySelectorAll('[data-window-action]').forEach(button=>{
    button.addEventListener('click',()=>handleWindowAction(button.dataset.windowAction));
  });

  if(window.electronAPI&&typeof window.electronAPI.onWindowState==='function'){
    window.electronAPI.onWindowState(updateWindowState);
  }

  syncNowPlaying();
  observe('.title');
  observe('.artist');
})();
