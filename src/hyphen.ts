// Liang's hyphenation algorithm, as used by TeX.
//
// The idea, from Frank Liang's 1983 thesis: instead of a dictionary, carry a
// few thousand short patterns like "hy3ph" or "n2at". Each is a letter
// sequence interleaved with digits, and each digit is a vote about whether a
// hyphen may fall at that position. Lay every pattern that matches the word
// over the word, keep the highest vote at each position, and a hyphen is
// allowed where the winning vote is odd. Even votes are vetoes — patterns
// exist mostly to overrule other patterns.
//
// This is a faithful port, not an approximation: same patterns, same
// odd-wins rule, same \lefthyphenmin/\righthyphenmin, same exception list.

import { PATTERNS, EXCEPTIONS, LEFT_MIN, RIGHT_MIN } from "./hyphen-patterns.en-us.ts";

// A pattern split into its letters and its per-position votes. `points` is one
// longer than `letters`: a vote sits before the first letter, between each
// pair, and after the last.
type Pattern = { letters: string; points: number[] };

// Patterns are indexed by their letter sequence so the scan is a map lookup
// per substring rather than a walk over all 4938 of them. A trie would be
// faster still, but this runs once per distinct word and the width cache in
// pretext means most words are only ever hyphenated once.
let index: Map<string, number[]> | null = null;
let exceptions: Map<string, number[]> | null = null;

function parse(pattern: string): Pattern {
  let letters = "";
  const points: number[] = [0];
  for (const ch of pattern) {
    if (ch >= "0" && ch <= "9") {
      // Overwrite the slot we just opened: digits always precede the letter
      // they apply to, and never appear two in a row.
      points[points.length - 1] = Number(ch);
    } else {
      letters += ch;
      points.push(0);
    }
  }
  return { letters, points };
}

function build() {
  index = new Map();
  for (const raw of PATTERNS) {
    const { letters, points } = parse(raw);
    index.set(letters, points);
  }
  exceptions = new Map();
  for (const word of EXCEPTIONS) {
    // "as-so-ciate" → breaks after positions 2 and 4.
    const breaks: number[] = [];
    let i = 0;
    for (const ch of word) {
      if (ch === "-") breaks.push(i);
      else i++;
    }
    exceptions.set(word.replace(/-/g, ""), breaks);
  }
}

// Break positions inside `word`, as indices into it: a hyphen may be inserted
// before the character at each returned index. Empty if the word shouldn't be
// broken at all.
export function hyphenate(word: string): number[] {
  if (!index || !exceptions) build();
  const lower = word.toLowerCase();

  // TeX only hyphenates runs of letters; anything else (a numeral, an em
  // dash, a word already carrying a hyphen) it leaves to the author.
  if (!/^[a-z]+$/.test(lower)) return [];
  if (lower.length < LEFT_MIN + RIGHT_MIN) return [];

  const known = exceptions!.get(lower);
  if (known) return known.filter((p) => p >= LEFT_MIN && lower.length - p >= RIGHT_MIN);

  // "." marks the word boundary, and is a character patterns can match on —
  // that is how a pattern says "only at the start of a word".
  const text = "." + lower + ".";
  const votes = new Array<number>(text.length + 1).fill(0);

  for (let i = 0; i < text.length; i++) {
    for (let j = i + 1; j <= text.length; j++) {
      const points = index!.get(text.slice(i, j));
      if (!points) continue;
      // Highest vote wins at every position the pattern covers.
      for (let k = 0; k < points.length; k++) {
        const at = i + k;
        if (points[k]! > votes[at]!) votes[at] = points[k]!;
      }
    }
  }

  const breaks: number[] = [];
  // votes[0] sits before the leading ".", so a vote at index p in `votes`
  // falls before character p-1 of the original word.
  for (let p = LEFT_MIN; p <= lower.length - RIGHT_MIN; p++) {
    if (votes[p + 1]! % 2 === 1) breaks.push(p);
  }
  return breaks;
}
