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

// Split a single segment at internal sentence boundaries
// e.g. "Hello world. This is a test." → ["Hello world.", "This is a test."]
const INTERNAL_SPLIT = /(?<=[.!?]["'\u201D\u2019)]*)\s+(?=[A-Z])/;

function splitInternalSentences(raw: Caption[]): Caption[] {
  const result: Caption[] = [];
  for (const seg of raw) {
    const parts = seg.text.split(INTERNAL_SPLIT);
    if (parts.length <= 1) {
      result.push(seg);
      continue;
    }
    const totalLen = seg.text.length;
    const totalDur = seg.end - seg.start;
    let charOffset = 0;
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j]!;
      const start = seg.start + (charOffset / totalLen) * totalDur;
      charOffset += part.length;
      const end = j === parts.length - 1 ? seg.end : seg.start + (charOffset / totalLen) * totalDur;
      charOffset += 1; // space between parts
      result.push({ start, end, text: part });
    }
  }
  return result;
}

export function mergeBySentence(raw: Caption[]): Caption[] {
  if (raw.length === 0) return [];

  // Phase 0: split raw segments that contain multiple sentences
  raw = splitInternalSentences(raw);

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

  // Phase 3: force-split segments that exceed MAX_WORDS
  const split: Caption[] = [];
  for (const seg of merged) {
    if (wordCount(seg.text) <= MAX_WORDS) {
      split.push(seg);
      continue;
    }
    // Try splitting at internal sentence boundaries
    const subSentences = splitInternalSentences([seg]);
    if (subSentences.length > 1) {
      // Multiple sentences — re-merge through full algorithm
      const reMerged = mergeBySentence(subSentences);
      split.push(...reMerged);
    } else if (SENTENCE_END.test(seg.text)) {
      // Single complete sentence — keep intact even if long
      split.push(seg);
    } else {
      // Unpunctuated stream — split at MAX_WORDS
      const words = seg.text.split(/\s+/);
      let start = seg.start;
      const totalDur = seg.end - seg.start;
      const totalWords = words.length;
      for (let j = 0; j < totalWords; j += MAX_WORDS) {
        const chunk = words.slice(j, j + MAX_WORDS);
        const frac = chunk.length / totalWords;
        const end = j + MAX_WORDS >= totalWords ? seg.end : start + totalDur * frac;
        split.push({ start, end, text: chunk.join(' ') });
        start = end;
      }
    }
  }

  // Phase 4: tighten end times — set each segment's end to the next segment's start
  for (let i = 0; i < split.length - 1; i++) {
    split[i]!.end = split[i + 1]!.start;
  }

  return split;
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
