// Client-side optimal paragraph justification.
// Injected into the HTML and run in PagedConfig.before (before paged.js paginates).
// COL_WIDTH is replaced at inject time with the computed column width in CSS px.

// COL_WIDTH is the page column width in CSS px, baked in for print output:
// pretext runs before paged.js paginates, so the DOM can't be measured then.
// MEASURE_WIDTH is set for web output, where there's no pagination and each
// paragraph already sits at its final width — so we measure it directly.
declare const COL_WIDTH: number;
declare const MEASURE_WIDTH: boolean;
// The variant's `justification` block from config.ts.
declare const JUSTIFY: Partial<typeof DEFAULTS>;

// A paragraph's usable content width in CSS px (client width minus padding).
function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

const HUGE = 1e8;

const DEFAULTS = {
  // -- space widths, as a multiple of the font's normal word space
  // below this a line is rejected outright
  minSpace: 0.4,
  // below this a line reads tight, above riverSpace it reads as a river
  tightSpace: 0.65,
  riverSpace: 1.5,
  // a line naturally shorter than this fraction of the column isn't stretched
  shortLine: 0.6,

  // -- badness weights, meaningful only relative to each other
  // any deviation from normal, cubed
  stretch: 1000,
  // flat toll for crossing riverSpace, then quadratic on the excess
  river: 5000,
  riverCurve: 10000,
  // flat toll for crossing tightSpace, then quadratic on the shortfall
  tight: 3000,
  tightCurve: 10000,
};

// Reassignable so the justification playground can re-break the same text
// under new knobs without a rebuild; every other target sets it once.
let T = { ...DEFAULTS, ...JUSTIFY };

// `spaceNatural` is the summed untouched width of this line's inter-word
// spaces. It isn't spaceCount * one number: a space set in italic is not the
// width of a space set in roman, and a line can hold both. Every knob is
// expressed against the line's own average space, so they keep meaning
// "multiple of a normal space" no matter which fonts the line mixes.
function lineBadness(
  wordWidth: number,
  spaceNatural: number,
  spaceCount: number,
  maxWidth: number,
  isLast: boolean,
): number {
  // A last line isn't justified, so it renders at its natural width —
  // words plus their inter-word spaces. Check that full width, not just
  // the word widths, or a line that fits on words alone but overflows
  // once spaces are added will be wrongly kept unbroken.
  if (isLast) return wordWidth + spaceNatural > maxWidth ? HUGE : 0;
  if (spaceCount <= 0) {
    const slack = maxWidth - wordWidth;
    return slack < 0 ? HUGE : slack * slack * 10;
  }
  const avg = spaceNatural / spaceCount;
  if (!(avg > 0)) return HUGE;
  const sp = (maxWidth - wordWidth) / spaceCount;
  if (sp < 0 || sp < avg * T.minSpace) return HUGE;
  const r = (sp - avg) / avg;
  const riverExcess = sp / avg - T.riverSpace;
  const tight = avg * T.tightSpace;
  return (
    Math.abs(r) ** 3 * T.stretch +
    (riverExcess > 0 ? T.river + riverExcess ** 2 * T.riverCurve : 0) +
    (sp < tight ? T.tight + (tight - sp) ** 2 * T.tightCurve : 0)
  );
}

// A run of text sharing one inline context — the chain of <em>/<strong>/<a>
// ancestors it sits under, innermost last. `ctx` is the live chain from the
// source DOM; it is compared by identity and shallow-cloned when re-emitted.
type Piece = { text: string; ctx: Element[]; width: number };

// The unbreakable unit. Usually one piece, but markup boundaries don't have to
// coincide with word boundaries: `<em>J'accuse</em>(fuck my French)` opens a
// word in italic and closes it in roman, with no space to break at.
type Word = { pieces: Piece[]; width: number; spaceWidth: number };

type Line = {
  words: Word[];
  wordWidth: number;
  spaceNatural: number;
  spaceCount: number;
  isLast: boolean;
  maxWidth: number;
};

// `indent` shortens the first line only — a line starting at word 0 is the
// first line, so the DP can price it correctly without tracking line numbers.
function layoutOptimal(words: Word[], maxWidth: number, indent: number): Line[] | null {
  const n = words.length;
  if (n === 0) return [];

  const dp = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  dp[0] = 0;

  for (let j = 1; j <= n; j++) {
    let wordWidth = 0;
    let spaceNatural = 0;
    for (let k = j - 1; k >= 0; k--) {
      wordWidth += words[k]!.width;
      // The space joining word k to k+1 only exists once k+1 is inside the line.
      if (k < j - 1) spaceNatural += words[k + 1]!.spaceWidth;
      if (wordWidth > maxWidth * 2) break;
      if (dp[k] === Infinity) continue;
      const mw = k === 0 ? maxWidth - indent : maxWidth;
      const cost = dp[k]! + lineBadness(wordWidth, spaceNatural, j - k - 1, mw, j === n);
      if (cost < dp[j]!) {
        dp[j] = cost;
        prev[j] = k;
      }
    }
  }

  if (dp[n]! >= HUGE) return null;

  const breaks: number[] = [];
  let cur = n;
  while (cur > 0) {
    breaks.push(cur);
    cur = prev[cur]!;
  }
  breaks.reverse();

  const lines: Line[] = [];
  let from = 0;
  for (let i = 0; i < breaks.length; i++) {
    const to = breaks[i]!;
    let wordWidth = 0;
    let spaceNatural = 0;
    for (let w = from; w < to; w++) {
      wordWidth += words[w]!.width;
      if (w > from) spaceNatural += words[w]!.spaceWidth;
    }
    lines.push({
      words: words.slice(from, to),
      wordWidth,
      spaceNatural,
      spaceCount: to - from - 1,
      isLast: i === breaks.length - 1,
      maxWidth: i === 0 ? maxWidth - indent : maxWidth,
    });
    from = to;
  }
  return lines;
}

// Markup that isn't a styled run of text: it has a width we can't get from
// measureText, so a paragraph containing one still falls back to the browser.
// This is the whole of what "opaque" now means.
const UNMEASURABLE =
  /^(img|br|svg|video|audio|canvas|input|button|select|textarea|iframe|object|embed|math|hr|table)$/;

// Flatten a paragraph into pieces, in reading order. Returns null if anything
// inside can't be measured. `fontOf` is memoized per element by the caller:
// getComputedStyle is the expensive part of this whole pass.
function collectPieces(
  root: Element,
  measure: (text: string, font: string) => number,
  fontOf: (el: Element) => string,
): { pieces: Piece[]; breaks: boolean[] } | null {
  const pieces: Piece[] = [];
  // breaks[i] — is piece i separated from piece i-1 by whitespace?
  const breaks: boolean[] = [];
  let pendingSpace = false;
  let ok = true;

  const walk = (node: Element, ctx: Element[]) => {
    if (!ok) return;
    const font = fontOf(ctx.length ? ctx[ctx.length - 1]! : root);
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Keep the separators: they decide where words begin.
        for (const part of (child.nodeValue ?? "").split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            pendingSpace = true;
            continue;
          }
          breaks.push(pendingSpace);
          pieces.push({ text: part, ctx, width: measure(part, font) });
          pendingSpace = false;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (UNMEASURABLE.test(el.tagName.toLowerCase())) {
          ok = false;
          return;
        }
        // An inline-block or floated child has layout of its own; measuring it
        // as text would be a guess. Leave the paragraph to the browser.
        if (!getComputedStyle(el).display.startsWith("inline")) {
          ok = false;
          return;
        }
        walk(el, [...ctx, el]);
        if (!ok) return;
      }
    }
  };

  walk(root, []);
  return ok ? { pieces, breaks } : null;
}

// Group pieces into words and price the space before each one. A space takes
// the font of the text it follows, which is also where it gets re-emitted.
function buildWords(
  pieces: Piece[],
  breaks: boolean[],
  measure: (text: string, font: string) => number,
  fontOf: (el: Element) => string,
  root: Element,
): Word[] {
  const words: Word[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    if (words.length === 0 || breaks[i]) {
      words.push({ pieces: [p], width: p.width, spaceWidth: 0 });
    } else {
      const w = words[words.length - 1]!;
      w.pieces.push(p);
      w.width += p.width;
    }
  }
  for (let i = 1; i < words.length; i++) {
    const prevPieces = words[i - 1]!.pieces;
    const tail = prevPieces[prevPieces.length - 1]!;
    const el = tail.ctx.length ? tail.ctx[tail.ctx.length - 1]! : root;
    words[i]!.spaceWidth = measure(" ", fontOf(el));
  }
  return words;
}

// Re-emit one line's words into `span`, rebuilding the inline markup each
// piece sat under. An element spanning a line break is cloned into both lines,
// which is what the browser does internally with an inline box too.
function emitLine(span: HTMLElement, line: Line) {
  let curCtx: Element[] | null = null;
  let sink: Node = span;

  const append = (text: string) => {
    const last = sink.lastChild;
    // Coalesce, so a word split across pieces doesn't become three text nodes.
    if (last && last.nodeType === Node.TEXT_NODE) last.nodeValue += text;
    else sink.appendChild(document.createTextNode(text));
  };

  for (let i = 0; i < line.words.length; i++) {
    // The space goes into whatever context the previous word ended in — the
    // same font it was measured with in buildWords().
    if (i > 0) append(" ");
    for (const piece of line.words[i]!.pieces) {
      if (piece.ctx !== curCtx) {
        curCtx = piece.ctx;
        sink = span;
        for (const el of piece.ctx) {
          const clone = el.cloneNode(false) as Element;
          // A duplicated id is invalid, and cloning is exactly how lines get
          // duplicated here.
          clone.removeAttribute("id");
          sink.appendChild(clone);
          sink = clone;
        }
      }
      append(piece.text);
    }
  }
}

function run(knobs: Partial<typeof DEFAULTS> = {}) {
  T = { ...DEFAULTS, ...JUSTIFY, ...knobs };

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // getComputedStyle dominates the cost of this pass, and a book reuses the
  // same handful of faces throughout — so cache the font per element, and the
  // measured width per (text, font).
  const fontCache = new Map<Element, string>();
  const fontOf = (el: Element) => {
    let f = fontCache.get(el);
    if (f === undefined) {
      const cs = getComputedStyle(el);
      f = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      fontCache.set(el, f);
    }
    return f;
  };
  const widthCache = new Map<string, number>();
  const measure = (text: string, font: string) => {
    const key = font + " " + text;
    let w = widthCache.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      widthCache.set(key, w);
    }
    return w;
  };

  for (const el of document.querySelectorAll("p")) {
    if (!el.textContent?.trim()) continue;

    const maxWidth = MEASURE_WIDTH ? contentWidth(el) : COL_WIDTH;
    if (!(maxWidth > 0)) continue;

    const collected = collectPieces(el, measure, fontOf);
    // Something in here isn't styled text — an image, a float. The browser's
    // own breaker handles it; we leave the paragraph untouched.
    if (!collected) continue;
    const words = buildWords(collected.pieces, collected.breaks, measure, fontOf, el);

    // text-indent inherits, so it would land on every line-span once the
    // paragraph is rebuilt. Take it off the paragraph and re-apply it to the
    // first line only — after the breaker has budgeted for it.
    const indent = parseFloat(getComputedStyle(el).textIndent) || 0;

    const lines = layoutOptimal(words, maxWidth, indent);
    if (!lines) continue;

    const num = el.querySelector("[data-num]")?.getAttribute("data-num");

    el.innerHTML = "";
    el.style.textIndent = "0";
    for (const line of lines) {
      const span = document.createElement("span");
      span.style.display = "block";
      span.style.whiteSpace = "nowrap";
      span.style.breakInside = "avoid";
      if (line.maxWidth < maxWidth) span.style.textIndent = `${maxWidth - line.maxWidth}px`;
      // The line's inter-word space as a multiple of a normal one: 1 is
      // untouched, and it's the only quantity lineBadness() scores. The
      // justify playground reads it back off the DOM to colour the line.
      //
      // word-spacing adds a fixed delta to every space, so the same delta
      // closes the line exactly even when its spaces started out at different
      // widths — the natural total is what has to be subtracted, not an
      // assumed count times one width.
      let ratio = 1;
      if (!line.isLast && line.spaceCount > 0) {
        const natural = line.wordWidth + line.spaceNatural;
        if (natural >= line.maxWidth * T.shortLine) {
          const avg = line.spaceNatural / line.spaceCount;
          const sp = (line.maxWidth - line.wordWidth) / line.spaceCount;
          span.style.wordSpacing = `${sp - avg}px`;
          ratio = sp / avg;
        }
      }
      span.dataset.space = ratio.toFixed(2);
      emitLine(span, line);
      el.appendChild(span);
    }

    // Re-hang the number on the first line, which paged.js keeps with the
    // text it breaks: anchored to the paragraph box instead, the number
    // would strand on a fragment that got no lines at all.
    if (num) {
      // The source anchor wrapped the first word, so it has been faithfully
      // cloned back into line 1 — but the number has to hang off the line box,
      // not a word inside it, or paged.js can still strand it.
      for (const stale of el.querySelectorAll("[data-num]")) stale.removeAttribute("data-num");
      el.firstElementChild!.setAttribute("data-num", num);
    }
  }
}

// The playground drives these by hand, a page at a time.
(window as any).pretext = { run, defaults: DEFAULTS };

if (MEASURE_WIDTH) {
  // Web output: no paged.js to call PagedConfig.before, so run once the
  // layout is settled and the print font is ready.
  const start = async () => {
    await document.fonts.ready;
    run();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    void start();
  }
} else {
  // Print output: run inside paged.js's before-hook, ahead of pagination.
  const orig = (window as any).PagedConfig?.before;
  (window as any).PagedConfig = (window as any).PagedConfig ?? {};
  (window as any).PagedConfig.before = async function (this: unknown) {
    if (orig) await orig.call(this);
    await document.fonts.ready;
    run();
  };
}
