/* AeroLab shell: sidebar navigation, search, language/theme/interview toggles,
   engine status, hash router (home, modules, glossary, cheat sheet, tests). */
import { L, LB, getLang, setLang, tr } from "./core/i18n.js";
import { el } from "./core/ui.js";
import { physics, setActiveLab } from "./bridge/physics.js";
import { MODULES, BLOCKS, byId } from "../modules/registry.js";
import { renderModule, renderMath } from "./core/template.js";
import { progress } from "./core/progress.js";
import { FlowView } from "./core/field.js";
import { quizPage, flashcardsPage, searchBodies } from "./study.js";
import { withExtras } from "./data/extra_content.js";
import { auditPage } from "./dev/audit.js";

const sidebar = document.getElementById("sidebar");
const topbar = document.getElementById("topbar");
const page = document.getElementById("page");

physics.start();

/* ---------- theme ---------- */
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("aerolab.theme", t);
  } catch (e) {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("themechange"));
}
try {
  const t = localStorage.getItem("aerolab.theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
} catch (e) {
  /* ignore */
}

/* ---------- top bar ---------- */
function buildTopbar() {
  topbar.innerHTML = "";
  const menu = el("button", { class: "tbtn menu-btn", type: "button", "aria-label": "Menú / Menu" }, "☰");
  menu.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  const spacer = el("div", { class: "spacer" });
  const engine = el("span", { class: "pill engine-pill", title: "Python (Pyodide) physics engine" });
  physics.onStatus((s) => {
    engine.classList.toggle("ready", s.ready);
    engine.classList.toggle("error", s.stage === "error");
    const msg = {
      boot: L("Iniciando motor…", "Starting engine…"),
      pyodide: L("Descargando Python…", "Downloading Python…"),
      numpy: L("Cargando NumPy…", "Loading NumPy…"),
      engine: L("Cargando física…", "Loading physics…"),
      ready: L("Motor Python listo", "Python engine ready"),
      error: L("Error del motor", "Engine error"),
    }[s.stage];
    engine.innerHTML = `<span class="led"></span><span class="lbl">${msg}</span>`;
  });
  const interview = el("button", { class: "tbtn", type: "button", "aria-pressed": "false" }, `🎤 <span class="lbl">${L("Modo entrevista", "Interview mode")}</span>`);
  const setInterview = (on) => {
    document.body.classList.toggle("interview", on);
    interview.classList.toggle("on", on);
    interview.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem("aerolab.interview", on ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  };
  interview.addEventListener("click", () => {
    setInterview(!document.body.classList.contains("interview"));
    document.querySelectorAll(".qa").forEach((d) => (d.open = false));
  });
  try {
    if (localStorage.getItem("aerolab.interview") === "1") setInterview(true);
  } catch (e) {
    /* ignore */
  }
  const theme = el("button", { class: "tbtn", type: "button", title: "Tema claro / oscuro · Light / dark theme", "aria-label": "Tema claro / oscuro · Light / dark theme" }, "◐");
  theme.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    setTheme(cur);
  });
  const ls = el("div", { class: "lang-switch", role: "group", "aria-label": "language" });
  const bes = el("button", { type: "button" }, "ES");
  const ben = el("button", { type: "button" }, "EN");
  const sync = () => {
    bes.classList.toggle("on", getLang() === "es");
    ben.classList.toggle("on", getLang() === "en");
  };
  bes.addEventListener("click", () => setLang("es"));
  ben.addEventListener("click", () => setLang("en"));
  window.addEventListener("langchange", sync);
  sync();
  ls.append(bes, ben);
  topbar.append(menu, spacer, engine, interview, theme, ls);
}

/* ---------- sidebar ---------- */
function buildSidebar() {
  sidebar.innerHTML = `
    <a class="brand" href="#/">
      <svg width="34" height="34" viewBox="0 0 64 64"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
      <path d="M4 38 C 18 18, 44 18, 60 30 C 44 30, 26 34, 4 38Z" fill="url(#lg)"/><path d="M2 46 C 20 40, 42 40, 62 44" stroke="#22d3ee" stroke-opacity=".5" fill="none" stroke-width="2"/><path d="M2 54 C 22 49, 42 49, 62 52" stroke="#a78bfa" stroke-opacity=".4" fill="none" stroke-width="2"/></svg>
      <span><b>AeroLab</b><small>${L("Aerodinámica F1", "F1 aerodynamics")}</small></span></a>`;
  const search = el("input", { class: "search", type: "search", placeholder: "🔍  " + (getLang() === "es" ? "Buscar conceptos…" : "Search concepts…") });
  const results = el("div", { class: "search-results" });
  window.addEventListener("langchange", () => (search.placeholder = "🔍  " + (getLang() === "es" ? "Buscar conceptos…" : "Search concepts…")));
  search.addEventListener("input", async () => {
    const q = search.value.trim().toLowerCase();
    results.innerHTML = "";
    if (q.length < 2) return;
    const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const nq = norm(q);
    const hits = MODULES.filter((m) => norm(m.title.es + " " + m.title.en + " " + m.kw).includes(nq)).slice(0, 8);
    for (const m of hits) results.appendChild(el("a", { href: `#/m/${m.id}` }, L(m.title.es, m.title.en) + `<span class="sr-kind">${m.block}</span>`));
    const { GLOSSARY } = await import("./data/glossary.js");
    const gh = GLOSSARY.filter((g) => norm(g.es + " " + g.en + " " + g.d.es + " " + g.d.en).includes(nq)).slice(0, 6);
    for (const g of gh) results.appendChild(el("a", { href: `#/glossary/${encodeURIComponent(g.en)}` }, L(g.es, g.en) + `<span class="sr-kind">${L("glosario", "glossary")}</span>`));
    // full text of the modules (theory, interview answers, myths)
    const body = await searchBodies(q, 8);
    if (search.value.trim().toLowerCase() !== q) return; // a newer query is being typed
    for (const b of body)
      results.appendChild(
        el("a", { href: `#/m/${b.meta.id}`, class: "sr-body" }, `${L(b.meta.title.es, b.meta.title.en)}<span class="sr-kind">${b.meta.block} · ${tr(b.where)}</span><small>${b.snippet}</small>`)
      );
  });
  // close the result list once a result is chosen (or the page changes)
  const clearSearch = () => {
    search.value = "";
    results.innerHTML = "";
  };
  results.addEventListener("click", (e) => e.target.closest("a") && clearSearch());
  window.addEventListener("hashchange", () => results.childElementCount && clearSearch());
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearSearch();
    if (e.key === "Enter") {
      const first = results.querySelector("a");
      if (first) location.hash = first.getAttribute("href");
    }
  });
  sidebar.append(search, results);
  const pb = el("div");
  const updProg = () => {
    const pct = Math.round((progress.count() / MODULES.length) * 100);
    pb.innerHTML = `<div class="progress-bar"><i style="width:${pct}%"></i></div><div class="progress-label">${L("Progreso", "Progress")}: ${progress.count()}/${MODULES.length}</div>`;
  };
  updProg();
  sidebar.appendChild(pb);
  const nav = el("nav");
  for (const b of BLOCKS) {
    const blk = el("div", { class: "nav-block" });
    blk.innerHTML = `<div class="nav-block-title"><span class="bl">${b.id}</span>${L(b.title.es, b.title.en)}</div>`;
    for (const m of MODULES.filter((x) => x.block === b.id)) {
      const a = el("a", { class: "nav-item", href: `#/m/${m.id}`, "data-id": m.id }, `<span class="dot"></span>${L(m.title.es, m.title.en)}`);
      blk.appendChild(a);
    }
    nav.appendChild(blk);
  }
  sidebar.appendChild(nav);
  const links = el("div", { class: "nav-links" });
  links.innerHTML = `
    <a class="nav-item" href="#/cheatsheet" data-id="cheatsheet">📋 ${L("Chuleta de entrevista", "Interview cheat sheet")}</a>
    <a class="nav-item" href="#/quiz" data-id="quiz">🎯 ${L("Quiz global", "Global quiz")}</a>
    <a class="nav-item" href="#/flashcards" data-id="flashcards">🗂️ ${L("Tarjetas de repaso", "Flashcards")}</a>
    <a class="nav-item" href="#/glossary" data-id="glossary">📖 ${L("Glosario ES/EN", "Glossary ES/EN")}</a>
    <a class="nav-item" href="#/tests" data-id="tests">🧪 ${L("Validación del motor", "Engine validation")}</a>`;
  sidebar.appendChild(links);
  const syncDone = () => {
    sidebar.querySelectorAll(".nav-item[data-id]").forEach((a) => a.classList.toggle("done", progress.has(a.dataset.id)));
    updProg();
  };
  window.addEventListener("progresschange", syncDone);
  syncDone();
}

function setActive(id) {
  sidebar.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
}

/* ---------- pages ---------- */
function homePage() {
  page.innerHTML = "";
  const hero = el("div", { class: "home-hero" });
  const fv = new FlowView(hero, { height: 380, world: { x0: -2.4, x1: 3.2, y0: -1.2, y1: 1.2 }, particles: 1400, trail: 0.93, speed: 0.005 });
  physics.call("joukowski.solve", { eps: 0.1, camber: 0.09, alpha: 7, x0: -2.6, x1: 3.4, y0: -1.4, y1: 1.4, nx: 120, ny: 56 }).then((r) => {
    fv.setBodies([{ x: r.surface.x.map((v) => v + 0.6), y: r.surface.y }]);
    fv.setField({ ...r.field, x: r.field.x.map((v) => v + 0.6) }, { reseed: true });
  }).catch(() => {});
  const txt = el("div", { class: "hh-text" });
  txt.innerHTML = `<h1>AeroLab</h1>
    ${LB("<p>Aerodinámica interactiva y físicamente correcta, pensada para preparar entrevistas técnicas de aerodinámica en F1. Cada concepto se entiende jugando: todos los gadgets se resuelven en tiempo real con un motor de física en <b>Python</b> (paneles, capa límite, línea sustentadora, VLM, vórtices, toberas) que corre en tu navegador.</p>",
    "<p>Interactive, physically correct aerodynamics, built to prepare F1 aerodynamics interviews. Every concept is learnt by playing: all gadgets are solved in real time by a <b>Python</b> physics engine (panels, boundary layer, lifting line, VLM, vortices, nozzles) running in your browser.</p>")}
    <div class="hh-cta"><a class="btn primary" href="#/m/a3">${L("Empezar: cómo se genera el lift →", "Start: how lift is generated →")}</a><a class="btn" href="#/m/a1">${L("Desde el principio", "From the beginning")}</a><a class="btn" href="#/cheatsheet">${L("Chuleta de entrevista", "Interview cheat sheet")}</a></div>`;
  hero.appendChild(txt);
  page.appendChild(hero);
  const stats = el("div", { class: "stat-row" });
  stats.innerHTML = `
    <div class="stat"><b>${MODULES.length}</b><span>${L("módulos interactivos", "interactive modules")}</span></div>
    <div class="stat"><b>60+</b><span>${L("laboratorios con física real", "labs with real physics")}</span></div>
    <div class="stat"><b>ES · EN</b><span>${L("todo el contenido bilingüe", "fully bilingual content")}</span></div>
    <div class="stat"><b>22</b><span>${L("validaciones contra teoría y datos", "checks against theory and data")}</span></div>`;
  page.appendChild(stats);
  const grid = el("div", { class: "block-grid" });
  for (const b of BLOCKS) {
    const card = el("div", { class: "block-card" });
    card.innerHTML = `<div class="bl">${L("BLOQUE", "BLOCK")} ${b.id}</div><h3>${L(b.title.es, b.title.en)}</h3>` +
      MODULES.filter((m) => m.block === b.id).map((m) => `<a href="#/m/${m.id}" class="${progress.has(m.id) ? "done" : ""}">${L(m.title.es, m.title.en)}</a>`).join("");
    grid.appendChild(card);
  }
  page.appendChild(grid);
  const how = el("div", { class: "section prose" });
  how.innerHTML = LB(
    `<h2>Cómo usar AeroLab</h2><ul>
     <li><b>Sigue el orden</b> de los bloques: cada módulo se apoya en los anteriores (p. ej. la capa límite explica la entrada en pérdida, el efecto suelo y el multielemento).</li>
     <li>En cada laboratorio, <b>predice antes de mover el slider</b>: "¿qué pasará con el pico de succión si…?". Luego compruébalo.</li>
     <li>Activa el <b>modo entrevista</b> (arriba) para practicar: oculta la teoría y deja solo preguntas y gadgets.</li>
     <li>Los términos técnicos aparecen también en inglés, porque la entrevista puede serlo. Cambia de idioma en cualquier momento sin perder el estado de los gadgets.</li>
     <li>Cada gadget dice qué modelo resuelve y sus limitaciones. La página <a href="#/tests">Validación del motor</a> compara los solvers con soluciones analíticas.</li></ul>`,
    `<h2>How to use AeroLab</h2><ul>
     <li><b>Follow the block order</b>: every module builds on the previous ones (e.g. the boundary layer explains stall, ground effect and multi-element behaviour).</li>
     <li>In every lab, <b>predict before moving the slider</b>: "what will happen to the suction peak if…?". Then check.</li>
     <li>Switch on <b>interview mode</b> (top bar) to practise: theory is hidden, only questions and gadgets remain.</li>
     <li>Technical terms are given in Spanish and English. Switch language at any time without losing gadget state.</li>
     <li>Each gadget states which model it solves and its limitations. The <a href="#/tests">Engine validation</a> page compares the solvers with analytical solutions.</li></ul>`
  );
  page.appendChild(how);
}

async function modulePage(id) {
  const meta = byId[id];
  if (!meta) return homePage();
  page.innerHTML = `<div class="prose" style="padding:40px 0;color:var(--fg-muted)">${L("Cargando módulo…", "Loading module…")}</div>`;
  let mod;
  try {
    mod = (await import(`../modules/${meta.file}`)).default;
  } catch (e) {
    console.error(e);
    // A failed dynamic import is remembered by the browser for that URL; retry once with a fresh one
    // (covers a transient network hiccup or a server restart).
    try {
      mod = (await import(`../modules/${meta.file}?retry=${Date.now()}`)).default;
    } catch (e2) {
      console.error(e2);
      page.innerHTML = "";
      page.appendChild(await loadErrorBox(e2));
      return;
    }
  }
  try {
    renderModule(page, withExtras(mod, meta.id), meta);
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="callout warn"><div class="ct">Error</div>${e.message}</div>`;
  }
}

/* The page and the Python engine are already in memory, so the app keeps working until it needs a
   file it has not downloaded yet. If the local server was closed, say so plainly. */
async function serverAlive() {
  try {
    const r = await fetch(new URL(`./app.js?ping=${Date.now()}`, import.meta.url), { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function loadErrorBox(err) {
  const alive = await serverAlive();
  const box = el("div", { class: "callout warn" });
  const port = location.port || "8765";
  box.innerHTML = alive
    ? `<div class="ct">${L("Error al cargar el módulo", "Error loading the module")}</div>
       <p class="mono" style="font-size:13px">${err.message}</p>
       <p>${L("El servidor responde, así que el fallo está en el propio módulo. Mira la consola del navegador (F12) para el detalle.",
              "The server is answering, so the problem is in the module itself. Check the browser console (F12) for details.")}</p>`
    : `<div class="ct">${L("El servidor local no responde", "The local server is not responding")}</div>
       <p>${L(`AeroLab necesita su servidor local para descargar cada módulo la primera vez que lo abres. Parece que se ha cerrado (por ejemplo, al cerrar la ventana de terminal). Vuelve a arrancarlo y pulsa <b>Reintentar</b>:`,
              `AeroLab needs its local server to download each module the first time you open it. It seems to have stopped (for example, the terminal window was closed). Start it again and press <b>Retry</b>:`)}</p>
       <pre class="mono" style="padding:8px 12px;background:var(--bg-sunken, rgba(0,0,0,.25));border-radius:8px">python serve.py ${port === "8765" ? "" : port}</pre>
       <p style="color:var(--fg-muted)">${L("En Windows también puedes hacer doble clic en <b>AeroLab.bat</b> (deja esa ventana abierta mientras estudias).",
              "On Windows you can also double-click <b>AeroLab.bat</b> (keep that window open while you study).")}</p>`;
  const btn = el("button", { class: "btn primary" }, L("Reintentar", "Retry"));
  btn.addEventListener("click", () => location.reload());
  box.appendChild(btn);
  return box;
}

async function glossaryPage(focus) {
  const { GLOSSARY } = await import("./data/glossary.js");
  page.innerHTML = `<h1>${L("Glosario español / inglés", "Spanish / English glossary")}</h1>
    <p class="prose" style="color:var(--fg-muted)">${L("Términos clave con su traducción. En la entrevista usa el término en inglés si la entrevista es en inglés.", "Key terms with their translation. Use the English term if the interview is in English.")}</p>`;
  const grid = el("div", { class: "gloss-grid" });
  const sorted = [...GLOSSARY].sort((a, b) => tr({ es: a.es, en: a.en }).localeCompare(tr({ es: b.es, en: b.en })));
  for (const g of sorted) {
    const c = el("div", { class: "gloss", id: "g-" + encodeURIComponent(g.en) });
    c.innerHTML = `<h4><span class="i-es">${g.es} <span class="en-term">(${g.en})</span></span><span class="i-en">${g.en} <span class="en-term">(${g.es})</span></span></h4><p>${L(g.d.es, g.d.en)}</p>`;
    if (g.m) c.innerHTML += `<p style="margin-top:6px"><a href="#/m/${g.m}">→ ${L(byId[g.m].title.es, byId[g.m].title.en)}</a></p>`;
    grid.appendChild(c);
  }
  page.appendChild(grid);
  renderMath(page);
  if (focus) {
    const t = document.getElementById("g-" + focus);
    if (t) {
      t.scrollIntoView({ block: "center" });
      t.style.boxShadow = "var(--glow)";
    }
  }
}

async function cheatPage() {
  const { CHEATSHEET } = await import("./data/cheatsheet.js");
  page.innerHTML = `<h1>${L("Chuleta de entrevista", "Interview cheat sheet")}</h1>
  <p class="prose" style="color:var(--fg-muted)">${L("Las respuestas modelo más importantes en una sola página. Úsala para el repaso final.", "The most important model answers on one page. Use it for the final review.")}</p>`;
  const wrap = el("div", { class: "cheat" });
  for (const c of CHEATSHEET) {
    const card = el("div", { class: "card" });
    card.innerHTML = `<h4>${L(c.t.es, c.t.en)}</h4>${LB("<ul>" + c.es.map((x) => `<li>${x}</li>`).join("") + "</ul>", "<ul>" + c.en.map((x) => `<li>${x}</li>`).join("") + "</ul>")}` +
      (c.m ? `<p style="margin:6px 0 0;font-size:13px"><a href="#/m/${c.m}">→ ${L("ir al módulo", "go to module")}</a></p>` : "");
    wrap.appendChild(card);
  }
  page.appendChild(wrap);
  renderMath(page);
}

async function testsPage() {
  page.innerHTML = `<h1>${L("Validación del motor de física", "Physics engine validation")}</h1>
    <div class="prose">${LB(
      "<p>Estos casos se ejecutan <b>dentro de tu navegador</b> (Pyodide) con el mismo código Python que valida <code>pytest</code> en local (<code>python -m pytest</code>). Cada fila compara un solver con una solución analítica o un resultado clásico tabulado.</p>",
      "<p>These cases run <b>inside your browser</b> (Pyodide) with the same Python code validated locally by <code>pytest</code> (<code>python -m pytest</code>). Each row compares a solver with an analytical solution or a classic tabulated result.</p>"
    )}<p><a class="btn" href="#/audit">🔍 ${L("Auditoría de la interfaz (todos los módulos y controles)", "Interface audit (every module and control)")}</a></p></div><div id="tests-out" class="prose" style="color:var(--fg-muted)">${L("Ejecutando…", "Running…")}</div>`;
  try {
    const r = await physics.call("tests.run");
    const rows = r.checks.map((c) => `<tr><td>${c.pass ? '<span class="badge ok">PASS</span>' : '<span class="badge no">FAIL</span>'}</td><td>${c.name}</td><td class="mono">${c.value == null ? "–" : (+c.value).toPrecision(5)}</td><td class="mono">${(+c.ref).toPrecision(5)}</td><td class="mono">${c.tol}</td></tr>`).join("");
    document.getElementById("tests-out").innerHTML = `<p><b>${r.passed}/${r.total}</b> ${L("casos superados", "cases passed")}</p>
      <table class="tests"><thead><tr><th></th><th>${L("Caso", "Case")}</th><th>${L("Valor", "Value")}</th><th>${L("Referencia", "Reference")}</th><th>${L("Tolerancia", "Tolerance")}</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (e) {
    document.getElementById("tests-out").textContent = "Error: " + e.message;
  }
}

/* ---------- router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [kind, arg] = h.split("/");
  document.body.classList.remove("nav-open");
  setActiveLab(null);
  window.scrollTo(0, 0);
  if (kind === "m") {
    setActive(arg);
    modulePage(arg);
  } else if (kind === "glossary") {
    setActive("glossary");
    glossaryPage(arg);
  } else if (kind === "cheatsheet") {
    setActive("cheatsheet");
    cheatPage();
  } else if (kind === "quiz") {
    setActive("quiz");
    quizPage(page);
  } else if (kind === "flashcards") {
    setActive("flashcards");
    flashcardsPage(page);
  } else if (kind === "audit") {
    setActive("tests");
    auditPage(page);
  } else if (kind === "tests") {
    setActive("tests");
    testsPage();
  } else {
    setActive(null);
    homePage();
  }
}

buildTopbar();
buildSidebar();
window.addEventListener("hashchange", route);
window.addEventListener("katexready", () => renderMath(page));
route();
// KaTeX loads with "defer"; re-typeset once available
window.addEventListener("load", () => renderMath(page));

/* Offline support: the service worker caches the libraries and every file the site fetches.
   Once the engine is ready, all module definitions are loaded in the background so they are
   cached too (and the full-text search index is ready). */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
physics.onStatus((s) => {
  if (s.ready && !window.__warmed) {
    window.__warmed = true;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => import("./study.js").then((m) => m.loadAllModules()).catch(() => {}));
  }
});
