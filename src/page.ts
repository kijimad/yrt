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

function getTracks(): CaptionTrack[] | null {
  // Method 1: ytInitialPlayerResponse
  try {
    const resp = window.ytInitialPlayerResponse;
    if (resp?.captions) {
      return resp.captions.playerCaptionsTracklistRenderer.captionTracks;
    }
  } catch {}

  // Method 2: movie_player.getPlayerResponse()
  try {
    const player = document.getElementById('movie_player') as MoviePlayer | null;
    if (player?.getPlayerResponse) {
      const resp = player.getPlayerResponse();
      if (resp?.captions) {
        return resp.captions.playerCaptionsTracklistRenderer.captionTracks;
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
          return JSON.parse(match[1]!) as CaptionTrack[];
        }
      }
    }
  } catch {}

  return null;
}

async function fetchCaptionXml(tracks: CaptionTrack[]): Promise<string> {
  const track = tracks.find((t) => t.kind !== 'asr') ?? tracks[0]!;
  let url = track.baseUrl;
  url = url.replace(/([?&])fmt=[^&]*/, '$1fmt=srv3');
  if (!url.includes('fmt=')) {
    url += '&fmt=srv3';
  }

  try {
    const resp = await originalFetch(url);
    if (!resp.ok) {
      console.log('[YRT page.js] fetch status:', resp.status);
      return '';
    }
    return await resp.text();
  } catch (err: unknown) {
    console.error('[YRT page.js] fetch error:', err);
    return '';
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.data && e.data.type === 'yrt-request-captions') {
    void (async () => {
      const tracks = getTracks();
      console.log('[YRT page.js] Tracks:', tracks ? tracks.length : 0, 'Captured XML length:', capturedXml.length);

      // Use intercepted XML if available, otherwise fetch directly
      let xml = capturedXml;
      if (xml.length === 0 && tracks && tracks.length > 0) {
        console.log('[YRT page.js] No intercepted XML, fetching directly...');
        xml = await fetchCaptionXml(tracks);
        if (xml.length > 0) {
          capturedXml = xml;
        }
      }

      window.postMessage({
        type: 'yrt-caption-tracks',
        tracks: tracks ?? [],
        xml,
      }, '*');
    })();
  }
});
