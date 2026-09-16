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

const T = { ...DEFAULTS, ...JUSTIFY };

function lineBadness(
  wordWidth: number,
  spaceCount: number,
  maxWidth: number,
  normalSpace: number,
  isLast: boolean,
): number {
  // A last line isn't justified, so it renders at its natural width —
  // words plus their inter-word spaces. Check that full width, not just
  // the word widths, or a line that fits on words alone but overflows
  // once spaces are added will be wrongly kept unbroken.
  if (isLast) return wordWidth + spaceCount * normalSpace > maxWidth ? HUGE : 0;
  if (spaceCount <= 0) {
    const slack = maxWidth - wordWidth;
    return slack < 0 ? HUGE : slack * slack * 10;
  }
  const sp = (maxWidth - wordWidth) / spaceCount;
  if (sp < 0 || sp < normalSpace * T.minSpace) return HUGE;
  const r = (sp - normalSpace) / normalSpace;
  const riverExcess = sp / normalSpace - T.riverSpace;
  const tight = normalSpace * T.tightSpace;
  return (
    Math.abs(r) ** 3 * T.stretch +
    (riverExcess > 0 ? T.river + riverExcess ** 2 * T.riverCurve : 0) +
    (sp < tight ? T.tight + (tight - sp) ** 2 * T.tightCurve : 0)
  );
}

type Line = {
  words: string[];
  wordWidth: number;
  spaceCount: number;
  isLast: boolean;
  maxWidth: number;
};

// `indent` shortens the first line only — a line starting at word 0 is the
// first line, so the DP can price it correctly without tracking line numbers.
function layoutOptimal(
  words: string[],
  widths: number[],
  maxWidth: number,
  normalSpace: number,
  indent: number,
): Line[] | null {
  const n = words.length;
  if (n === 0) return [];

  const dp = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  dp[0] = 0;

  for (let j = 1; j <= n; j++) {
    let wordWidth = 0;
    for (let k = j - 1; k >= 0; k--) {
      wordWidth += widths[k]!;
      if (wordWidth > maxWidth * 2) break;
      if (dp[k] === Infinity) continue;
      const mw = k === 0 ? maxWidth - indent : maxWidth;
      const cost = dp[k]! + lineBadness(wordWidth, j - k - 1, mw, normalSpace, j === n);
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
    for (let w = from; w < to; w++) wordWidth += widths[w]!;
    lines.push({
      words: words.slice(from, to),
      wordWidth,
      spaceCount: to - from - 1,
      isLast: i === breaks.length - 1,
      maxWidth: i === 0 ? maxWidth - indent : maxWidth,
    });
    from = to;
  }
  return lines;
}

function run() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const bs = getComputedStyle(document.body);
  ctx.font = `${bs.fontSize} ${bs.fontFamily}`;
  const normalSpace = ctx.measureText(" ").width;

  for (const el of document.querySelectorAll("p")) {
    // Markup we can't measure. A paragraph-number anchor (paranum.ts) is
    // the exception: it wraps a bare word and is re-hung below.
    const opaque = [...el.childNodes].some(
      (n) => n.nodeType === Node.ELEMENT_NODE && !(n as Element).hasAttribute("data-num"),
    );
    if (opaque) continue;
    const text = el.textContent?.trim() ?? "";
    if (!text) continue;

    const maxWidth = MEASURE_WIDTH ? contentWidth(el) : COL_WIDTH;
    if (!(maxWidth > 0)) continue;

    // text-indent inherits, so it would land on every line-span once the
    // paragraph is rebuilt. Take it off the paragraph and re-apply it to the
    // first line only — after the breaker has budgeted for it.
    const indent = parseFloat(getComputedStyle(el).textIndent) || 0;

    const words = text.split(/\s+/);
    const widths = words.map((w) => ctx.measureText(w).width);
    const lines = layoutOptimal(words, widths, maxWidth, normalSpace, indent);
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
      if (!line.isLast && line.spaceCount > 0) {
        const natural = line.wordWidth + line.spaceCount * normalSpace;
        if (natural >= line.maxWidth * T.shortLine) {
          const sp = (line.maxWidth - line.wordWidth) / line.spaceCount;
          span.style.wordSpacing = `${sp - normalSpace}px`;
        }
      }
      span.textContent = line.words.join(" ");
      el.appendChild(span);
    }

    // Re-hang the number on the first line, which paged.js keeps with the
    // text it breaks: anchored to the paragraph box instead, the number
    // would strand on a fragment that got no lines at all.
    if (num) {
      el.firstElementChild!.setAttribute("data-num", num);
    }
  }
}

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
