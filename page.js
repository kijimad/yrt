// Runs in MAIN world (page context) - has access to YouTube's JS objects
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'yrt-request-captions') {
    let tracks = null;

    // Method 1: ytInitialPlayerResponse
    try {
      const resp = window.ytInitialPlayerResponse;
      console.log('[YRT page.js] ytInitialPlayerResponse:', !!resp, resp ? !!resp.captions : 'N/A');
      if (resp && resp.captions) {
        tracks = resp.captions.playerCaptionsTracklistRenderer.captionTracks;
      }
    } catch (err) {
      console.log('[YRT page.js] Method 1 error:', err);
    }

    // Method 2: movie_player.getPlayerResponse()
    if (!tracks) {
      try {
        const player = document.getElementById('movie_player');
        console.log('[YRT page.js] movie_player:', !!player, player ? typeof player.getPlayerResponse : 'N/A');
        if (player && typeof player.getPlayerResponse === 'function') {
          const resp = player.getPlayerResponse();
          console.log('[YRT page.js] getPlayerResponse:', !!resp, resp ? !!resp.captions : 'N/A');
          if (resp && resp.captions) {
            tracks = resp.captions.playerCaptionsTracklistRenderer.captionTracks;
          }
        }
      } catch (err) {
        console.log('[YRT page.js] Method 2 error:', err);
      }
    }

    // Method 3: scan ytInitialData or embedded player response from DOM
    if (!tracks) {
      try {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const txt = s.textContent;
          if (txt && txt.includes('captionTracks')) {
            const match = txt.match(/"captionTracks":(\[.*?\])\s*,\s*"/);
            if (match) {
              tracks = JSON.parse(match[1]);
              console.log('[YRT page.js] Method 3 (DOM scan) found tracks:', tracks.length);
              break;
            }
          }
        }
      } catch (err) {
        console.log('[YRT page.js] Method 3 error:', err);
      }
    }

    console.log('[YRT page.js] Final tracks:', tracks ? tracks.length : 0);

    window.postMessage({
      type: 'yrt-caption-tracks',
      tracks: tracks || [],
    }, '*');
  }
});
