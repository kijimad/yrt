declare const chrome: { runtime: { getURL: (path: string) => string } };

import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { parseSrv3, findCaptionIndex } from './captions.ts';
import type { Caption } from './captions.ts';
import { Panel } from './Panel.tsx';

interface CaptionResponse {
  tracks: { kind: string; baseUrl: string }[];
  xml: string;
}

let container: HTMLDivElement | null = null;
let reactRoot: Root | null = null;
let video: HTMLVideoElement | null = null;
let captions: Caption[] = [];
let isActive = false;

function requestCaptions(): Promise<CaptionResponse> {
  return new Promise((resolve) => {
    let resolved = false;

    function onMessage(e: MessageEvent): void {
      if (e.data && e.data.type === 'yrt-caption-tracks') {
        window.removeEventListener('message', onMessage);
        if (!resolved) {
          resolved = true;
          resolve({
            tracks: (e.data.tracks ?? []) as CaptionResponse['tracks'],
            xml: (e.data.xml ?? '') as string,
          });
        }
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'yrt-request-captions' }, '*');

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      if (!resolved) {
        resolved = true;
        resolve({ tracks: [], xml: '' });
      }
    }, 5000);
  });
}

function triggerCaptionLoad(): void {
  const ccBtn = document.querySelector('.ytp-subtitles-button') as HTMLButtonElement | null;
  if (ccBtn && ccBtn.getAttribute('aria-pressed') !== 'true') {
    ccBtn.click();
    setTimeout(() => {
      if (ccBtn.getAttribute('aria-pressed') === 'true') ccBtn.click();
    }, 500);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCaptions(): Promise<Caption[]> {
  let { tracks, xml } = await requestCaptions();
  console.log('[YRT] Caption tracks:', tracks.length, 'XML length:', xml.length);

  if (xml.length === 0 && tracks.length > 0) {
    console.log('[YRT] No intercepted XML yet, triggering caption load...');
    triggerCaptionLoad();
    await delay(2000);
    ({ tracks, xml } = await requestCaptions());
    console.log('[YRT] Retry — XML length:', xml.length);
  }

  if (xml.length > 0) {
    return parseSrv3(xml);
  }

  console.warn('[YRT] No caption XML captured');
  return [];
}

function renderPanel(): void {
  if (!container) {
    container = document.createElement('div');
    container.id = 'yrt-container';
    document.body.appendChild(container);
    reactRoot = createRoot(container);
  }

  reactRoot!.render(
    <Panel
      captions={captions}
      initialIndex={findCaptionIndex(captions, video!.currentTime)}
      video={video!}
      onClose={deactivate}
    />
  );
}

function unmountPanel(): void {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
}

async function activate(): Promise<void> {
  video = document.querySelector('video');
  if (!video) {
    console.warn('[YRT] No video element found');
    return;
  }

  captions = await loadCaptions();
  console.log('[YRT] Loaded captions:', captions.length);
  if (captions.length === 0) {
    console.warn('[YRT] No captions found — panel will not open');
    return;
  }

  isActive = true;
  localStorage.setItem('yrt-active', '1');
  renderPanel();
}

function deactivate(): void {
  isActive = false;
  localStorage.setItem('yrt-active', '0');
  unmountPanel();
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
        unmountPanel();
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
