import { ok, err, type Result } from 'neverthrow';

export interface Caption {
  start: number;
  end: number;
  text: string;
}

const CJK_RANGE = /[\u3000-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

function wordCount(text: string): number {
  if (CJK_RANGE.test(text)) {
    // For CJK text, count characters (excluding spaces/punctuation) as ~2 words each
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
  if (raw.length === 0) return [];

  // Phase 1: group raw segments into sentences (split at sentence-ending punctuation)
  const sentences: Caption[] = [];
  let cur: Caption = { ...raw[0]! };
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1]!;
    const next = raw[i]!;
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
  // - If acc is long enough (>= MIN_WORDS), split — unless next is too short to stand alone
  //   and can be absorbed without exceeding MAX_WORDS
  // - If acc is too short (< MIN_WORDS), merge with next if it fits
  // - Lookahead: when next is short, check if next + future can form a viable unit;
  //   if so, let next start a new unit rather than absorbing it
  const merged: Caption[] = [];
  let acc: Caption = { ...sentences[0]! };

  for (let i = 1; i < sentences.length; i++) {
    const next = sentences[i]!;
    const accW = wordCount(acc.text);
    const nextW = wordCount(next.text);

    if (accW >= MIN_WORDS) {
      // acc is viable on its own
      if (nextW < MIN_WORDS && accW + nextW <= MAX_WORDS) {
        // next is too short — but check if it can form a unit with future sentences
        const futureW = lookaheadWords(sentences, i);
        if (nextW + futureW >= MIN_WORDS) {
          // next can pair with future, so split here
          merged.push(acc);
          acc = { ...next };
        } else {
          // next has no viable future partner, absorb it
          acc.end = next.end;
          acc.text = acc.text + ' ' + next.text;
        }
      } else {
        // next is long enough on its own, or absorbing would exceed MAX_WORDS
        merged.push(acc);
        acc = { ...next };
      }
    } else {
      // acc too short, must merge
      if (accW + nextW <= MAX_WORDS) {
        acc.end = next.end;
        acc.text = acc.text + ' ' + next.text;
      } else {
        // Would exceed MAX_WORDS — force split (short acc is better than oversized)
        merged.push(acc);
        acc = { ...next };
      }
    }
  }
  merged.push(acc);

  // Phase 3: tighten end times — set each segment's end to the next segment's start
  for (let i = 0; i < merged.length - 1; i++) {
    merged[i]!.end = merged[i + 1]!.start;
  }

  return merged;
}

function lookaheadWords(sentences: Caption[], fromIdx: number): number {
  // Sum word counts of the next sentence (the one after fromIdx)
  // to check if sentences[fromIdx] can pair with it
  if (fromIdx + 1 < sentences.length) {
    return wordCount(sentences[fromIdx + 1]!.text);
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
    const cap = captions[i]!;
    if (time >= cap.start && time < cap.end) return i;
  }
  for (let i = 0; i < captions.length; i++) {
    if (captions[i]!.start > time) return i;
  }
  return captions.length - 1;
}

export function parseSrv3(xml: string): Result<Caption[], string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return err(`XML parse error: ${parseError.textContent ?? 'unknown'}`);
  }

  const paragraphs = doc.querySelectorAll('body p');
  if (paragraphs.length === 0) {
    return err('No caption paragraphs found in XML');
  }

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

  if (raw.length === 0) {
    return err('No valid caption segments found');
  }

  return ok(mergeBySentence(raw));
}
