const shots = [
  {
    src: './assets/preview-player-happy.png',
    alt: 'Happy Birthday to You 播放界面真实截图',
    caption: '使用真实播放器截图展示 Happy Birthday to You、居中歌词和逐字高亮，不包含任何内置音频资源。'
  },
  {
    src: './assets/preview-login-real.png',
    alt: '已模糊二维码的网易云登录真实截图',
    caption: '网易云登录界面来自真实截图，二维码区域已做模糊处理，只保留界面观感。'
  },
  {
    src: './assets/preview-eq-real.png',
    alt: '均衡器与缓存界面真实截图',
    caption: '均衡器与缓存入口使用真实弹窗截图，保留播放器本身的玻璃质感。'
  }
];

const galleryImage = document.querySelector('#gallery-image');
const galleryCaption = document.querySelector('#gallery-caption');
const galleryTabs = Array.from(document.querySelectorAll('[data-shot]'));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileLayoutQuery = window.matchMedia('(max-width: 760px)');

function setupMobileNavHost() {
  const nav = document.querySelector('.nav');
  const headerLeft = document.querySelector('.header-left');
  const brand = document.querySelector('.brand');
  if (!nav || !headerLeft || !brand) return;

  const moveNav = () => {
    if (mobileLayoutQuery.matches) {
      if (nav.parentElement !== document.body) {
        document.body.appendChild(nav);
      }
    } else if (nav.parentElement !== headerLeft) {
      brand.insertAdjacentElement('afterend', nav);
    }
  };

  moveNav();
  if (mobileLayoutQuery.addEventListener) {
    mobileLayoutQuery.addEventListener('change', moveNav);
  } else {
    mobileLayoutQuery.addListener(moveNav);
  }
}

function setupPlatformClasses() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const data = navigator.userAgentData;
  const uaHint = ua.toLowerCase();
  const fallbackHint = `${data && data.platform ? data.platform : ''} ${platform}`.toLowerCase();
  const uaHasPlatform = /iphone|ipad|ipod|android|macintosh|mac os x|windows|linux|x11/.test(uaHint);
  const isIphone = /iphone|ipod/.test(uaHint);
  const isAndroid = /android/.test(uaHint);
  const isIpad = /ipad/.test(uaHint) || (!isIphone && !isAndroid && /macintosh|mac os x/.test(uaHint) && /mobile/.test(uaHint) && navigator.maxTouchPoints > 1);
  const isMac = !isIpad && !isAndroid && !isIphone && (/macintosh|mac os x/.test(uaHint) || (!uaHasPlatform && /mac/.test(fallbackHint)));
  const isWindows = !isMac && !isIpad && !isIphone && !isAndroid && (/windows|win64|win32|wow64/.test(uaHint) || (!uaHasPlatform && /win/.test(fallbackHint)));
  const isLinux = !isAndroid && !isWindows && !isMac && !isIpad && !isIphone && (/linux|x11/.test(uaHint) || (!uaHasPlatform && /linux/.test(fallbackHint)));
  const isFirefox = /firefox|fxios/.test(uaHint);
  const isSafari = /safari/.test(uaHint) && !/chrome|chromium|crios|edg\//.test(uaHint);
  const isMobile = isIphone || isIpad || isAndroid || /mobile/.test(uaHint);

  document.body.classList.toggle('ua-iphone', isIphone);
  document.body.classList.toggle('ua-ipad', isIpad);
  document.body.classList.toggle('ua-android', isAndroid);
  document.body.classList.toggle('ua-mac', isMac);
  document.body.classList.toggle('ua-windows', isWindows);
  document.body.classList.toggle('ua-linux', isLinux);
  document.body.classList.toggle('ua-firefox', isFirefox);
  document.body.classList.toggle('ua-safari', isSafari);
  document.body.classList.toggle('is-mobile-ua', isMobile);
  document.body.classList.toggle('is-touch-ua', isMobile || navigator.maxTouchPoints > 0);
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);

  const platformName =
    isIphone ? 'iPhone' :
    isIpad ? 'iPad' :
    isAndroid ? 'Android' :
    isMac ? 'macOS' :
    isWindows ? 'Windows' :
    isLinux ? (isFirefox ? 'Linux Firefox' : 'Linux') :
    'Desktop';
  document.body.dataset.platform = platformName;

  function updateViewportVars() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    if (window.visualViewport) {
      const viewport = window.visualViewport;
      const bottomInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--visual-bottom-offset', `${bottomInset}px`);
    } else {
      document.documentElement.style.setProperty('--visual-bottom-offset', '0px');
    }
  }

  updateViewportVars();
  window.addEventListener('resize', updateViewportVars, { passive: true });
  window.addEventListener('orientationchange', updateViewportVars, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportVars, { passive: true });
    window.visualViewport.addEventListener('scroll', updateViewportVars, { passive: true });
  }
}

function setupHeroMotion() {
  const title = document.querySelector('#hero-title');
  if (mobileLayoutQuery.matches) {
    if (title) title.dataset.motionReady = 'mobile-static';
    document.body.classList.add('motion-ready');
    requestAnimationFrame(() => {
      window.setTimeout(() => document.body.classList.add('hero-played', 'hero-motion-done'), 80);
    });
    return;
  }

  if (reduceMotion) {
    document.body.classList.add('hero-played', 'hero-motion-done');
    return;
  }

  document.body.classList.add('motion-ready');

  if (title && !title.dataset.motionReady) {
    const text = title.textContent.trim();
    const directions = [
      { x: '-42px', y: '0px', r: '-7deg', clip: 'inset(0 100% 0 0)' },
      { x: '0px', y: '-52px', r: '4deg', clip: 'inset(0 0 100% 0)' },
      { x: '46px', y: '0px', r: '8deg', clip: 'inset(0 0 0 100%)' },
      { x: '0px', y: '54px', r: '-5deg', clip: 'inset(100% 0 0 0)' }
    ];
    title.textContent = '';
    Array.from(text).forEach((char, index) => {
      const span = document.createElement('span');
      const direction = directions[index % directions.length];
      span.className = 'hero-char';
      span.textContent = char;
      span.dataset.char = char;
      span.style.setProperty('--start-x', direction.x);
      span.style.setProperty('--start-y', direction.y);
      span.style.setProperty('--start-rotate', direction.r);
      span.style.setProperty('--reveal-from', direction.clip);
      span.style.setProperty('--delay', `${index * 92}ms`);
      title.appendChild(span);
    });
    title.dataset.motionReady = 'true';
  }

  requestAnimationFrame(() => {
    window.setTimeout(() => document.body.classList.add('hero-played'), 80);
    window.setTimeout(() => document.body.classList.add('hero-motion-done'), 2100);
  });
}

function setupAmbientPointer() {
  let frame = 0;
  let targetX = 50;
  let targetY = 42;

  const apply = () => {
    frame = 0;
    document.body.style.setProperty('--mx', `${targetX}%`);
    document.body.style.setProperty('--my', `${targetY}%`);
  };

  window.addEventListener('pointermove', (event) => {
    targetX = Math.max(0, Math.min(100, event.clientX / Math.max(1, window.innerWidth) * 100));
    targetY = Math.max(0, Math.min(100, event.clientY / Math.max(1, window.innerHeight) * 100));
    if (!frame) frame = requestAnimationFrame(apply);
    revealNearPointer(event.clientX, event.clientY);
  }, { passive: true });
}

function setupCustomScrollbar() {
  const bar = document.createElement('div');
  const thumb = document.createElement('div');
  bar.className = 'custom-scrollbar';
  thumb.className = 'custom-scrollbar-thumb';
  bar.setAttribute('aria-hidden', 'true');
  bar.appendChild(thumb);
  document.body.appendChild(bar);

  let dragging = false;
  let dragOffset = 0;
  let frame = 0;

  function metrics() {
    const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const viewport = window.innerHeight;
    const maxScroll = Math.max(1, scrollHeight - viewport);
    const rect = bar.getBoundingClientRect();
    const thumbHeight = Math.max(46, rect.height * Math.min(1, viewport / scrollHeight));
    const maxTop = Math.max(1, rect.height - thumbHeight);
    return { maxScroll, rect, thumbHeight, maxTop };
  }

  function update() {
    frame = 0;
    const { maxScroll, thumbHeight, maxTop } = metrics();
    const ratio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translate3d(0, ${ratio * maxTop}px, 0)`;
    bar.style.display = maxScroll <= 1 ? 'none' : '';
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function scrollToClientY(clientY) {
    const { maxScroll, rect, thumbHeight, maxTop } = metrics();
    const y = Math.max(0, Math.min(maxTop, clientY - rect.top - dragOffset));
    window.scrollTo({ top: (y / maxTop) * maxScroll, behavior: dragging ? 'auto' : 'smooth' });
  }

  bar.addEventListener('pointerdown', (event) => {
    const rect = thumb.getBoundingClientRect();
    dragging = true;
    bar.classList.add('dragging');
    dragOffset = event.target === thumb ? event.clientY - rect.top : rect.height / 2;
    bar.setPointerCapture(event.pointerId);
    scrollToClientY(event.clientY);
    event.preventDefault();
  });

  bar.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    scrollToClientY(event.clientY);
  });

  bar.addEventListener('pointerup', (event) => {
    dragging = false;
    dragOffset = 0;
    bar.classList.remove('dragging');
    try { bar.releasePointerCapture(event.pointerId); } catch (e) {}
  });

  bar.addEventListener('pointercancel', () => {
    dragging = false;
    dragOffset = 0;
    bar.classList.remove('dragging');
  });

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  update();
}

galleryTabs.forEach((button) => {
  button.addEventListener('click', () => {
    const shot = shots[Number(button.dataset.shot)];
    if (!shot) return;

    galleryTabs.forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    });

    galleryImage.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(.985)' }
      ],
      { duration: 140, easing: 'ease-out' }
    ).finished.then(() => {
      galleryImage.src = shot.src;
      galleryImage.alt = shot.alt;
      galleryCaption.textContent = shot.caption;
      galleryImage.animate(
        [
          { opacity: 0, transform: 'scale(1.012)' },
          { opacity: 1, transform: 'scale(1)' }
        ],
        { duration: 220, easing: 'ease-out' }
      );
    });
  });
});

const revealGroups = [
  ['.marquee-strip', 'strip', 0],
  ['#sources .section-copy', 'arc-left', 0],
  ['.source-board article', 'spring-card', 110],
  ['#experience .section-heading', 'arc-left', 0],
  ['.feature-grid article', 'spring-card', 95],
  ['#gallery .section-heading', 'arc-left', 0],
  ['.gallery-tabs button', 'arc-right', 78],
  ['.gallery-frame', 'scale', 160],
  ['.privacy-panel', 'arc-left', 0],
  ['.privacy-cards article', 'arc-right', 105],
  ['.download', 'scale', 0]
];

const revealTargets = [];
revealGroups.forEach(([selector, type, step]) => {
  document.querySelectorAll(selector).forEach((item, index) => {
    item.setAttribute('data-reveal', type);
    item.style.setProperty('--reveal-delay', `${index * step}ms`);
    if (type === 'spring-card') {
      item.style.setProperty('--curve-x', `${index % 2 ? 26 : -26}px`);
      item.style.setProperty('--curve-r', `${index % 2 ? 2.2 : -2.2}deg`);
    }
    revealTargets.push(item);
  });
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealTargets.forEach((item) => observer.observe(item));
} else {
  revealTargets.forEach((item) => item.classList.add('is-visible'));
}

function revealNearPointer(clientX, clientY) {
  if (reduceMotion) return;
  revealTargets.forEach((item) => {
    if (item.classList.contains('is-visible')) return;
    const rect = item.getBoundingClientRect();
    const marginX = Math.max(90, Math.min(220, rect.width * .28));
    const marginY = Math.max(70, Math.min(180, rect.height * .42));
    const near =
      clientX >= rect.left - marginX &&
      clientX <= rect.right + marginX &&
      clientY >= rect.top - marginY &&
      clientY <= rect.bottom + marginY;
    if (near) item.classList.add('is-visible');
  });
}

const motionCards = Array.from(document.querySelectorAll(
  '.source-board article, .feature-grid article, .privacy-cards article, .gallery-frame, .download'
));

motionCards.forEach((card) => {
  card.addEventListener('pointermove', (event) => {
    if (reduceMotion) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) / Math.max(1, rect.height);
    card.style.setProperty('--spot-x', `${Math.max(0, Math.min(100, x * 100))}%`);
    card.style.setProperty('--spot-y', `${Math.max(0, Math.min(100, y * 100))}%`);
    card.style.setProperty('--tilt-x', `${(x - .5) * 8.2}deg`);
    card.style.setProperty('--tilt-y', `${(y - .5) * -7.4}deg`);
  }, { passive: true });

  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--tilt-x', '0deg');
    card.style.setProperty('--tilt-y', '0deg');
  }, { passive: true });
});

const activeSections = Array.from(document.querySelectorAll('.section, .download'));
let activeFrame = 0;
function updateActiveSections() {
  activeFrame = 0;
  const line = window.innerHeight * .24;
  let best = null;
  let bestDistance = Infinity;
  const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80;
  if (nearBottom) {
    best = document.querySelector('#download');
  }
  if (!best) {
    activeSections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const visible = rect.bottom > window.innerHeight * .12 && rect.top < window.innerHeight * .88;
      if (!visible) return;
      const distance = Math.abs(rect.top - line);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = section;
      }
    });
  }
  activeSections.forEach((section) => section.classList.toggle('section-active', section === best));
}

function scheduleActiveSections() {
  if (!activeFrame) activeFrame = requestAnimationFrame(updateActiveSections);
}

if ('IntersectionObserver' in window) {
  const activeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) scheduleActiveSections();
    });
  }, { threshold: 0.18, rootMargin: '-12% 0px -18% 0px' });

  activeSections.forEach((section) => activeObserver.observe(section));
}
window.addEventListener('scroll', scheduleActiveSections, { passive: true });
window.addEventListener('resize', scheduleActiveSections, { passive: true });
scheduleActiveSections();

const downloadLink = document.querySelector('.download-box .primary-action');
if (downloadLink && location.protocol === 'file:') {
  downloadLink.addEventListener('click', () => {
    downloadLink.textContent = '正在打开安装包';
    window.setTimeout(() => {
      downloadLink.textContent = '下载无内置音乐版';
    }, 1800);
  });
}

setupPlatformClasses();
setupMobileNavHost();
setupHeroMotion();
setupAmbientPointer();
setupCustomScrollbar();
