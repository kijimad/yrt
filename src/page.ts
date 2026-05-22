import { ok, err, type Result } from 'neverthrow';

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

interface MoviePlayer extends HTMLElement {
  getPlayerResponse?: () => {
    captions?: {
      playerCaptionsTracklistRenderer: {
        captionTracks: CaptionTrack[];
      };
    };
  };
}

interface CaptionTrack {
  kind: string;
  baseUrl: string;
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
    } catch (err: unknown) {
      console.log('[YRT page.js] Failed to read intercepted response:', err);
    }
  }

  return resp;
};

// Also intercept XMLHttpRequest for older YouTube player paths
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
  const urlStr = typeof url === 'string' ? url : url.toString();
  (this as XMLHttpRequest & { _yrtUrl?: string })._yrtUrl = urlStr;
  return (originalXHROpen as Function).call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (...args: unknown[]) {
  const yrtUrl = (this as XMLHttpRequest & { _yrtUrl?: string })._yrtUrl ?? '';
  if (yrtUrl.includes('timedtext') || yrtUrl.includes('api/timedtext')) {
    this.addEventListener('load', function () {
      try {
        const text = this.responseText;
        if (text.length > 0 && (text.includes('<body>') || text.includes('<p '))) {
          capturedXml = text;
          console.log('[YRT page.js] Intercepted caption XML from XHR, length:', text.length);
        }
      } catch (err: unknown) {
        console.log('[YRT page.js] Failed to read XHR response:', err);
      }
    });
  }
  return (originalXHRSend as Function).apply(this, args);
};

function getTracks(): Result<CaptionTrack[], string> {
  // Method 1: ytInitialPlayerResponse
  try {
    const resp = window.ytInitialPlayerResponse;
    if (resp?.captions) {
      return ok(resp.captions.playerCaptionsTracklistRenderer.captionTracks);
    }
  } catch {}

  // Method 2: movie_player.getPlayerResponse()
  try {
    const player = document.getElementById('movie_player') as MoviePlayer | null;
    if (player?.getPlayerResponse) {
      const resp = player.getPlayerResponse();
      if (resp?.captions) {
        return ok(resp.captions.playerCaptionsTracklistRenderer.captionTracks);
      }
    }
  } catch {}

  // Method 3: scan script tags
  try {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const txt = s.textContent;
      if (txt?.includes('captionTracks')) {
        const match = txt.match(/"captionTracks":(\[.*?\])\s*,\s*"/);
        if (match) {
          return ok(JSON.parse(match[1]!) as CaptionTrack[]);
        }
      }
    }
  } catch {}

  return err('No caption tracks found');
}

async function fetchCaptionXml(tracks: CaptionTrack[]): Promise<Result<string, string>> {
  const track = tracks.find((t) => t.kind !== 'asr') ?? tracks[0]!;
  let url = track.baseUrl;
  url = url.replace(/([?&])fmt=[^&]*/, '$1fmt=srv3');
  if (!url.includes('fmt=')) {
    url += '&fmt=srv3';
  }

  try {
    const resp = await originalFetch(url);
    if (!resp.ok) {
      return err(`fetch status: ${resp.status}`);
    }
    const text = await resp.text();
    if (text.length === 0) {
      return err('Empty response');
    }
    return ok(text);
  } catch (e: unknown) {
    return err(`fetch error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.data && e.data.type === 'yrt-request-captions') {
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
          console.log('[YRT page.js]', fetchResult.error);
        }
      }

      window.postMessage({
        type: 'yrt-caption-tracks',
        tracks,
        xml,
      }, '*');
    })();
  }
});
