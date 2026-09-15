import { buildHtml, variantNames } from "./compile.ts";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Live reload, plus a place-keeper: on the way out we stash the source
// line of the topmost visible block, and the fresh render scrolls back to
// it. Pixel offsets would drift the moment an edit above changes the page
// count — which is exactly when you're editing.
const RELOAD_SCRIPT = `
<script>
  (() => {
    const KEY = "quimera-at";
    addEventListener("beforeunload", () => {
      for (const el of document.querySelectorAll("[data-line]")) {
        if (el.getBoundingClientRect().bottom > 0) {
          sessionStorage.setItem(KEY, el.dataset.line);
          return;
        }
      }
    });

    const at = +sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const restore = () => {
      // That line may have been edited away; the first block past it is a
      // better landing spot than the top of the book.
      const blocks = [...document.querySelectorAll("[data-line]")];
      blocks.find((el) => el.dataset.line >= at)?.scrollIntoView();
    };
    if (at && window.Paged) {
      const cfg = (window.PagedConfig ||= {});
      const after = cfg.after;
      cfg.after = async (flow) => { await after?.(flow); restore(); };
    } else if (at) {
      addEventListener("load", restore);
    }

    const ws = new WebSocket("ws://" + location.host + "/ws");
    ws.onmessage = (e) => { if (e.data === "reload") { location.reload(); } };
  })();
<\/script>
`;

// Fixed-corner variant dropdown. Injected as a script that appends to
// <html>, outside <body>, so paged.js — which paginates the body flow —
// doesn't sweep the <select> into a page.
function variantPicker(names, current) {
  if (names.length === 0) {
    return "";
  }
  const opts = names
    .map((n) => `<option value="${n}"${n === current ? " selected" : ""}>${n}</option>`)
    .join("");
  return `
<script>
  (() => {
    const s = document.createElement("select");
    s.id = "variant-picker";
    s.innerHTML = ${JSON.stringify(opts)};
    s.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:9999;" +
      "padding:4px 8px;font:13px sans-serif";
    // Reload carries the reader's place over, same as a rebuild.
    s.onchange = () => {
      const u = new URL(location.href);
      u.searchParams.set("variant", s.value);
      location.href = u.toString();
    };
    document.documentElement.appendChild(s);
  })();
<\/script>
`;
}

// Top + left rulers ticked in the document's centimetres (1cm = 96/2.54
// CSS px, the unit paged.js lays out in). Fixed to the viewport but
// scroll-synced, so they read as a measuring tape over the canvas, with
// 0 at its top-left. Real-size at 100% browser zoom on a standard display.
// Appended to <html> so paged.js — which paginates <body> — leaves it be.
function rulerChrome() {
  return `
<script>
  (() => {
    const T = 22;
    const mk = (horiz) => {
      const c = document.createElement("canvas");
      c.style.cssText = "position:fixed;z-index:9998;left:0;top:0;" +
        (horiz ? "height:" + T + "px;" : "width:" + T + "px;");
      document.documentElement.appendChild(c);
      return c;
    };
    const bars = [[mk(true), true], [mk(false), false]];
    const draw = () => {
      const fit = +getComputedStyle(document.documentElement)
        .getPropertyValue("--fit") || 1;
      const CM = 96 / 2.54 * fit;
      const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
      for (const [c, horiz] of bars) {
        const len = horiz ? W : H;
        c.style.width  = (horiz ? W : T) + "px";
        c.style.height = (horiz ? T : H) + "px";
        c.width  = (horiz ? W : T) * dpr;
        c.height = (horiz ? T : H) * dpr;
        const g = c.getContext("2d");
        g.scale(dpr, dpr);
        g.fillStyle = "#fafafa";
        g.fillRect(0, 0, horiz ? W : T, horiz ? T : H);
        g.strokeStyle = "#aaa";
        g.fillStyle = "#333";
        g.font = "9px sans-serif";
        g.textBaseline = "top";
        g.beginPath();
        const scroll = horiz ? scrollX : scrollY;
        for (let cm = Math.floor(scroll / CM); cm <= (scroll + len) / CM; cm++) {
          for (let m = 0; m < 10; m++) {
            const p = Math.round((cm + m / 10) * CM - scroll) + 0.5;
            const h = m === 0 ? T : m === 5 ? T * 0.5 : T * 0.3;
            if (horiz) { g.moveTo(p, T); g.lineTo(p, T - h); }
            else       { g.moveTo(T, p); g.lineTo(T - h, p); }
          }
          const p = Math.round(cm * CM - scroll) + 2;
          if (horiz) { g.fillText(cm, p, 1); }
          else       { g.fillText(cm, 1, p); }
        }
        g.stroke();
      }
    };
    // Pages lay out at real size; zoom the spread down until a facing pair
    // fits the window. The rulers follow the same factor, so they keep
    // reading in document centimetres.
    let spread = 0;
    const fit = () => {
      const page = document.querySelector(".pagedjs_page");
      if (!page) {
        // A reflowable variant has no pages to fit; otherwise paged.js
        // hasn't finished laying them out yet.
        return window.Paged ? requestAnimationFrame(fit) : draw();
      }
      spread = spread || 2 * page.offsetWidth;
      // Leave the left ruler clear, plus a lateral margin either side.
      const f = Math.min(1, (innerWidth - T - 64) / spread);
      document.documentElement.style.setProperty("--fit", f);
      draw();
    };

    let raf = 0;
    const sched = () => { raf = raf || requestAnimationFrame(() => { raf = 0; draw(); }); };
    addEventListener("scroll", sched, { passive: true });
    addEventListener("resize", fit);
    addEventListener("load", draw);
    fit();
  })();
<\/script>
`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function serveFile(path) {
  if (!existsSync(path)) {
    return null;
  }
  const s = await stat(path);
  if (!s.isFile()) {
    return null;
  }
  const mime = MIME[extname(path)] || "application/octet-stream";
  // Each rebuild is a fresh frame, free to reuse cached stylesheets — and
  // then your CSS edit never shows up. Fonts and images stay cacheable;
  // refetching a megabyte of typeface per keystroke is its own slowness.
  const cache = extname(path) === ".css" ? "no-store" : "max-age=60";
  return new Response(await readFile(path), {
    headers: { "Content-Type": mime, "Cache-Control": cache },
  });
}

export async function preview(projectDir, initialVariant) {
  const clients = new Set();

  const notify = debounce(() => {
    console.log("change → reload");
    for (const ws of clients) {
      ws.send("reload");
    }
  }, 100);

  watch(projectDir, { recursive: true }, (_event, filename) => {
    if (!filename) {
      return;
    }
    if (filename.startsWith(".") || filename.endsWith("~")) {
      return;
    }
    notify();
  });

  const server = Bun.serve({
    port: 4000,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (srv.upgrade(req)) {
          return;
        }
        return new Response("upgrade failed", { status: 400 });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const variant = url.searchParams.get("variant") || initialVariant || undefined;
        const html = await buildHtml(projectDir, variant);
        const names = await variantNames(projectDir);
        const current = variant && names.includes(variant) ? variant : names[0];
        const chrome = rulerChrome() + variantPicker(names, current) + RELOAD_SCRIPT;
        const injected = html.replace("</body>", chrome + "</body>");
        return new Response(injected, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      // Project files: style/*.css, images/*, etc.
      const fromProject = await serveFile(join(projectDir, url.pathname));
      if (fromProject) {
        return fromProject;
      }
      if (url.pathname.startsWith("/style/") && url.pathname.endsWith(".css")) {
        console.warn(`warning: no ${url.pathname.slice(1)} — preview will be unstyled`);
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
      },
      close(ws) {
        clients.delete(ws);
      },
      message() {},
    },
  });

  console.log(`preview at http://localhost:${server.port}`);
}
