/* Study tools across modules: full-text search index, global quiz (with per-module scores)
   and spaced-repetition flashcards (Leitner boxes). All state is a per-viewer convenience in
   localStorage, wrapped in try/catch. */
import { L, LB, tr, getLang } from "./core/i18n.js";
import { el } from "./core/ui.js";
import { MODULES, BLOCKS, byId } from "../modules/registry.js";
import { renderMath } from "./core/template.js";
import { withExtras } from "./data/extra_content.js";

let allMods = null;
/* Import every module definition once (they are small; nothing heavy runs at import). */
export function loadAllModules() {
  if (!allMods)
    allMods = Promise.all(
      MODULES.map((m) =>
        import(`../modules/${m.file}`)
          .then((x) => ({ meta: m, mod: withExtras(x.default, m.id) }))
          .catch(() => null)
      )
    ).then((list) => list.filter(Boolean));
  return allMods;
}

const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\\\(|\\\)|\$\$/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function load(key, def) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? def;
  } catch (e) {
    return def;
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- full-text search */
let index = null;
async function buildIndex() {
  if (index) return index;
  const mods = await loadAllModules();
  index = [];
  for (const { meta, mod } of mods) {
    const parts = [
      [mod.intuition, { es: "Intuición", en: "Intuition" }],
      [mod.physics, { es: "Física", en: "Physics" }],
      ...(mod.interview || []).map((q) => [{ es: q.q.es + " " + q.a.es, en: q.q.en + " " + q.a.en }, { es: "Entrevista", en: "Interview" }]),
      ...(mod.myths || []).map((m) => [m, { es: "Mitos", en: "Myths" }]),
    ];
    for (const [txt, where] of parts) {
      if (!txt) continue;
      const es = strip(txt.es), en = strip(txt.en);
      index.push({ meta, where, es, en, nes: norm(es), nen: norm(en) });
    }
  }
  return index;
}

/* Returns [{meta, where, snippet}] for matches in the module bodies. */
export async function searchBodies(q, limit = 6) {
  const nq = norm(q);
  if (nq.length < 3) return [];
  const idx = await buildIndex();
  const out = [];
  const seen = new Set();
  for (const it of idx) {
    const lang = getLang();
    const hay = lang === "en" ? it.nen : it.nes;
    const txt = lang === "en" ? it.en : it.es;
    const i = hay.indexOf(nq);
    if (i < 0) continue;
    const k = it.meta.id + tr(it.where);
    if (seen.has(k)) continue;
    seen.add(k);
    const a = Math.max(0, i - 40);
    out.push({ meta: it.meta, where: it.where, snippet: (a > 0 ? "…" : "") + txt.slice(a, i + nq.length + 50) + "…" });
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------------------------------------------------------------- global quiz */
const QKEY = "aerolab.quizstats";

export async function quizPage(page) {
  page.innerHTML = `<h1>${L("Quiz global", "Global quiz")}</h1>
    <p class="prose" style="color:var(--fg-muted)">${L(
      "Preguntas mezcladas de todos los módulos (o de un bloque). Tus aciertos se guardan por módulo en este navegador: la tabla de abajo te dice qué repasar.",
      "Mixed questions from every module (or one block). Your scores are stored per module in this browser: the table below tells you what to revise."
    )}</p>`;
  const mods = await loadAllModules();
  const pool = [];
  for (const { meta, mod } of mods) (mod.quiz || []).forEach((q, k) => pool.push({ meta, q, id: `${meta.id}-${k}` }));

  const bar = el("div", { class: "quiz-bar" });
  const sel = el("select", { class: "select", "aria-label": "block" });
  sel.innerHTML = `<option value="">${tr({ es: "Todos los bloques", en: "All blocks" })}</option>` + BLOCKS.map((b) => `<option value="${b.id}">${b.id} · ${tr(b.title)}</option>`).join("");
  const nSel = el("select", { class: "select", "aria-label": "count" });
  nSel.innerHTML = [10, 20, 40].map((n) => `<option value="${n}">${n} ${tr({ es: "preguntas", en: "questions" })}</option>`).join("");
  const go = el("button", { class: "btn primary", type: "button" }, L("Nuevo quiz", "New quiz"));
  const weak = el("button", { class: "btn", type: "button" }, L("Solo mis módulos flojos", "Only my weak modules"));
  bar.append(sel, nSel, go, weak);
  page.appendChild(bar);
  const host = el("div");
  page.appendChild(host);
  const statsBox = el("div", { class: "quiz-stats" });
  page.appendChild(statsBox);

  const stats = () => load(QKEY, {});
  function drawStats() {
    const st = stats();
    const rows = MODULES.filter((m) => st[m.id]).map((m) => ({ m, ...st[m.id], pct: st[m.id].right / st[m.id].total }));
    rows.sort((a, b) => a.pct - b.pct);
    statsBox.innerHTML = rows.length
      ? `<h2>${L("Tus resultados por módulo", "Your results per module")}</h2><table class="tests"><thead><tr><th>${L("Módulo", "Module")}</th><th>${L("Aciertos", "Correct")}</th><th></th></tr></thead><tbody>` +
        rows.map((r) => `<tr><td><a href="#/m/${r.m.id}">${L(r.m.title.es, r.m.title.en)}</a></td><td class="mono">${r.right}/${r.total}</td><td><span class="badge ${r.pct >= 0.75 ? "ok" : "no"}">${Math.round(100 * r.pct)} %</span></td></tr>`).join("") +
        `</tbody></table>`
      : `<p class="prose" style="color:var(--fg-muted)">${L("Aún no hay resultados guardados.", "No saved results yet.")}</p>`;
  }

  function run(onlyWeak) {
    const st = stats();
    let qs = pool.filter((p) => !sel.value || p.meta.block === sel.value);
    if (onlyWeak) {
      const weakIds = new Set(Object.entries(st).filter(([, v]) => v.right / v.total < 0.75).map(([k]) => k));
      const w = qs.filter((p) => weakIds.has(p.meta.id));
      if (w.length) qs = w;
    }
    qs = qs.sort(() => Math.random() - 0.5).slice(0, +nSel.value);
    host.innerHTML = "";
    let right = 0, answered = 0;
    const score = el("div", { class: "quiz-score" });
    const upd = () => (score.innerHTML = L(`Puntuación: ${right}/${answered} (de ${qs.length})`, `Score: ${right}/${answered} (of ${qs.length})`));
    qs.forEach(({ meta, q }, qi) => {
      const box = el("div", { class: "quiz-q" });
      box.innerHTML = `<div class="quiz-src"><a href="#/m/${meta.id}">${meta.block} · ${L(meta.title.es, meta.title.en)}</a></div><div><b>${qi + 1}.</b> ${L(q.q.es, q.q.en)}</div>`;
      const opts = el("div", { class: "opts" });
      const exp = el("div", { class: "explain", style: "display:none" }, L(q.explain.es, q.explain.en));
      let done = false;
      q.options.forEach((o, oi) => {
        const b = el("div", { class: "opt", role: "button", tabindex: "0" }, `<span class="mono">${"abcd"[oi]})</span> <span>${L(o.es, o.en)}</span>`);
        const pick = () => {
          if (done) return;
          done = true;
          answered++;
          const ok = oi === q.correct;
          if (ok) right++;
          b.classList.add(ok ? "correct" : "wrong");
          opts.children[q.correct].classList.add("correct");
          exp.style.display = "block";
          const s = stats();
          s[meta.id] = s[meta.id] || { right: 0, total: 0 };
          s[meta.id].total++;
          if (ok) s[meta.id].right++;
          save(QKEY, s);
          upd();
          drawStats();
          renderMath(exp);
        };
        b.addEventListener("click", pick);
        b.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && pick());
        opts.appendChild(b);
      });
      box.append(opts, exp);
      host.appendChild(box);
    });
    upd();
    host.appendChild(score);
    renderMath(host);
  }
  go.addEventListener("click", () => run(false));
  weak.addEventListener("click", () => run(true));
  run(false);
  drawStats();
}

/* ---------------------------------------------------------------- flashcards (Leitner) */
const FKEY = "aerolab.cards";
const INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];
const today = () => Math.floor(Date.now() / 86400000);

export async function flashcardsPage(page) {
  page.innerHTML = `<h1>${L("Tarjetas de repaso", "Flashcards")}</h1>
    <p class="prose" style="color:var(--fg-muted)">${L(
      "Repetición espaciada (cajas de Leitner): responde en voz alta, gira la tarjeta y sé honesto. Si la sabías, sube de caja y vuelve más tarde (1, 2, 4, 8, 16 días); si no, vuelve a la caja 1.",
      "Spaced repetition (Leitner boxes): answer out loud, flip the card and be honest. If you knew it, it moves up a box and comes back later (1, 2, 4, 8, 16 days); if not, back to box 1."
    )}</p>`;
  const { CHEATSHEET } = await import("./data/cheatsheet.js");
  const mods = await loadAllModules();
  const cards = [];
  CHEATSHEET.forEach((c, i) =>
    cards.push({ id: "cs" + i, block: c.m ? byId[c.m]?.block : "", m: c.m, q: c.t, a: { es: "<ul>" + c.es.map((x) => `<li>${x}</li>`).join("") + "</ul>", en: "<ul>" + c.en.map((x) => `<li>${x}</li>`).join("") + "</ul>" } })
  );
  for (const { meta, mod } of mods) (mod.interview || []).forEach((qa, k) => cards.push({ id: `${meta.id}-iv${k}`, block: meta.block, m: meta.id, q: qa.q, a: qa.a }));

  const bar = el("div", { class: "quiz-bar" });
  const sel = el("select", { class: "select", "aria-label": "block" });
  sel.innerHTML = `<option value="">${tr({ es: "Todos los bloques", en: "All blocks" })}</option>` + BLOCKS.map((b) => `<option value="${b.id}">${b.id} · ${tr(b.title)}</option>`).join("");
  const reset = el("button", { class: "btn", type: "button" }, L("Reiniciar progreso", "Reset progress"));
  const info = el("div", { class: "fc-info mono" });
  bar.append(sel, reset, info);
  page.appendChild(bar);
  const stage = el("div", { class: "fc-stage" });
  page.appendChild(stage);

  const state = () => load(FKEY, {});
  function due() {
    const st = state();
    const t = today();
    return cards
      .filter((c) => !sel.value || c.block === sel.value)
      .filter((c) => !st[c.id] || st[c.id].due <= t)
      .sort((a, b) => (st[a.id]?.box || 0) - (st[b.id]?.box || 0) || Math.random() - 0.5);
  }
  function boxes() {
    const st = state();
    const n = [0, 0, 0, 0, 0, 0];
    for (const c of cards) if (!sel.value || c.block === sel.value) n[st[c.id]?.box || 0]++;
    return n;
  }
  function next() {
    const list = due();
    const b = boxes();
    info.innerHTML = `${tr({ es: "pendientes hoy", en: "due today" })}: <b>${list.length}</b> · ${tr({ es: "cajas", en: "boxes" })} 0–5: ${b.join(" / ")}`;
    stage.innerHTML = "";
    if (!list.length) {
      stage.appendChild(el("div", { class: "callout key" }, L("¡Nada pendiente por hoy en esta selección! Vuelve mañana o elige otro bloque.", "Nothing due today in this selection! Come back tomorrow or pick another block.")));
      return;
    }
    const c = list[0];
    const card = el("div", { class: "fc-card" });
    card.innerHTML = `<div class="fc-src">${c.m ? `<a href="#/m/${c.m}">${byId[c.m].block} · ${L(byId[c.m].title.es, byId[c.m].title.en)}</a>` : ""}</div><div class="fc-q">${L(c.q.es, c.q.en)}</div>`;
    const ans = el("div", { class: "fc-a prose", style: "display:none" }, LB(c.a.es, c.a.en));
    const flip = el("button", { class: "btn primary", type: "button" }, L("Mostrar respuesta", "Show answer"));
    const yes = el("button", { class: "btn good", type: "button", style: "display:none" }, L("✓ La sabía", "✓ I knew it"));
    const no = el("button", { class: "btn", type: "button", style: "display:none" }, L("✗ No la sabía", "✗ I didn't"));
    const grade = (ok) => {
      const st = state();
      const box = ok ? Math.min(5, (st[c.id]?.box || 0) + 1) : 1;
      st[c.id] = { box, due: today() + INTERVAL_DAYS[box] };
      save(FKEY, st);
      next();
    };
    flip.addEventListener("click", () => {
      ans.style.display = "block";
      flip.style.display = "none";
      yes.style.display = no.style.display = "";
      renderMath(ans);
    });
    yes.addEventListener("click", () => grade(true));
    no.addEventListener("click", () => grade(false));
    const row = el("div", { class: "fc-actions" });
    row.append(flip, no, yes);
    card.append(ans, row);
    stage.appendChild(card);
    renderMath(card);
  }
  sel.addEventListener("change", next);
  reset.addEventListener("click", () => {
    save(FKEY, {});
    next();
  });
  next();
}
