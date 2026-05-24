import { ok, err, type Result } from 'neverthrow';
import type { CaptionTrack, CaptionTracksResponse } from './messages.ts';
import { isYrtMessage } from './messages.ts';

export {};

declare global {
  interface Window {
    ytInitialPlayerResponse?: {
      captions?: {
        playerCaptionsTracklistRenderer: {
          captionTracks: CaptionTrack[];
        };
      };
    };
  }
}

interface MoviePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer: {
      captionTracks: CaptionTrack[];
    };
  };
}

interface MoviePlayer extends HTMLElement {
  getPlayerResponse: () => MoviePlayerResponse;
}

function isMoviePlayer(el: HTMLElement): el is MoviePlayer {
  return 'getPlayerResponse' in el;
}

interface YrtXHR extends XMLHttpRequest {
  _yrtUrl?: string;
}

// Intercept fetch to capture YouTube's own caption responses
let capturedXml = '';

const originalFetch = window.fetch;
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const req = args[0];
  const url = typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;

  const resp = await originalFetch.apply(this, args);

  if (url.includes('timedtext') || url.includes('api/timedtext')) {
    try {
      const clone = resp.clone();
      const text = await clone.text();
      if (text.length > 0 && (text.includes('<body>') || text.includes('<p '))) {
        capturedXml = text;
        console.log('[YRT page.js] Intercepted caption XML from fetch, length:', text.length);
      }
    } catch (e: unknown) {
      console.log('[YRT page.js] Failed to read intercepted response:', e);
    }
  }

  return resp;
};

// Also intercept XMLHttpRequest for older YouTube player paths
// Use descriptors to capture originals without triggering unbound-method
const xhrProto = XMLHttpRequest.prototype;
const openDescriptor = Object.getOwnPropertyDescriptor(xhrProto, 'open');
const sendDescriptor = Object.getOwnPropertyDescriptor(xhrProto, 'send');
const originalOpen = openDescriptor?.value as
  ((method: string, url: string | URL, ...rest: unknown[]) => void) | undefined;
const originalSend = sendDescriptor?.value as
  ((body?: Document | XMLHttpRequestBodyInit | null) => void) | undefined;

XMLHttpRequest.prototype.open = function (this: YrtXHR, method: string, url: string | URL, ...rest: unknown[]) {
  const urlStr = typeof url === 'string' ? url : url.toString();
  this._yrtUrl = urlStr;
  originalOpen?.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (this: YrtXHR, body?: Document | XMLHttpRequestBodyInit | null) {
  const yrtUrl = this._yrtUrl ?? '';
  if (yrtUrl.includes('timedtext') || yrtUrl.includes('api/timedtext')) {
    this.addEventListener('load', function () {
      try {
        const text = this.responseText;
        if (text.length > 0 && (text.includes('<body>') || text.includes('<p '))) {
          capturedXml = text;
          console.log('[YRT page.js] Intercepted caption XML from XHR, length:', text.length);
        }
      } catch (e: unknown) {
        console.log('[YRT page.js] Failed to read XHR response:', e);
      }
    });
  }
  originalSend?.call(this, body);
};

interface TrackError { kind: 'no-tracks' }
type FetchError =
  | { kind: 'fetch-status'; status: number }
  | { kind: 'empty-response' }
  | { kind: 'fetch-error'; message: string };

function formatFetchError(e: FetchError): string {
  switch (e.kind) {
    case 'fetch-status': return `fetch status: ${String(e.status)}`;
    case 'empty-response': return 'empty response';
    case 'fetch-error': return `fetch error: ${e.message}`;
  }
}

function getTracks(): Result<CaptionTrack[], TrackError> {
  // Method 1: ytInitialPlayerResponse
  try {
    const resp = window.ytInitialPlayerResponse;
    if (resp?.captions !== undefined) {
      return ok(resp.captions.playerCaptionsTracklistRenderer.captionTracks);
    }
  } catch { /* ignored */ }

  // Method 2: movie_player.getPlayerResponse()
  try {
    const el = document.getElementById('movie_player');
    if (el !== null && isMoviePlayer(el)) {
      const resp = el.getPlayerResponse();
      if (resp.captions !== undefined) {
        return ok(resp.captions.playerCaptionsTracklistRenderer.captionTracks);
      }
    }
  } catch { /* ignored */ }

  // Method 3: scan script tags
  try {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const txt = s.textContent;
      if (txt?.includes('captionTracks') === true) {
        const match = /"captionTracks":(\[.*?\])\s*,\s*"/.exec(txt);
        if (match !== null) {
          return ok(JSON.parse(match[1] ?? '[]') as CaptionTrack[]);
        }
      }
    }
  } catch { /* ignored */ }

  return err({ kind: 'no-tracks' });
}

async function fetchCaptionXml(tracks: CaptionTrack[]): Promise<Result<string, FetchError>> {
  const track = tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
  if (track === undefined) return err({ kind: 'empty-response' });
  let url = track.baseUrl;
  url = url.replace(/([?&])fmt=[^&]*/, '$1fmt=srv3');
  if (!url.includes('fmt=')) {
    url += '&fmt=srv3';
  }

  try {
    const resp = await originalFetch(url);
    if (!resp.ok) {
      return err({ kind: 'fetch-status', status: resp.status });
    }
    const text = await resp.text();
    if (text.length === 0) {
      return err({ kind: 'empty-response' });
    }
    return ok(text);
  } catch (e: unknown) {
    return err({ kind: 'fetch-error', message: e instanceof Error ? e.message : String(e) });
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  if (!isYrtMessage(e.data) || e.data.type !== 'yrt-request-captions') return;

  void (async () => {
    const tracksResult = getTracks();
    const tracks = tracksResult.isOk() ? tracksResult.value : [];
    console.log('[YRT page.js] Tracks:', tracks.length, 'Captured XML length:', capturedXml.length);

    // Use intercepted XML if available, otherwise fetch directly
    let xml = capturedXml;
    if (xml.length === 0 && tracks.length > 0) {
      console.log('[YRT page.js] No intercepted XML, fetching directly...');
      const fetchResult = await fetchCaptionXml(tracks);
      if (fetchResult.isOk()) {
        xml = fetchResult.value;
        capturedXml = xml;
      } else {
        const fe = fetchResult.error;
        console.log('[YRT page.js]', formatFetchError(fe));
      }
    }

    const response: CaptionTracksResponse = { type: 'yrt-caption-tracks', tracks, xml };
    window.postMessage(response, '*');
  })();
});
