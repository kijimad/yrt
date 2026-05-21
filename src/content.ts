declare const chrome: { runtime: { getURL: (path: string) => string } };

import { parseSrv3, formatTime, findCaptionIndex } from './captions.ts';
import type { Caption } from './captions.ts';

interface CaptionTrack {
  kind: string;
  baseUrl: string;
}

let panel: HTMLDivElement | null = null;
let video: HTMLVideoElement | null = null;
let captions: Caption[] = [];
let currentIndex = 0;
let isActive = false;
let looping = true;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let repeatCount = 0;
let seekedAt = 0;

function getCaptionTracks(): Promise<CaptionTrack[]> {
  return new Promise((resolve) => {
    let resolved = false;

    function onMessage(e: MessageEvent): void {
      if (e.data && e.data.type === 'yrt-caption-tracks') {
        window.removeEventListener('message', onMessage);
        if (!resolved) {
          resolved = true;
          resolve(e.data.tracks as CaptionTrack[]);
        }
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'yrt-request-captions' }, '*');

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      if (!resolved) {
        resolved = true;
        resolve([]);
      }
    }, 3000);
  });
}

async function loadCaptions(): Promise<Caption[]> {
  const tracks = await getCaptionTracks();
  if (!tracks || tracks.length === 0) return [];

  const track = tracks.find((t) => t.kind !== 'asr') ?? tracks[0]!;
  let url = track.baseUrl;
  url = url.replace(/([?&])fmt=[^&]*/, '$1fmt=srv3');
  if (!url.includes('fmt=')) {
    url += '&fmt=srv3';
  }

  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return parseSrv3(text);
  } catch (e: unknown) {
    console.error('[YRT] Failed to fetch captions:', e);
    return [];
  }
}

function createPanel(): void {
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'yrt-panel';
  panel.innerHTML = `
    <div class="yrt-header">
      <span class="yrt-title">Caption Repeater</span>
      <div class="yrt-header-controls">
        <button class="yrt-btn yrt-btn-minimize" id="yrt-minimize" title="Minimize">_</button>
        <button class="yrt-btn yrt-btn-close" id="yrt-close" title="Close">x</button>
      </div>
    </div>
    <div class="yrt-body">
      <div class="yrt-status-bar">
        <span id="yrt-counter">-</span>
        <span id="yrt-time">-</span>
      </div>
      <div class="yrt-captions">
        <div class="yrt-caption-row yrt-caption-prev" id="yrt-caption-prev"></div>
        <div class="yrt-caption-row yrt-caption-current" id="yrt-caption-current"></div>
        <div class="yrt-caption-row yrt-caption-next" id="yrt-caption-next"></div>
      </div>
      <div class="yrt-repeat-indicator" id="yrt-repeat-indicator">
        <span class="yrt-loop-icon">&#x21BB;</span> <span id="yrt-repeat-count">0</span>
      </div>
      <div class="yrt-controls">
        <button class="yrt-btn yrt-nav-btn" id="yrt-prev" title="Previous caption">&laquo; Prev</button>
        <button class="yrt-btn yrt-next-btn" id="yrt-next" title="Next caption">Next &raquo;</button>
      </div>
      <div class="yrt-controls yrt-controls-secondary">
        <button class="yrt-btn yrt-toggle-btn" id="yrt-toggle-loop" title="Toggle repeat">Repeat: ON</button>
        <button class="yrt-btn yrt-toggle-btn" id="yrt-speed" title="Playback speed">1x</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  makeDraggable(panel);
  bindEvents();
}

function makeDraggable(el: HTMLDivElement): void {
  const header = el.querySelector('.yrt-header') as HTMLElement;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  header.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    el.style.left = origX + (e.clientX - startX) + 'px';
    el.style.top = origY + (e.clientY - startY) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => { dragging = false; });
}

function bindEvents(): void {
  document.getElementById('yrt-close')!.addEventListener('click', deactivate);

  document.getElementById('yrt-minimize')!.addEventListener('click', () => {
    panel?.classList.toggle('yrt-minimized');
  });

  document.getElementById('yrt-next')!.addEventListener('click', () => {
    if (currentIndex < captions.length - 1) {
      currentIndex++;
      resetRepeatCount();
      seekToCaption(currentIndex);
    }
  });

  document.getElementById('yrt-prev')!.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      resetRepeatCount();
      seekToCaption(currentIndex);
    }
  });

  document.getElementById('yrt-toggle-loop')!.addEventListener('click', () => {
    looping = !looping;
    document.getElementById('yrt-toggle-loop')!.textContent = `Repeat: ${looping ? 'ON' : 'OFF'}`;
    document.getElementById('yrt-repeat-indicator')!.classList.toggle('yrt-hidden', !looping);
  });

  const speeds = [1, 0.75, 0.5, 0.25];
  let speedIdx = 0;
  document.getElementById('yrt-speed')!.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    const spd = speeds[speedIdx]!;
    video!.playbackRate = spd;
    document.getElementById('yrt-speed')!.textContent = `${String(spd)}x`;
  });

  document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e: KeyboardEvent): void {
  if (!isActive) return;
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

  if (e.key === 'ArrowRight' && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    if (currentIndex < captions.length - 1) {
      currentIndex++;
      resetRepeatCount();
      seekToCaption(currentIndex);
    }
  } else if (e.key === 'ArrowLeft' && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    if (currentIndex > 0) {
      currentIndex--;
      resetRepeatCount();
      seekToCaption(currentIndex);
    }
  } else if (e.key === 'r' || e.key === 'R') {
    if (!e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      seekToCaption(currentIndex);
    }
  }
}

function seekToCaption(idx: number): void {
  if (!video || !captions[idx]) return;
  const cap = captions[idx];
  video.currentTime = cap.start;
  seekedAt = Date.now();
  if (video.paused) void video.play();
  updateDisplay();
}

function resetRepeatCount(): void {
  repeatCount = 0;
  const el = document.getElementById('yrt-repeat-count');
  if (el) el.textContent = '0';
}

function updateDisplay(): void {
  if (captions.length === 0) return;
  const cap = captions[currentIndex]!;
  document.getElementById('yrt-counter')!.textContent = `${String(currentIndex + 1)} / ${String(captions.length)}`;
  document.getElementById('yrt-time')!.textContent = `${formatTime(cap.start)} - ${formatTime(cap.end)}`;
  (document.getElementById('yrt-prev') as HTMLButtonElement).disabled = currentIndex === 0;
  (document.getElementById('yrt-next') as HTMLButtonElement).disabled = currentIndex === captions.length - 1;

  document.getElementById('yrt-caption-prev')!.textContent = currentIndex > 0 ? captions[currentIndex - 1]!.text : '';
  document.getElementById('yrt-caption-current')!.textContent = cap.text;
  document.getElementById('yrt-caption-next')!.textContent = currentIndex < captions.length - 1 ? captions[currentIndex + 1]!.text : '';
}

function pollPlayback(): void {
  if (!video || !isActive || captions.length === 0) return;

  const time = video.currentTime;
  const cap = captions[currentIndex]!;

  // Reached end of current segment
  if (time >= cap.end - 0.05) {
    if (looping) {
      repeatCount++;
      document.getElementById('yrt-repeat-count')!.textContent = String(repeatCount);
      video.currentTime = cap.start;
      return;
    }
    // Not looping: advance to next
    if (currentIndex < captions.length - 1) {
      currentIndex++;
      resetRepeatCount();
      updateDisplay();
      return;
    }
  }

  // Sync: if time is outside current caption (manual seek, etc.)
  // Skip sync briefly after programmatic seek to avoid race condition
  if (Date.now() - seekedAt < 300) return;
  if (time < cap.start || time >= cap.end) {
    const newIdx = findCaptionIndex(captions, time);
    if (newIdx !== currentIndex) {
      currentIndex = newIdx;
      resetRepeatCount();
      updateDisplay();
    }
  }
}

async function activate(): Promise<void> {
  video = document.querySelector('video');
  if (!video) return;

  captions = await loadCaptions();
  if (captions.length === 0) return;

  isActive = true;
  localStorage.setItem('yrt-active', '1');
  currentIndex = findCaptionIndex(captions, video.currentTime);
  createPanel();
  updateDisplay();

  pollTimer = setInterval(pollPlayback, 100);
}

function deactivate(): void {
  isActive = false;
  localStorage.setItem('yrt-active', '0');
  if (pollTimer) clearInterval(pollTimer);
  if (panel) panel.remove();
  panel = null;
  document.removeEventListener('keydown', handleKeydown);
}

function injectButton(): void {
  const existing = document.getElementById('yrt-activate-btn');
  if (existing) return;

  const controls = document.querySelector('.ytp-right-controls');
  if (!controls) return;

  const btn = document.createElement('button');
  btn.id = 'yrt-activate-btn';
  btn.className = 'ytp-button';
  btn.title = 'Caption Repeater';
  btn.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width:24px;height:24px;" />`;
  btn.style.cssText = 'opacity:0.8;cursor:pointer;';
  btn.addEventListener('click', () => {
    if (isActive) {
      deactivate();
    } else {
      void activate();
    }
  });

  controls.prepend(btn);
}

function watchNavigation(): void {
  let lastUrl = location.href;

  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      const wasActive = isActive || localStorage.getItem('yrt-active') === '1';
      lastUrl = location.href;
      if (isActive) {
        isActive = false;
        if (pollTimer) clearInterval(pollTimer);
        if (panel) panel.remove();
        panel = null;
        document.removeEventListener('keydown', handleKeydown);
      }
      setTimeout(() => {
        injectButton();
        if (wasActive) void activate();
      }, 2000);
    }
  });

  navObserver.observe(document.body, { childList: true, subtree: true });
}

function init(): void {
  const waitForPlayer = setInterval(() => {
    if (document.querySelector('.ytp-right-controls')) {
      clearInterval(waitForPlayer);
      injectButton();
      watchNavigation();
      if (localStorage.getItem('yrt-active') === '1') {
        void activate();
      }
    }
  }, 1000);
}

init();
