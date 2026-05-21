export interface Caption {
  start: number;
  end: number;
  text: string;
}

export function mergeBySentence(raw: Caption[]): Caption[] {
  if (raw.length === 0) return [];
  const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
  const MIN_DURATION = 3;
  const MAX_DURATION = 8;

  // Step 1: merge until sentence end, but force split at MAX_DURATION
  const merged: Caption[] = [];
  let current: Caption = { ...raw[0]! };
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1]!;
    const next = raw[i]!;
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
  const result: Caption[] = [];
  let acc: Caption = { ...merged[0]! };
  for (let i = 1; i < merged.length; i++) {
    const seg = merged[i]!;
    if ((acc.end - acc.start) < MIN_DURATION) {
      acc.end = seg.end;
      acc.text = acc.text + ' ' + seg.text;
    } else {
      result.push(acc);
      acc = { ...seg };
    }
  }
  result.push(acc);

  // Step 3: tighten end times — set each segment's end to the next segment's start
  // so loops don't play into the next caption's audio
  for (let i = 0; i < result.length - 1; i++) {
    result[i]!.end = result[i + 1]!.start;
  }

  return result;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
}

export function findCaptionIndex(captions: Caption[], time: number): number {
  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i]!;
    if (time >= cap.start && time < cap.end) return i;
  }
  for (let i = 0; i < captions.length; i++) {
    if (captions[i]!.start > time) return i;
  }
  return captions.length - 1;
}

export function parseSrv3(xml: string): Caption[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const paragraphs = doc.querySelectorAll('body p');
  const raw: Caption[] = [];
  paragraphs.forEach((p) => {
    const tMs = parseInt(p.getAttribute('t') ?? '0', 10);
    const dMs = parseInt(p.getAttribute('d') ?? '0', 10);
    const start = tMs / 1000;
    const end = (tMs + dMs) / 1000;
    const text = (p.textContent ?? '').replace(/\n/g, ' ').trim();
    if (text && dMs > 0) {
      raw.push({ start, end, text });
    }
  });
  return mergeBySentence(raw);
}
