import { ok, err, type Result } from 'neverthrow';

export type ParseError =
  | { kind: 'xml-parse-error'; detail: string }
  | { kind: 'no-paragraphs' }
  | { kind: 'no-segments' };

export function formatParseError(e: ParseError): string {
  switch (e.kind) {
    case 'xml-parse-error': return `XML parse error: ${e.detail}`;
    case 'no-paragraphs': return 'No caption paragraphs found in XML';
    case 'no-segments': return 'No valid caption segments found';
  }
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

const CJK_RANGE = /[\u3000-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

function wordCount(text: string): number {
  if (CJK_RANGE.test(text)) {
    const cjkChars = text.replace(/[\s\p{P}\p{S}a-zA-Z0-9]/gu, '').length;
    const latinWords = text.replace(/[^\sa-zA-Z0-9]/g, '').split(/\s+/).filter(Boolean).length;
    return Math.ceil(cjkChars / 2) + latinWords;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

const SENTENCE_END = /[.!?]["'\u201D\u2019)]*\s*$/;
const MIN_WORDS = 5;
const MAX_WORDS = 18;

export function mergeBySentence(raw: Caption[]): Caption[] {
  const first = raw[0];
  if (first === undefined) return [];

  // Phase 1: group raw segments into sentences (split at sentence-ending punctuation)
  const sentences: Caption[] = [];
  let cur: Caption = { ...first };
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1];
    const next = raw[i];
    if (prev === undefined || next === undefined) continue;
    if (SENTENCE_END.test(prev.text)) {
      sentences.push(cur);
      cur = { ...next };
    } else {
      cur.end = next.end;
      cur.text = cur.text + ' ' + next.text;
    }
  }
  sentences.push(cur);

  // Phase 2: merge sentences with lookahead
  const firstSentence = sentences[0];
  if (firstSentence === undefined) return [];
  const merged: Caption[] = [];
  let acc: Caption = { ...firstSentence };

  for (let i = 1; i < sentences.length; i++) {
    const next = sentences[i];
    if (next === undefined) continue;
    const accW = wordCount(acc.text);
    const nextW = wordCount(next.text);

    if (accW >= MIN_WORDS) {
      if (nextW < MIN_WORDS && accW + nextW <= MAX_WORDS) {
        const futureW = lookaheadWords(sentences, i);
        if (nextW + futureW >= MIN_WORDS) {
          merged.push(acc);
          acc = { ...next };
        } else {
          acc.end = next.end;
          acc.text = acc.text + ' ' + next.text;
        }
      } else {
        merged.push(acc);
        acc = { ...next };
      }
    } else {
      if (accW + nextW <= MAX_WORDS) {
        acc.end = next.end;
        acc.text = acc.text + ' ' + next.text;
      } else {
        merged.push(acc);
        acc = { ...next };
      }
    }
  }
  merged.push(acc);

  // Phase 3: tighten end times
  for (let i = 0; i < merged.length - 1; i++) {
    const current = merged[i];
    const following = merged[i + 1];
    if (current !== undefined && following !== undefined) {
      current.end = following.start;
    }
  }

  return merged;
}

function lookaheadWords(sentences: Caption[], fromIdx: number): number {
  const next = sentences[fromIdx + 1];
  if (next !== undefined) {
    return wordCount(next.text);
  }
  return 0;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
}

export function findCaptionIndex(captions: Caption[], time: number): number {
  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    if (cap !== undefined && time >= cap.start && time < cap.end) return i;
  }
  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    if (cap !== undefined && cap.start > time) return i;
  }
  return captions.length - 1;
}

export function parseSrv3(xml: string): Result<Caption[], ParseError> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError !== null) {
    return err({ kind: 'xml-parse-error', detail: parseError.textContent ?? 'unknown' });
  }

  const paragraphs = doc.querySelectorAll('body p');
  if (paragraphs.length === 0) {
    return err({ kind: 'no-paragraphs' });
  }

  const raw: Caption[] = [];
  paragraphs.forEach((p) => {
    const tMs = parseInt(p.getAttribute('t') ?? '0', 10);
    const dMs = parseInt(p.getAttribute('d') ?? '0', 10);
    const start = tMs / 1000;
    const end = (tMs + dMs) / 1000;
    const text = (p.textContent ?? '').replace(/\n/g, ' ').trim();
    if (text !== '' && dMs > 0) {
      raw.push({ start, end, text });
    }
  });

  if (raw.length === 0) {
    return err({ kind: 'no-segments' });
  }

  return ok(mergeBySentence(raw));
}
