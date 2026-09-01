import { buildHtml, variantNames } from "./build.ts";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

const TOOL_DIR = new URL(".", import.meta.url).pathname;

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

const RELOAD_SCRIPT = `
<script>
  const ws = new WebSocket("ws://" + location.host + "/ws");
  ws.onmessage = (e) => { if (e.data === "reload") location.reload(); };
</script>
`;

// Fixed-corner variant dropdown. Changing it reloads with ?variant=<name>;
// the choice rides the query string through live-reloads. Injected as a
// script that appends to <html>, outside <body>, so paged.js — which
// paginates the body flow — doesn't sweep the <select> into a page.
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
    const KEY = "variant-scroll";
    const s = document.createElement("select");
    s.id = "variant-picker";
    s.innerHTML = ${JSON.stringify(opts)};
    s.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:9999;" +
      "padding:4px 8px;font:13px sans-serif";
    s.onchange = () => {
      // Stash scroll so the swap lands on the same passage.
      sessionStorage.setItem(KEY, String(scrollY));
      const u = new URL(location.href);
      u.searchParams.set("variant", s.value);
      location.href = u.toString();
    };
    document.documentElement.appendChild(s);

    // paged.js repaginates asynchronously, so the page grows tall enough
    // to scroll only some frames after load. Retry scrollTo until we
    // reach the stashed offset (or give up after ~2s).
    const y = sessionStorage.getItem(KEY);
    if (y !== null) {
      sessionStorage.removeItem(KEY);
      const target = +y;
      let tries = 0;
      const tick = () => {
        scrollTo(0, target);
        if (scrollY < target - 1 && tries++ < 120) requestAnimationFrame(tick);
      };
      addEventListener("load", () => requestAnimationFrame(tick));
    }
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
    const CM = 96 / 2.54, T = 22;
    const mk = (horiz) => {
      const c = document.createElement("canvas");
      c.style.cssText = "position:fixed;z-index:9998;left:0;top:0;" +
        (horiz ? "height:" + T + "px;" : "width:" + T + "px;");
      document.documentElement.appendChild(c);
      return c;
    };
    const bars = [[mk(true), true], [mk(false), false]];
    const draw = () => {
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
    let raf = 0;
    const sched = () => { raf = raf || requestAnimationFrame(() => { raf = 0; draw(); }); };
    addEventListener("scroll", sched, { passive: true });
    addEventListener("resize", sched);
    addEventListener("load", draw);
    draw();
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
  return new Response(await readFile(path), {
    headers: { "Content-Type": mime },
  });
}

export async function preview(projectDir) {
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
        const variant = url.searchParams.get("variant") || undefined;
        const html = await buildHtml(projectDir, variant);
        const names = await variantNames(projectDir);
        const current = variant && names.includes(variant) ? variant : names[0];
        const chrome = rulerChrome() + variantPicker(names, current) + RELOAD_SCRIPT;
        const injected = html.replace("</body>", chrome + "</body>");
        return new Response(injected, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      // Project files first (style.css, images/*, etc.). If the project
      // has no style.css, fall back to the tool's template.css so bare
      // projects still render styled.
      const fromProject = await serveFile(join(projectDir, url.pathname));
      if (fromProject) {
        return fromProject;
      }
      if (url.pathname === "/style/default.css") {
        const fromTool = await serveFile(join(TOOL_DIR, "template.css"));
        if (fromTool) {
          return fromTool;
        }
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
