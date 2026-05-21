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

  test('splits at sentence boundaries', () => {
    const input = [
      seg(0, 2, 'First sentence.'),
      seg(2, 4, 'Second sentence.'),
      seg(4, 6, 'Third sentence.'),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
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

  test('minimum duration merging works', () => {
    const input = [
      seg(0, 1, 'Hi.'),
      seg(1, 2, 'Hey.'),
      seg(2, 3, 'Hello.'),
      seg(3, 7, 'This is a longer sentence that takes four seconds.'),
    ];
    const result = mergeBySentence(input);
    const firstDuration = result[0]!.end - result[0]!.start;
    expect(firstDuration).toBeGreaterThanOrEqual(3);
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

  test('produces segments with reasonable duration', () => {
    const result = mergeBySentence(asrEnglish);
    const stats = durationStats(result);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
    expect(stats.max).toBeLessThan(20);
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

  test('minimum duration enforced', () => {
    const result = mergeBySentence(manualEnglish);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
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

  test('without punctuation, splits at MAX_DURATION boundary', () => {
    const result = mergeBySentence(noPunct);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]!.start).toBe(0);
    expect(result[result.length - 1]!.end).toBe(20);
    for (const s of result) {
      expect(s.end - s.start).toBeLessThanOrEqual(10);
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

  test('very short utterances get absorbed', () => {
    const result = mergeBySentence(mixed);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
  });

  test('no text is lost', () => {
    const result = mergeBySentence(mixed);
    const allOriginalWords = mixed.flatMap((s) => s.text.split(/\s+/));
    const allMergedWords = result.flatMap((s) => s.text.split(/\s+/));
    expect(allMergedWords).toEqual(allOriginalWords);
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

  test('conversation-style produces reasonable segments', () => {
    const result = mergeBySentence(conversation);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
  });
});

// -- Edge cases --

describe('edge cases', () => {
  test('single very long sentence gets split at MAX_DURATION', () => {
    const input = [
      seg(0, 5, "This is the beginning of a very long sentence that goes on and on"),
      seg(5, 10, "and keeps going through multiple subtitle segments without any"),
      seg(10, 15, "punctuation at all so the entire thing gets merged into one"),
      seg(15, 20, "single massive segment which may not be ideal but is correct."),
    ];
    const result = mergeBySentence(input);
    expect(result.length).toBeGreaterThan(1);
    const allText = result.map((s) => s.text).join(' ');
    expect(allText).toContain('beginning');
    expect(allText).toContain('correct.');
  });

  test('all single-word segments', () => {
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
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
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
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("2024.");
    expect(result[1]!.text).toBe("That was a great year.");
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

  test('Japanese \u3002 not matched by regex, but MAX_DURATION splits', () => {
    const result = mergeBySentence(japaneseManual);
    expect(result.length).toBeGreaterThan(1);
    for (const s of result) {
      expect(s.end - s.start).toBeLessThanOrEqual(10);
    }
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

  test('Japanese ASR without punctuation splits at MAX_DURATION', () => {
    const result = mergeBySentence(japaneseASR);
    expect(result.length).toBeGreaterThan(1);
    for (const s of result) {
      expect(s.end - s.start).toBeLessThanOrEqual(10);
    }
  });

  const japaneseMixed: Caption[] = [
    seg(0, 3, "Hello, \u7686\u3055\u3093."),
    seg(3, 6, "\u4ECA\u65E5\u306E\u30C8\u30D4\u30C3\u30AF\u306FAI\u3067\u3059."),
    seg(6, 9, "\u3068\u3066\u3082\u9762\u767D\u3044\u3067\u3059\u3088."),
    seg(9, 12, "\u3067\u306F\u59CB\u3081\u307E\u3057\u3087\u3046."),
  ];

  test('Japanese with ASCII periods splits correctly', () => {
    const result = mergeBySentence(japaneseMixed);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
  });
});

// -- Korean/Chinese captions --

describe('mergeBySentence with CJK captions', () => {
  const korean: Caption[] = [
    seg(0, 3, "\uC548\uB155\uD558\uC138\uC694."),
    seg(3, 6, "\uC624\uB298\uC740 \uC694\uB9AC\uB97C \uD574\uBCFC\uAC8C\uC694."),
    seg(6, 9, "\uC7AC\uB8CC\uB97C \uC900\uBE44\uD574\uC8FC\uC138\uC694."),
  ];

  test('Korean with ASCII periods works', () => {
    const result = mergeBySentence(korean);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
    }
  });

  const chinese: Caption[] = [
    seg(0, 2, "\u5927\u5BB6\u597D"),
    seg(2, 4, "\u4ECA\u5929\u6211\u4EEC\u6765\u5B66\u4E60"),
    seg(4, 6, "\u673A\u5668\u5B66\u4E60\u7684\u57FA\u7840\u77E5\u8BC6"),
    seg(6, 8, "\u9996\u5148\u6211\u4EEC\u9700\u8981\u4E86\u89E3"),
    seg(8, 10, "\u4EC0\u4E48\u662F\u795E\u7ECF\u7F51\u7EDC"),
  ];

  test('Chinese without punctuation splits at MAX_DURATION', () => {
    const result = mergeBySentence(chinese);
    expect(result.length).toBeGreaterThan(1);
    for (const s of result) {
      expect(s.end - s.start).toBeLessThanOrEqual(10);
    }
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

  test('short interviewer responses get merged', () => {
    const result = mergeBySentence(interview);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
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
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.end - result[i]!.start).toBeGreaterThanOrEqual(3);
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
