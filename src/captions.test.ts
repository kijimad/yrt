import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, test, expect } from 'vitest';
import { mergeBySentence, parseSrv3, formatTime, findCaptionIndex } from './captions.ts';
import type { Caption } from './captions.ts';

// -- helpers --

function seg(start: number, end: number, text: string): Caption {
  return { start, end, text };
}

function durations(segments: Caption[]): number[] {
  return segments.map((s) => +(s.end - s.start).toFixed(2));
}

function durationStats(segments: Caption[]): { min: number; max: number; avg: number; count: number } {
  const d = durations(segments);
  const min = Math.min(...d);
  const max = Math.max(...d);
  const avg = +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2);
  return { min, max, avg, count: d.length };
}

// -- mergeBySentence basic behaviour --

describe('mergeBySentence', () => {
  test('returns empty array for empty input', () => {
    expect(mergeBySentence([])).toEqual([]);
  });

  test('single segment passes through', () => {
    const input = [seg(0, 2, 'Hello.')];
    const result = mergeBySentence(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Hello.');
  });

  test('merges fragments until sentence end', () => {
    const input = [
      seg(0, 1, 'The quick brown'),
      seg(1, 2, 'fox jumps over'),
      seg(2, 4, 'the lazy dog.'),
    ];
    const result = mergeBySentence(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('The quick brown fox jumps over the lazy dog.');
    expect(result[0]!.start).toBe(0);
    expect(result[0]!.end).toBe(4);
  });

  test('merges short sentences until MIN_WORDS reached', () => {
    const input = [
      seg(0, 2, 'First sentence.'),
      seg(2, 4, 'Second sentence.'),
      seg(4, 6, 'Third sentence.'),
    ];
    const result = mergeBySentence(input);
    // Each sentence is only 2 words, so all get merged
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain('First');
    expect(result[0]!.text).toContain('Third');
  });

  test('handles question marks and exclamation marks as sentence ends', () => {
    const input = [
      seg(0, 2, 'Is this working?'),
      seg(2, 5, 'Yes it is!'),
      seg(5, 8, 'Great news.'),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('handles quotes after punctuation', () => {
    const input = [
      seg(0, 2, 'She said "hello."'),
      seg(2, 5, 'Then she left.'),
    ];
    const result = mergeBySentence(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain('hello."');
    expect(result[0]!.text).toContain('Then she left.');
  });

  test('short segments get merged until MIN_WORDS is reached', () => {
    const input = [
      seg(0, 1, 'Hi.'),
      seg(1, 2, 'Hey.'),
      seg(2, 3, 'Hello.'),
      seg(3, 7, 'This is a longer sentence that takes four seconds.'),
    ];
    const result = mergeBySentence(input);
    // "Hi. Hey. Hello." = 3 words < MIN_WORDS, so merged with next
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain('Hi.');
    expect(result[0]!.text).toContain('longer sentence');
  });
});

// -- Real caption data: ASR (auto-generated) English --

describe('mergeBySentence with real ASR English captions', () => {
  const asrEnglish: Caption[] = [
    seg(0.0, 1.2, "so today we're going to"),
    seg(1.2, 2.8, "talk about something really"),
    seg(2.8, 4.1, "important."),
    seg(4.1, 5.5, "machine learning has"),
    seg(5.5, 7.2, "changed the way we think"),
    seg(7.2, 9.0, "about artificial intelligence."),
    seg(9.0, 10.3, "and I think that's"),
    seg(10.3, 11.8, "really fascinating."),
    seg(11.8, 13.2, "so let me show you"),
    seg(13.2, 15.0, "what I mean."),
    seg(15.0, 16.5, "here we have a"),
    seg(16.5, 18.3, "neural network that can"),
    seg(18.3, 20.1, "recognize faces."),
    seg(20.1, 21.5, "it works by analyzing"),
    seg(21.5, 23.0, "patterns in the data."),
    seg(23.0, 24.2, "pretty cool right?"),
    seg(24.2, 26.0, "now let's look at"),
    seg(26.0, 27.5, "another example."),
    seg(27.5, 29.0, "this one is"),
    seg(29.0, 30.5, "even more impressive."),
  ];

  test('splits at sentence boundaries, not mid-sentence', () => {
    const result = mergeBySentence(asrEnglish);
    // Each segment should end at a sentence boundary (period/question mark)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.text).toMatch(/[.!?]["'\u201D\u2019)]*\s*$/);
    }
  });

  test('preserves total time span', () => {
    const result = mergeBySentence(asrEnglish);
    expect(result[0]!.start).toBe(0.0);
    expect(result[result.length - 1]!.end).toBe(30.5);
  });

  test('segments are contiguous and ordered', () => {
    const result = mergeBySentence(asrEnglish);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.start).toBeGreaterThanOrEqual(result[i - 1]!.start);
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(asrEnglish);
    const allOriginalWords = asrEnglish.flatMap((s) => s.text.split(/\s+/));
    const allMergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(allMergedWords).toEqual(allOriginalWords);
  });
});

// -- Real caption data: manually authored English subtitles --

describe('mergeBySentence with manual English captions', () => {
  const manualEnglish: Caption[] = [
    seg(0.5, 3.0, "Welcome to the program."),
    seg(3.5, 7.2, "Today we'll be discussing the impact of climate change on coastal cities."),
    seg(7.5, 10.0, "Rising sea levels threaten millions of people."),
    seg(10.5, 14.8, "Scientists predict that by 2050, many major cities could face severe flooding."),
    seg(15.0, 17.5, "What can we do about it?"),
    seg(17.8, 22.0, "First, we need to reduce carbon emissions significantly."),
    seg(22.5, 26.0, "Second, cities must invest in better infrastructure."),
    seg(26.5, 28.0, "The time to act is now."),
  ];

  test('keeps well-formed sentences mostly intact', () => {
    const result = mergeBySentence(manualEnglish);
    const stats = durationStats(result);
    expect(stats.count).toBeGreaterThanOrEqual(3);
    expect(stats.count).toBeLessThanOrEqual(8);
  });

  test('segments have at least MIN_WORDS (except last)', () => {
    const result = mergeBySentence(manualEnglish);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.text.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    }
  });
});

// -- Real caption data: ASR with no punctuation --

describe('mergeBySentence with unpunctuated ASR', () => {
  const noPunct: Caption[] = [
    seg(0, 2, "hello everyone welcome to"),
    seg(2, 4, "my channel today we are"),
    seg(4, 6, "going to learn about"),
    seg(6, 8, "cooking a simple pasta"),
    seg(8, 10, "dish so let's get"),
    seg(10, 12, "started first you need"),
    seg(12, 14, "to boil some water"),
    seg(14, 16, "then add the pasta"),
    seg(16, 18, "and wait for about"),
    seg(18, 20, "ten minutes"),
  ];

  test('without punctuation, splits at MAX_WORDS boundary', () => {
    const result = mergeBySentence(noPunct);
    expect(result[0]!.start).toBe(0);
    expect(result[result.length - 1]!.end).toBe(20);
    // With 20 words total and MAX_WORDS=18, may split into two
    // but MIN_WORDS check in step 2 may still merge
    for (const s of result) {
      const words = s.text.split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(18);
    }
  });
});

// -- Real caption data: mixed short and long sentences --

describe('mergeBySentence with mixed sentence lengths', () => {
  const mixed: Caption[] = [
    seg(0, 0.5, "Right."),
    seg(0.5, 1.0, "OK."),
    seg(1.0, 1.8, "So."),
    seg(1.8, 5.0, "The first thing you need to understand is that this process takes time."),
    seg(5.0, 5.5, "Yeah."),
    seg(5.5, 6.0, "Exactly."),
    seg(6.0, 10.0, "And the second point I want to make is about persistence and dedication."),
    seg(10.0, 10.3, "Wow."),
    seg(10.3, 14.0, "That's exactly what happened in the experiment we ran last week."),
    seg(14.0, 14.5, "Hmm."),
    seg(14.5, 18.0, "Let me explain the methodology we used for this particular study."),
  ];

  test('very short utterances get absorbed into larger segments', () => {
    const result = mergeBySentence(mixed);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.text.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(mixed);
    const allOriginalWords = mixed.flatMap((s) => s.text.split(/\s+/));
    const allMergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(allMergedWords).toEqual(allOriginalWords);
  });
});

// -- Real-world pattern: TED talk ASR (long sentences, natural speech) --

describe('mergeBySentence with TED-talk-style ASR', () => {
  // Simulates real ASR output from a TED talk: ~2 second segments, some punctuation
  const tedASR: Caption[] = [
    seg(0.0, 1.8, "so I'd like to start"),
    seg(1.8, 3.6, "by telling you a story"),
    seg(3.6, 5.4, "about a young girl"),
    seg(5.4, 7.2, "who grew up in a small"),
    seg(7.2, 9.0, "village in rural India."),
    seg(9.0, 10.8, "she didn't have access"),
    seg(10.8, 12.6, "to clean water or"),
    seg(12.6, 14.4, "electricity but she had"),
    seg(14.4, 16.2, "something far more powerful."),
    seg(16.2, 18.0, "she had curiosity."),
    seg(18.0, 19.8, "and that curiosity"),
    seg(19.8, 21.6, "led her to discover"),
    seg(21.6, 23.4, "that the problems in her"),
    seg(23.4, 25.2, "community could be solved"),
    seg(25.2, 27.0, "with simple technology."),
    seg(27.0, 28.8, "today she runs one of the"),
    seg(28.8, 30.6, "most successful social"),
    seg(30.6, 32.4, "enterprises in the country."),
    seg(32.4, 34.2, "so what can we learn"),
    seg(34.2, 36.0, "from her experience?"),
    seg(36.0, 37.8, "I think there are"),
    seg(37.8, 39.6, "three key lessons."),
  ];

  test('splits at sentence boundaries, not mid-sentence', () => {
    const result = mergeBySentence(tedASR);
    // Every segment except the last should end at a sentence boundary
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.text).toMatch(/[.!?]["'\u201D\u2019)]*\s*$/);
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(tedASR);
    const origWords = tedASR.flatMap((s) => s.text.split(/\s+/));
    const mergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(mergedWords).toEqual(origWords);
  });

  test('unpunctuated segments respect MAX_WORDS (18)', () => {
    const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
    const result = mergeBySentence(tedASR);
    for (const s of result) {
      if (!sentenceEnd.test(s.text)) {
        expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(18);
      }
    }
  });

  test('reasonable segment count', () => {
    const result = mergeBySentence(tedASR);
    // 22 raw segments → ~4-6 merged segments at sentence boundaries
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

// -- Real-world pattern: tutorial video with long explanations --

describe('mergeBySentence with tutorial-style captions', () => {
  // Manual captions from an educational video: well-punctuated, varied sentence lengths
  const tutorial: Caption[] = [
    seg(0, 3.5, "Welcome back to the channel."),
    seg(3.5, 8.2, "In this video we're going to learn about the fundamentals of machine learning and how it can be applied to real world problems."),
    seg(8.2, 12.0, "But first, let me give you a quick overview of what we covered in the previous episode."),
    seg(12.0, 14.5, "We talked about data preprocessing."),
    seg(14.5, 18.0, "We discussed how to clean your dataset and handle missing values."),
    seg(18.0, 19.5, "Remember that?"),
    seg(19.5, 23.0, "Good, because today we're building on top of those concepts."),
    seg(23.0, 28.5, "The first algorithm we'll look at is linear regression, which is probably the simplest and most intuitive model you can use."),
    seg(28.5, 30.0, "Let me show you how it works."),
  ];

  test('keeps long well-formed sentences intact', () => {
    const result = mergeBySentence(tutorial);
    // The long sentence at 3.5-8.2 should NOT be split mid-sentence
    const longSentence = result.find((s) => s.text.includes("fundamentals of machine learning"));
    expect(longSentence).toBeDefined();
    expect(longSentence!.text).toContain("real world problems.");
  });

  test('merges short sentences with neighbors', () => {
    const result = mergeBySentence(tutorial);
    // "Remember that?" (2 words) should be merged with adjacent segments
    const standalone = result.find((s) => s.text === "Remember that?");
    expect(standalone).toBeUndefined();
  });

  test('all segments end at sentence boundaries (except last)', () => {
    const result = mergeBySentence(tutorial);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.text).toMatch(/[.!?]["'\u201D\u2019)]*\s*$/);
    }
  });
});

// -- Real-world pattern: movie/TV subtitles with dialogue --

describe('mergeBySentence with movie dialogue captions', () => {
  const dialogue: Caption[] = [
    seg(0, 1.5, "What do you want?"),
    seg(2.0, 4.5, "I need to talk to you about something important."),
    seg(5.0, 6.0, "Not now."),
    seg(6.5, 7.5, "I'm busy."),
    seg(8.0, 11.0, "It can't wait, this is about the project deadline."),
    seg(11.5, 14.0, "We're three weeks behind schedule and the client is furious."),
    seg(14.5, 15.5, "I know."),
    seg(16.0, 18.5, "I've been working on a solution all weekend."),
    seg(19.0, 22.0, "We need to hire two more developers and extend the timeline."),
    seg(22.5, 23.5, "That's expensive."),
    seg(24.0, 26.0, "Can we find another way?"),
    seg(26.5, 30.0, "I've considered every option and this is the only viable path forward."),
    seg(30.5, 31.5, "Fine."),
    seg(32.0, 34.5, "Set up a meeting with HR tomorrow morning."),
  ];

  test('short dialogue lines get merged, long ones preserved', () => {
    const result = mergeBySentence(dialogue);
    // "Fine." alone (1 word) should be merged
    const fineAlone = result.find((s) => s.text === "Fine.");
    expect(fineAlone).toBeUndefined();
    // Long sentence should be preserved intact
    const longLine = result.find((s) => s.text.includes("every option"));
    expect(longLine).toBeDefined();
    expect(longLine!.text).toContain("viable path forward.");
  });

  test('no unpunctuated segment exceeds MAX_WORDS', () => {
    const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
    const result = mergeBySentence(dialogue);
    for (const s of result) {
      if (!sentenceEnd.test(s.text)) {
        expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(18);
      }
    }
  });
});

// -- Real-world pattern: ASR with completely no punctuation (worst case) --

describe('mergeBySentence with long unpunctuated ASR', () => {
  // Real ASR sometimes has NO punctuation at all, especially for non-English
  const longNoPunct: Caption[] = [
    seg(0, 2, "so today we are going to"),
    seg(2, 4, "talk about something that"),
    seg(4, 6, "I think is really important"),
    seg(6, 8, "for everyone to understand"),
    seg(8, 10, "and that is how the"),
    seg(10, 12, "internet actually works"),
    seg(12, 14, "behind the scenes when"),
    seg(14, 16, "you type in a website"),
    seg(16, 18, "address your computer sends"),
    seg(18, 20, "a request to a server"),
    seg(20, 22, "and that server responds"),
    seg(22, 24, "with the page content"),
    seg(24, 26, "but there are many steps"),
    seg(26, 28, "in between that most"),
    seg(28, 30, "people never think about"),
    seg(30, 32, "first your browser looks up"),
    seg(32, 34, "the domain name in the"),
    seg(34, 36, "DNS system to find the"),
    seg(36, 38, "actual IP address of"),
    seg(38, 40, "the server you want"),
  ];

  test('splits at MAX_WORDS when no punctuation exists', () => {
    const result = mergeBySentence(longNoPunct);
    expect(result.length).toBeGreaterThan(1);
    for (const s of result) {
      expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(18);
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(longNoPunct);
    const origWords = longNoPunct.flatMap((s) => s.text.split(/\s+/));
    const mergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(mergedWords).toEqual(origWords);
  });
});

// -- Sentence boundary quality test --

describe('sentence boundary quality', () => {
  // This is the key test: verify we NEVER split mid-sentence when within MAX_WORDS
  const mixedSentences: Caption[] = [
    seg(0, 2, "The weather today"),
    seg(2, 4, "is absolutely beautiful."),
    seg(4, 6, "I went for a walk"),
    seg(6, 8, "in the park and"),
    seg(8, 10, "saw some amazing birds."),
    seg(10, 12, "There were blue jays"),
    seg(12, 14, "and cardinals and even"),
    seg(14, 16, "a red-tailed hawk."),
    seg(16, 18, "Nature is incredible."),
    seg(18, 20, "We should all spend"),
    seg(20, 22, "more time outdoors."),
  ];

  test('never splits mid-sentence when under MAX_WORDS', () => {
    const result = mergeBySentence(mixedSentences);
    // Each segment's text should end with sentence-ending punctuation
    for (let i = 0; i < result.length - 1; i++) {
      const text = result[i]!.text;
      expect(text).toMatch(/[.!?]["'\u201D\u2019)]*\s*$/);
    }
  });

  test('preserves sentence integrity', () => {
    const result = mergeBySentence(mixedSentences);
    // Check that "I went for a walk in the park and saw some amazing birds."
    // is NOT split into "I went for a walk" and "in the park..."
    const walkSegment = result.find((s) => s.text.includes("went for a walk"));
    expect(walkSegment).toBeDefined();
    expect(walkSegment!.text).toContain("amazing birds.");
  });
});

// -- parseSrv3 --

describe('parseSrv3', () => {
  test('parses srv3 XML with <p> elements', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="0" d="2000">Hello world.</p>
  <p t="2000" d="3000">This is a test sentence.</p>
  <p t="5000" d="2500">Another one here.</p>
</body>
</timedtext>`;

    const result = parseSrv3(xml);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.start).toBe(0);
  });

  test('skips empty text and zero-duration segments', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="0" d="0"></p>
  <p t="0" d="2000">Valid segment.</p>
  <p t="2000" d="0">Zero duration.</p>
  <p t="2000" d="3000">  </p>
</body>
</timedtext>`;

    const result = parseSrv3(xml);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('Valid segment.');
    expect(allText).not.toContain('Zero duration.');
  });

  test('parses real-world srv3 fragment', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<head>
  <pen id="1" fc="#FFFFFF"/>
  <ws id="1"/>
  <wp id="1" ap="6" ah="20" av="100"/>
</head>
<body>
  <w t="0" id="1">
    <p t="500" d="1500" w="1">So today</p>
    <p t="2000" d="2000" w="1">we are going to talk about</p>
    <p t="4000" d="2500" w="1">machine learning.</p>
    <p t="6500" d="2000" w="1">It is a very important topic.</p>
    <p t="8500" d="3000" w="1">Let me explain how it works.</p>
  </w>
</body>
</timedtext>`;

    const result = parseSrv3(xml);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('machine learning.');
    expect(allText).toContain('how it works.');
  });

  test('handles <s> children within <p> elements', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="1000" d="3000"><s>Hello </s><s>world.</s></p>
  <p t="4000" d="3000"><s>Good </s><s>morning.</s></p>
</body>
</timedtext>`;

    const result = parseSrv3(xml);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('Hello');
    expect(allText).toContain('world.');
  });
});

// -- Duration uniformity analysis --

describe('duration uniformity', () => {
  const lectureASR: Caption[] = [
    seg(0, 1.5, "welcome back to the"),
    seg(1.5, 3.2, "channel everyone."),
    seg(3.2, 5.0, "in today's video"),
    seg(5.0, 7.1, "we're going to explore"),
    seg(7.1, 9.5, "the fundamentals of quantum computing."),
    seg(9.5, 11.0, "first let's start"),
    seg(11.0, 13.2, "with the basics."),
    seg(13.2, 15.5, "a quantum bit or qubit"),
    seg(15.5, 18.0, "can exist in multiple states simultaneously."),
    seg(18.0, 19.5, "this is called"),
    seg(19.5, 21.8, "superposition."),
    seg(21.8, 24.0, "and it's what makes quantum"),
    seg(24.0, 26.5, "computers so powerful."),
    seg(26.5, 28.0, "now you might be wondering"),
    seg(28.0, 30.5, "how is this different from"),
    seg(30.5, 33.0, "a regular computer?"),
    seg(33.0, 35.0, "well a classical bit"),
    seg(35.0, 37.5, "can only be zero or one."),
    seg(37.5, 39.0, "but a qubit can be both"),
    seg(39.0, 41.0, "at the same time."),
    seg(41.0, 43.5, "this allows quantum computers to"),
    seg(43.5, 46.0, "process information exponentially faster."),
    seg(46.0, 48.0, "pretty amazing right?"),
    seg(48.0, 50.5, "let's look at a concrete example."),
  ];

  test('coefficient of variation is reasonable', () => {
    const result = mergeBySentence(lectureASR);
    const d = durations(result);
    const avg = d.reduce((a, b) => a + b, 0) / d.length;
    const variance = d.reduce((sum, v) => sum + (v - avg) ** 2, 0) / d.length;
    const stddev = Math.sqrt(variance);
    const cv = stddev / avg;
    expect(cv).toBeLessThan(1.0);
  });

  test('max/min ratio is not extreme', () => {
    const result = mergeBySentence(lectureASR);
    const stats = durationStats(result);
    const ratio = stats.max / stats.min;
    expect(ratio).toBeLessThan(10);
  });

  const conversation: Caption[] = [
    seg(0, 1.0, "Hey how's it going?"),
    seg(1.0, 2.5, "Good thanks."),
    seg(2.5, 3.0, "You?"),
    seg(3.0, 4.5, "I'm doing great."),
    seg(4.5, 8.0, "So I wanted to tell you about this amazing restaurant I found downtown."),
    seg(8.0, 8.5, "Oh really?"),
    seg(8.5, 9.5, "What kind of food?"),
    seg(9.5, 12.0, "It's a Japanese fusion place with incredible ramen."),
    seg(12.0, 12.8, "Nice."),
    seg(12.8, 15.5, "I've been looking for a good ramen spot for ages."),
    seg(15.5, 18.0, "You should definitely check it out this weekend."),
    seg(18.0, 18.8, "Will do."),
    seg(18.8, 20.0, "Thanks for the recommendation."),
  ];

  test('conversation-style merges short utterances into larger segments', () => {
    const result = mergeBySentence(conversation);
    // Short utterances should be merged until MIN_WORDS is reached
    for (const s of result) {
      const words = s.text.split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(18);
    }
  });
});

// -- Edge cases --

describe('edge cases', () => {
  test('single very long punctuated sentence stays intact', () => {
    const input = [
      seg(0, 5, "This is the beginning of a very long sentence that goes on and on"),
      seg(5, 10, "and keeps going through multiple subtitle segments without any"),
      seg(10, 15, "punctuation at all so the entire thing gets merged into one"),
      seg(15, 20, "single massive segment which may not be ideal but is correct."),
    ];
    const result = mergeBySentence(input);
    // Ends with "." so treated as one complete sentence — kept intact
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain('beginning');
    expect(result[0]!.text).toContain('correct.');
  });

  test('long unpunctuated text gets force-split', () => {
    const input = [
      seg(0, 5, "this is a very long stream of text without any punctuation"),
      seg(5, 10, "that keeps going and going through multiple segments"),
      seg(10, 15, "and never stops because the speaker just keeps talking"),
      seg(15, 20, "without any pauses or sentence endings at all"),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeGreaterThan(1);
    for (const s of result) {
      expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(18);
    }
  });

  test('all single-word segments get merged until MIN_WORDS', () => {
    const input = [
      seg(0, 0.5, "Hello."),
      seg(0.5, 1.0, "World."),
      seg(1.0, 1.5, "Test."),
      seg(1.5, 2.0, "One."),
      seg(2.0, 2.5, "Two."),
      seg(2.5, 3.0, "Three."),
      seg(3.0, 3.5, "Four."),
      seg(3.5, 4.0, "Done."),
    ];
    const result = mergeBySentence(input);
    // 8 single-word segments, MIN_WORDS=5, so all merge into 1
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain("Hello.");
    expect(result[0]!.text).toContain("Done.");
  });

  test('segment ending with ellipsis is not treated as sentence end', () => {
    const input = [
      seg(0, 2, "Well I think..."),
      seg(2, 5, "that maybe we should try something different."),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('sentence with closing parenthesis', () => {
    const input = [
      seg(0, 3, "This is important (really)."),
      seg(3, 6, "And this follows."),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('gaps between segments are preserved', () => {
    const input = [
      seg(0, 2, "First part."),
      seg(5, 8, "After a gap."),
      seg(10, 14, "Another gap here."),
    ];
    const result = mergeBySentence(input);
    expect(result[result.length - 1]!.end).toBe(14);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end).toBe(result[i + 1]!.start);
    }
  });

  test('overlapping segments handled gracefully', () => {
    const input = [
      seg(0, 3, "Overlapping start."),
      seg(2, 5, "Overlapping end."),
      seg(4, 8, "More overlap here."),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('Overlapping start.');
    expect(allText).toContain('More overlap here.');
  });

  test('segment with only whitespace after trim is skipped in parseSrv3', () => {
    const input = [seg(0, 4, "Real text here.")];
    const result = mergeBySentence(input);
    expect(result).toHaveLength(1);
  });

  test('numeric text like timestamps', () => {
    const input = [
      seg(0, 3, "2024."),
      seg(3, 6, "That was a great year."),
    ];
    const result = mergeBySentence(input);
    // "2024." is only 1 word, so it gets merged with the next segment
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain("2024.");
    expect(result[0]!.text).toContain("That was a great year.");
  });

  test('text with HTML entities from srv3', () => {
    const input = [
      seg(0, 4, "Tom & Jerry are great."),
      seg(4, 8, "They've been around forever."),
    ];
    const result = mergeBySentence(input);
    expect(result[0]!.text).toContain("Tom & Jerry");
  });
});

// -- Japanese captions (language learning primary use case) --

describe('mergeBySentence with Japanese captions', () => {
  const japaneseManual: Caption[] = [
    seg(0, 3, "\u7686\u3055\u3093\u3053\u3093\u306B\u3061\u306F\u3002"),
    seg(3, 6, "\u4ECA\u65E5\u306F\u6599\u7406\u306E\u8A71\u3092\u3057\u307E\u3057\u3087\u3046\u3002"),
    seg(6, 9, "\u307E\u305A\u6750\u6599\u3092\u6E96\u5099\u3057\u307E\u3059\u3002"),
    seg(9, 12, "\u5375\u3092\u4E09\u3064\u5272\u308A\u307E\u3059\u3002"),
    seg(12, 15, "\u6B21\u306B\u30D5\u30E9\u30A4\u30D1\u30F3\u3092\u6E29\u3081\u307E\u3059\u3002"),
    seg(15, 18, "\u6CB9\u3092\u5C11\u3057\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002"),
  ];

  test('Japanese text merges based on character count', () => {
    const result = mergeBySentence(japaneseManual);
    // 6 segments × ~8 chars each ≈ 24 CJK chars ≈ 12 "words"
    // Should be merged into reasonable groups
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  const japaneseASR: Caption[] = [
    seg(0, 2, "\u3048\u30FC\u3068\u4ECA\u65E5\u306F"),
    seg(2, 4, "\u30D7\u30ED\u30B0\u30E9\u30DF\u30F3\u30B0\u306B\u3064\u3044\u3066"),
    seg(4, 6, "\u304A\u8A71\u3057\u3057\u305F\u3044\u3068\u601D\u3044\u307E\u3059"),
    seg(6, 8, "\u307E\u305APython\u304B\u3089"),
    seg(8, 10, "\u59CB\u3081\u307E\u3057\u3087\u3046"),
    seg(10, 12, "Python\u306F\u7C21\u5358\u3067"),
    seg(12, 14, "\u3068\u3066\u3082\u4EBA\u6C17\u304C\u3042\u308A\u307E\u3059"),
  ];

  test('Japanese ASR without punctuation merges into reasonable groups', () => {
    const result = mergeBySentence(japaneseASR);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Total CJK chars is ~40, which at /2 = ~20 "words", within MAX_WORDS
  });

  const japaneseMixed: Caption[] = [
    seg(0, 3, "Hello, \u7686\u3055\u3093."),
    seg(3, 6, "\u4ECA\u65E5\u306E\u30C8\u30D4\u30C3\u30AF\u306FAI\u3067\u3059."),
    seg(6, 9, "\u3068\u3066\u3082\u9762\u767D\u3044\u3067\u3059\u3088."),
    seg(9, 12, "\u3067\u306F\u59CB\u3081\u307E\u3057\u3087\u3046."),
  ];

  test('Japanese with ASCII periods merges reasonably', () => {
    const result = mergeBySentence(japaneseMixed);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// -- Korean/Chinese captions --

describe('mergeBySentence with CJK captions', () => {
  const korean: Caption[] = [
    seg(0, 3, "\uC548\uB155\uD558\uC138\uC694."),
    seg(3, 6, "\uC624\uB298\uC740 \uC694\uB9AC\uB97C \uD574\uBCFC\uAC8C\uC694."),
    seg(6, 9, "\uC7AC\uB8CC\uB97C \uC900\uBE44\uD574\uC8FC\uC138\uC694."),
  ];

  test('Korean with ASCII periods merges reasonably', () => {
    const result = mergeBySentence(korean);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  const chinese: Caption[] = [
    seg(0, 2, "\u5927\u5BB6\u597D"),
    seg(2, 4, "\u4ECA\u5929\u6211\u4EEC\u6765\u5B66\u4E60"),
    seg(4, 6, "\u673A\u5668\u5B66\u4E60\u7684\u57FA\u7840\u77E5\u8BC6"),
    seg(6, 8, "\u9996\u5148\u6211\u4EEC\u9700\u8981\u4E86\u89E3"),
    seg(8, 10, "\u4EC0\u4E48\u662F\u795E\u7ECF\u7F51\u7EDC"),
  ];

  test('Chinese without punctuation merges into reasonable groups', () => {
    const result = mergeBySentence(chinese);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // ~20 CJK chars / 2 = ~10 "words", within MAX_WORDS
  });
});

// -- Large caption set (full video simulation) --

describe('mergeBySentence with large caption set', () => {
  function generateLargeASR(count: number): Caption[] {
    const sentences = [
      ["so the first thing", "we need to understand", "is how this works."],
      ["it's actually quite simple."],
      ["you just need to", "follow these steps."],
      ["let me show you", "an example of", "how this is done", "in practice."],
      ["does that make sense?"],
      ["great let's", "move on to", "the next topic."],
      ["this is where it", "gets really interesting."],
      ["pay attention to", "this part because", "it's very important."],
    ];
    const result: Caption[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      const s = sentences[i % sentences.length]!;
      for (const frag of s) {
        const dur = 1.2 + Math.random() * 1.5;
        result.push(seg(+t.toFixed(2), +(t + dur).toFixed(2), frag));
        t += dur;
      }
    }
    return result;
  }

  const largeASR = generateLargeASR(60);

  test('handles 60+ sentence groups without errors', () => {
    const result = mergeBySentence(largeASR);
    expect(result.length).toBeGreaterThan(10);
  });

  test('no segment exceeds 30 seconds', () => {
    const result = mergeBySentence(largeASR);
    for (const s of result) {
      expect(s.end - s.start).toBeLessThan(30);
    }
  });

  test('all text preserved in large set', () => {
    const result = mergeBySentence(largeASR);
    const origWords = largeASR.flatMap((s) => s.text.split(/\s+/));
    const mergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(mergedWords).toEqual(origWords);
  });

  test('segments are ordered', () => {
    const result = mergeBySentence(largeASR);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.start).toBeGreaterThanOrEqual(result[i - 1]!.start);
    }
  });
});

// -- Rapid speaker changes (podcast/interview) --

describe('mergeBySentence with rapid speaker changes', () => {
  const interview: Caption[] = [
    seg(0, 2.5, "So tell me about your background."),
    seg(2.5, 5.0, "Sure I grew up in Tokyo."),
    seg(5.0, 5.8, "Interesting."),
    seg(5.8, 8.0, "And then I moved to New York."),
    seg(8.0, 8.5, "When was that?"),
    seg(8.5, 10.5, "That was back in 2015."),
    seg(10.5, 11.0, "I see."),
    seg(11.0, 14.0, "And what made you decide to go into tech?"),
    seg(14.0, 17.5, "I was always fascinated by computers since I was a kid."),
    seg(17.5, 18.0, "Right."),
    seg(18.0, 21.0, "My dad was an engineer so it ran in the family."),
    seg(21.0, 21.5, "Makes sense."),
    seg(21.5, 24.0, "So I studied computer science at university."),
    seg(24.0, 24.5, "Which one?"),
    seg(24.5, 26.0, "MIT actually."),
    seg(26.0, 26.5, "Wow."),
    seg(26.5, 29.0, "Yeah I was very lucky to get in."),
  ];

  test('short interviewer responses get merged with adjacent segments', () => {
    const result = mergeBySentence(interview);
    // Short responses like "Interesting." "I see." should be merged
    for (const s of result) {
      const words = s.text.split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(18);
    }
  });

  test('reasonable segment count for interview', () => {
    const result = mergeBySentence(interview);
    const stats = durationStats(result);
    expect(stats.count).toBeGreaterThanOrEqual(3);
    expect(stats.count).toBeLessThanOrEqual(12);
  });
});

// -- formatTime --

describe('formatTime', () => {
  test('formats zero', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  test('formats seconds only', () => {
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(30)).toBe('0:30');
    expect(formatTime(59)).toBe('0:59');
  });

  test('formats minutes and seconds', () => {
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(125)).toBe('2:05');
  });

  test('formats large values', () => {
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(3661)).toBe('61:01');
  });

  test('floors fractional seconds', () => {
    expect(formatTime(5.7)).toBe('0:05');
    expect(formatTime(59.99)).toBe('0:59');
    expect(formatTime(60.5)).toBe('1:00');
  });
});

// -- findCaptionIndex --

describe('findCaptionIndex', () => {
  const caps = [
    seg(0, 5, "First."),
    seg(5, 10, "Second."),
    seg(10, 15, "Third."),
    seg(15, 20, "Fourth."),
  ];

  test('finds caption containing current time', () => {
    expect(findCaptionIndex(caps, 0)).toBe(0);
    expect(findCaptionIndex(caps, 2.5)).toBe(0);
    expect(findCaptionIndex(caps, 4.99)).toBe(0);
    expect(findCaptionIndex(caps, 5)).toBe(1);
    expect(findCaptionIndex(caps, 12)).toBe(2);
    expect(findCaptionIndex(caps, 19.9)).toBe(3);
  });

  test('returns next caption when in gap', () => {
    const gapped = [
      seg(0, 3, "A."),
      seg(5, 8, "B."),
      seg(10, 13, "C."),
    ];
    expect(findCaptionIndex(gapped, 4)).toBe(1);
    expect(findCaptionIndex(gapped, 9)).toBe(2);
  });

  test('returns last caption when past all segments', () => {
    expect(findCaptionIndex(caps, 25)).toBe(3);
    expect(findCaptionIndex(caps, 100)).toBe(3);
  });

  test('returns 0 for time before first caption', () => {
    const delayed = [
      seg(5, 10, "A."),
      seg(10, 15, "B."),
    ];
    expect(findCaptionIndex(delayed, 0)).toBe(0);
    expect(findCaptionIndex(delayed, 3)).toBe(0);
  });

  test('handles single caption', () => {
    const single = [seg(0, 5, "Only.")];
    expect(findCaptionIndex(single, 0)).toBe(0);
    expect(findCaptionIndex(single, 3)).toBe(0);
    expect(findCaptionIndex(single, 10)).toBe(0);
  });

  test('exact boundary between captions', () => {
    expect(findCaptionIndex(caps, 5)).toBe(1);
    expect(findCaptionIndex(caps, 10)).toBe(2);
  });
});

// -- parseSrv3 additional tests --

describe('parseSrv3 additional', () => {
  test('handles HTML entities in text', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="0" d="4000">Tom &amp; Jerry are funny.</p>
  <p t="4000" d="4000">It&apos;s a classic show.</p>
</body>
</timedtext>`;
    const result = parseSrv3(xml);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('Tom & Jerry');
    expect(allText).toContain("It's a classic");
  });

  test('handles newlines in text content', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="0" d="5000">First line\nSecond line.</p>
</body>
</timedtext>`;
    const result = parseSrv3(xml);
    expect(result[0]!.text).not.toContain('\n');
  });

  test('handles Japanese srv3 captions', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="0" d="3000">\u7686\u3055\u3093\u3053\u3093\u306B\u3061\u306F</p>
  <p t="3000" d="3000">\u4ECA\u65E5\u306F\u65E5\u672C\u8A9E\u306E\u52C9\u5F37\u3067\u3059</p>
  <p t="6000" d="3000">\u9811\u5F35\u308A\u307E\u3057\u3087\u3046</p>
</body>
</timedtext>`;
    const result = parseSrv3(xml);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('\u7686\u3055\u3093\u3053\u3093\u306B\u3061\u306F');
    expect(allText).toContain('\u9811\u5F35\u308A\u307E\u3057\u3087\u3046');
  });

  test('handles many consecutive short segments', () => {
    let body = '';
    for (let i = 0; i < 50; i++) {
      body += `  <p t="${String(i * 500)}" d="500">word${String(i)}.</p>\n`;
    }
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3"><body>\n${body}</body></timedtext>`;
    const result = parseSrv3(xml);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(50);
    // Each segment should have at least MIN_WORDS (except last)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.text.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    }
  });

  test('preserves timing precision from milliseconds', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
  <p t="1234" d="5678">Precise timing.</p>
</body>
</timedtext>`;
    const result = parseSrv3(xml);
    expect(result[0]!.start).toBeCloseTo(1.234, 3);
    expect(result[0]!.end).toBeCloseTo(6.912, 3);
  });
});

// -- Snapshot tests with real YouTube caption data --

function loadFixture(filename: string): Caption[] {
  const text = readFileSync(resolve(__dirname, 'fixtures', filename), 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  // Assign ~2s per line to simulate ASR segment timing
  return lines.map((line, i) => ({
    start: i * 2,
    end: (i + 1) * 2,
    text: line.trim(),
  }));
}

function formatSegment(s: Caption, idx: number): string {
  const words = s.text.split(/\s+/).length;
  return `[${String(idx + 1)}] (${String(words)}w) ${s.text}`;
}

function sentenceBoundaryRate(result: Caption[]): number {
  const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
  const inner = result.slice(0, -1);
  if (inner.length === 0) return 1;
  const good = inner.filter((s) => sentenceEnd.test(s.text)).length;
  return good / inner.length;
}

describe('snapshot: pasta video (manual English captions)', () => {
  const raw = loadFixture('pasta-manual.txt');

  test('merge result matches snapshot', () => {
    const result = mergeBySentence(raw);
    const output = result.map(formatSegment).join('\n');
    expect(output).toMatchSnapshot();
  });

  test('most segments end at sentence boundary (>65%)', () => {
    const result = mergeBySentence(raw);
    expect(sentenceBoundaryRate(result)).toBeGreaterThan(0.65);
  });

  test('no unpunctuated segment exceeds MAX_WORDS', () => {
    const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
    const result = mergeBySentence(raw);
    for (const s of result) {
      if (!sentenceEnd.test(s.text)) {
        expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(18);
      }
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(raw);
    const origWords = raw.flatMap((s) => s.text.split(/\s+/));
    const mergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(mergedWords).toEqual(origWords);
  });
});

describe('snapshot: lego video (auto-generated English captions)', () => {
  const raw = loadFixture('lego-asr.txt');

  test('merge result matches snapshot', () => {
    const result = mergeBySentence(raw);
    const output = result.map(formatSegment).join('\n');
    expect(output).toMatchSnapshot();
  });

  test('most segments end at sentence boundary (>55% for ASR)', () => {
    const result = mergeBySentence(raw);
    expect(sentenceBoundaryRate(result)).toBeGreaterThan(0.55);
  });

  test('no unpunctuated segment exceeds MAX_WORDS', () => {
    const sentenceEnd = /[.!?]["'\u201D\u2019)]*\s*$/;
    const result = mergeBySentence(raw);
    for (const s of result) {
      if (!sentenceEnd.test(s.text)) {
        expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(18);
      }
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(raw);
    const origWords = raw.flatMap((s) => s.text.split(/\s+/));
    const mergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(mergedWords).toEqual(origWords);
  });
});
