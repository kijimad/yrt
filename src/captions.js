// Pure caption-processing functions, extracted for testability.
// content.js contains the same logic inline (Chrome MV3 content scripts don't support ES modules).

// Merge raw segments so each group ends at a sentence boundary
export function mergeBySentence(raw) {
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

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function findCaptionIndex(captions, time) {
  for (let i = 0; i < captions.length; i++) {
    if (time >= captions[i].start && time < captions[i].end) return i;
  }
  for (let i = 0; i < captions.length; i++) {
    if (captions[i].start > time) return i;
  }
  return captions.length - 1;
}

// Parse YouTube's timedtext (srv3 format) XML
export function parseSrv3(xml) {
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
