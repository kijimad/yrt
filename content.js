(function () {
  'use strict';

  let panel = null;
  let video = null;
  let captions = [];
  let currentIndex = 0;
  let isActive = false;
  let looping = true;
  let pollTimer = null;
  let repeatCount = 0;
  let seekedAt = 0;

  // Parse YouTube's timedtext (srv3 format) XML
  function parseSrv3(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const paragraphs = doc.querySelectorAll('body p');
    const raw = [];
    paragraphs.forEach((p) => {
      const tMs = parseInt(p.getAttribute('t') || '0', 10);
      const dMs = parseInt(p.getAttribute('d') || '0', 10);
      const start = tMs / 1000;
      const end = (tMs + dMs) / 1000;
      const text = p.textContent.replace(/\n/g, ' ').trim();
      if (text && dMs > 0) {
        raw.push({ start, end, text });
      }
    });
    return mergeBySentence(raw);
  }

  // Merge raw segments so each group ends at a sentence boundary
  function mergeBySentence(raw) {
    if (!raw.length) return [];
    const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
    const MIN_DURATION = 3;
    const MAX_DURATION = 8;

    // Step 1: merge until sentence end, but force split at MAX_DURATION
    const merged = [];
    let current = { ...raw[0] };
    for (let i = 1; i < raw.length; i++) {
      const prev = raw[i - 1];
      const next = raw[i];
      const duration = next.end - current.start;
      if (sentenceEnd.test(prev.text) || duration > MAX_DURATION) {
        merged.push(current);
        current = { ...next };
      } else {
        current.end = next.end;
        current.text = current.text + ' ' + next.text;
      }
    }
    merged.push(current);

    // Step 2: merge short segments with the next one
    const result = [];
    let acc = { ...merged[0] };
    for (let i = 1; i < merged.length; i++) {
      if ((acc.end - acc.start) < MIN_DURATION) {
        acc.end = merged[i].end;
        acc.text = acc.text + ' ' + merged[i].text;
      } else {
        result.push(acc);
        acc = { ...merged[i] };
      }
    }
    result.push(acc);

    // Step 3: tighten end times — set each segment's end to the next segment's start
    // so loops don't play into the next caption's audio
    for (let i = 0; i < result.length - 1; i++) {
      result[i].end = result[i + 1].start;
    }

    return result;
  }

  // Request caption tracks from page.js (MAIN world) via postMessage
  function getCaptionTracks() {
    return new Promise((resolve) => {
      let resolved = false;

      function onMessage(e) {
        if (e.data && e.data.type === 'yrt-caption-tracks') {
          window.removeEventListener('message', onMessage);
          if (!resolved) {
            resolved = true;
            resolve(e.data.tracks);
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

  async function loadCaptions() {
    const tracks = await getCaptionTracks();
    if (!tracks || tracks.length === 0) return [];

    let track = tracks.find((t) => t.kind !== 'asr') || tracks[0];
    let url = track.baseUrl;
    url = url.replace(/([?&])fmt=[^&]*/, '$1fmt=srv3');
    if (!url.includes('fmt=')) {
      url += '&fmt=srv3';
    }

    try {
      const resp = await fetch(url);
      const text = await resp.text();
      return parseSrv3(text);
    } catch (e) {
      console.error('[YRT] Failed to fetch captions:', e);
      return [];
    }
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function createPanel() {
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

  function makeDraggable(el) {
    const header = el.querySelector('.yrt-header');
    let dragging = false, startX, startY, origX, origY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = origX + (e.clientX - startX) + 'px';
      el.style.top = origY + (e.clientY - startY) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function bindEvents() {
    document.getElementById('yrt-close').addEventListener('click', deactivate);

    document.getElementById('yrt-minimize').addEventListener('click', () => {
      panel.classList.toggle('yrt-minimized');
    });

    document.getElementById('yrt-next').addEventListener('click', () => {
      if (currentIndex < captions.length - 1) {
        currentIndex++;
        resetRepeatCount();
        seekToCaption(currentIndex);
      }
    });

    document.getElementById('yrt-prev').addEventListener('click', () => {
      if (currentIndex > 0) {
        currentIndex--;
        resetRepeatCount();
        seekToCaption(currentIndex);
      }
    });

    document.getElementById('yrt-toggle-loop').addEventListener('click', () => {
      looping = !looping;
      document.getElementById('yrt-toggle-loop').textContent = `Repeat: ${looping ? 'ON' : 'OFF'}`;
      document.getElementById('yrt-repeat-indicator').classList.toggle('yrt-hidden', !looping);
    });

    const speeds = [1, 0.75, 0.5, 0.25];
    let speedIdx = 0;
    document.getElementById('yrt-speed').addEventListener('click', () => {
      speedIdx = (speedIdx + 1) % speeds.length;
      const spd = speeds[speedIdx];
      video.playbackRate = spd;
      document.getElementById('yrt-speed').textContent = `${spd}x`;
    });

    document.addEventListener('keydown', handleKeydown);
  }

  function handleKeydown(e) {
    if (!isActive) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

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

  function seekToCaption(idx) {
    if (!video || !captions[idx]) return;
    const cap = captions[idx];
    video.currentTime = cap.start;
    seekedAt = Date.now();
    if (video.paused) video.play();
    updateDisplay();
  }

  function resetRepeatCount() {
    repeatCount = 0;
    const el = document.getElementById('yrt-repeat-count');
    if (el) el.textContent = '0';
  }

  function updateDisplay() {
    if (!captions.length) return;
    const cap = captions[currentIndex];
    document.getElementById('yrt-counter').textContent = `${currentIndex + 1} / ${captions.length}`;
    document.getElementById('yrt-time').textContent = `${formatTime(cap.start)} - ${formatTime(cap.end)}`;
    document.getElementById('yrt-prev').disabled = currentIndex === 0;
    document.getElementById('yrt-next').disabled = currentIndex === captions.length - 1;

    const prevEl = document.getElementById('yrt-caption-prev');
    const currEl = document.getElementById('yrt-caption-current');
    const nextEl = document.getElementById('yrt-caption-next');

    prevEl.textContent = currentIndex > 0 ? captions[currentIndex - 1].text : '';
    currEl.textContent = cap.text;
    nextEl.textContent = currentIndex < captions.length - 1 ? captions[currentIndex + 1].text : '';
  }

  function findCaptionIndex(time) {
    for (let i = 0; i < captions.length; i++) {
      if (time >= captions[i].start && time < captions[i].end) return i;
    }
    for (let i = 0; i < captions.length; i++) {
      if (captions[i].start > time) return i;
    }
    return captions.length - 1;
  }

  function pollPlayback() {
    if (!video || !isActive || !captions.length) return;

    const time = video.currentTime;
    const cap = captions[currentIndex];

    // Reached end of current segment
    if (time >= cap.end - 0.05) {
      if (looping) {
        repeatCount++;
        document.getElementById('yrt-repeat-count').textContent = repeatCount;
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
      const newIdx = findCaptionIndex(time);
      if (newIdx !== currentIndex) {
        currentIndex = newIdx;
        resetRepeatCount();
        updateDisplay();
      }
    }
  }

  async function activate() {
    video = document.querySelector('video');
    if (!video) return;

    captions = await loadCaptions();
    if (!captions.length) return;

    isActive = true;
    localStorage.setItem('yrt-active', '1');
    currentIndex = findCaptionIndex(video.currentTime);
    createPanel();
    updateDisplay();

    pollTimer = setInterval(pollPlayback, 100);
  }

  function deactivate() {
    isActive = false;
    localStorage.setItem('yrt-active', '0');
    if (pollTimer) clearInterval(pollTimer);
    if (panel) panel.remove();
    panel = null;
    document.removeEventListener('keydown', handleKeydown);
  }

  function injectButton() {
    const existing = document.getElementById('yrt-activate-btn');
    if (existing) return;

    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.id = 'yrt-activate-btn';
    btn.className = 'ytp-button';
    btn.title = 'Caption Repeater';
    btn.innerHTML = `<svg height="100%" viewBox="0 0 24 24" width="100%"><text x="4" y="18" font-size="14" fill="white" font-family="sans-serif" font-weight="bold">CC</text></svg>`;
    btn.style.cssText = 'opacity:0.8;cursor:pointer;';
    btn.addEventListener('click', () => {
      if (isActive) {
        deactivate();
      } else {
        activate();
      }
    });

    controls.prepend(btn);
  }

  function watchNavigation() {
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
          if (wasActive) activate();
        }, 2000);
      }
    });

    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    const waitForPlayer = setInterval(() => {
      if (document.querySelector('.ytp-right-controls')) {
        clearInterval(waitForPlayer);
        injectButton();
        watchNavigation();
        if (localStorage.getItem('yrt-active') === '1') {
          activate();
        }
      }
    }, 1000);
  }

  init();
})();
