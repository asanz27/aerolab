/* Renders a module page from its definition (intuition, physics, labs, interview,
   myths, quiz, references) and wires KaTeX, progress and quiz scoring. */
import { L, LB, tr } from "./i18n.js";
import { el } from "./ui.js";
import { FlowView } from "./field.js";
import { physics, setActiveLab } from "../bridge/physics.js";
import { MODULES, BLOCKS } from "../../modules/registry.js";
import { progress } from "./progress.js";

function renderMath(root) {
  if (window.renderMathInElement) {
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  }
}

const heroCache = new Map();

/* Header flow picture: each block gets a scene that matches its topic (all solved by the
   Python engine): an airfoil (Joukowski) by default, an inverted wing in ground effect for
   G/J, a vortex pair for E and a Venturi duct for H. */
const HERO_SCENES = {
  ground: {
    world: { x0: -1.5, x1: 2.6, y0: -0.36, y1: 0.62 },
    call: () =>
      physics.call("airfoil.analyze", {
        spec: { code: "4412", invert: true, n: 100 }, alpha: -5, re: 3e6, ground_h: 0.12, viscous: false,
        field: { x0: -1.6, x1: 2.7, y0: -0.4, y1: 0.66, nx: 120, ny: 46 },
      }),
    show: (fv, r) => {
      const gy = r.ground_y;
      fv.setBodies([
        ...r.elements.map((e) => ({ x: e.x, y: e.y })),
        { x: [-3, 4, 4, -3], y: [gy, gy, gy - 1, gy - 1], fill: null, stroke: "#fbbf24", width: 2 },
      ]);
      const f = r.field;
      fv.setField({ ...f, u: f.u.map((row, j) => row.map((v) => (f.y[j] < gy ? NaN : v))), v: f.v.map((row, j) => row.map((v) => (f.y[j] < gy ? NaN : v))) }, { reseed: true });
    },
  },
  vortex: {
    world: { x0: -2.6, x1: 2.6, y0: -1.0, y1: 1.0 },
    call: () =>
      physics.call("potential.superpose", {
        elements: [{ type: "vortex", x: -0.2, y: 0.32, strength: 2.2 }, { type: "vortex", x: -0.2, y: -0.32, strength: -2.2 }],
        x0: -2.8, x1: 2.8, y0: -1.2, y1: 1.2, nx: 110, ny: 50,
      }),
    show: (fv, r) => {
      fv.setBodies([]);
      fv.setField(r, { reseed: true });
    },
  },
  duct: {
    world: { x0: -0.02, x1: 1.02, y0: -0.24, y1: 0.24 },
    call: () => physics.call("duct.solve", { ctrl_x: [0, 0.3, 0.45, 0.55, 1], ctrl_h: [0.2, 0.2, 0.09, 0.09, 0.17] }),
    show: (fv, r) => {
      const top = { x: [...r.x, 1.1, -0.1], y: [...r.h, 0.5, 0.5] };
      const bot = { x: [...r.x, 1.1, -0.1], y: [...r.h.map((h) => -h), -0.5, -0.5] };
      fv.setBodies([top, bot]);
      const f = r.field;
      const n = (a) => a.map((row) => row.map((v) => v / 10)); // U_in = 10 m/s -> unit speed
      fv.setField({ x: f.x, y: f.y, u: n(f.u), v: n(f.v) }, { reseed: true });
    },
  },
};
const BLOCK_SCENE = { E: "vortex", G: "ground", J: "ground", H: "duct" };

function heroFlow(container, params, block) {
  const sceneName = BLOCK_SCENE[block];
  const scene = sceneName && HERO_SCENES[sceneName];
  const world = scene ? scene.world : { x0: -2.6, x1: 2.6, y0: -1.0, y1: 1.0 };
  const fv = new FlowView(container, { height: 230, world, particles: 700, trail: 0.9, speed: 0.006 });
  if (scene) {
    const hit = heroCache.get(sceneName);
    const go = (r) => {
      heroCache.set(sceneName, r);
      scene.show(fv, r);
    };
    if (hit) scene.show(fv, hit);
    else scene.call().then(go).catch(() => {});
    return fv;
  }
  const p = params || { eps: 0.09, camber: 0.07, alpha: 6 };
  const key = JSON.stringify(p);
  const show = (r) => {
    fv.setBodies([{ x: r.surface.x, y: r.surface.y }]);
    fv.setField(r.field, { reseed: true });
  };
  if (heroCache.has(key)) show(heroCache.get(key));
  else
    physics
      .call("joukowski.solve", { ...p, x0: -2.8, x1: 2.8, y0: -1.2, y1: 1.2, nx: 90, ny: 44 })
      .then((r) => {
        heroCache.set(key, r);
        show(r);
      })
      .catch(() => {});
  return fv;
}

function section(cls, num, title, body) {
  const s = el("section", { class: "section " + cls });
  s.innerHTML = `<h2><span class="sn">${num}</span>${L(title.es, title.en)}</h2>`;
  if (body) {
    const d = el("div", { class: "prose" }, body);
    s.appendChild(d);
  }
  return s;
}

function quizBlock(quiz) {
  const wrap = el("div");
  let correct = 0;
  let answered = 0;
  const score = el("div", { class: "quiz-score" });
  const upd = () => (score.innerHTML = L(`Puntuación: ${correct}/${quiz.length}`, `Score: ${correct}/${quiz.length}`));
  quiz.forEach((q, qi) => {
    const box = el("div", { class: "quiz-q" });
    box.innerHTML = `<div><b>${qi + 1}.</b> ${L(q.q.es, q.q.en)}</div>`;
    const opts = el("div", { class: "opts" });
    const exp = el("div", { class: "explain", style: "display:none" }, L(q.explain.es, q.explain.en));
    let done = false;
    q.options.forEach((o, oi) => {
      const b = el("div", { class: "opt", role: "button", tabindex: "0" }, `<span class="mono">${"abcd"[oi]})</span> <span>${L(o.es, o.en)}</span>`);
      const pick = () => {
        if (done) return;
        done = true;
        answered++;
        if (oi === q.correct) correct++;
        b.classList.add(oi === q.correct ? "correct" : "wrong");
        opts.children[q.correct].classList.add("correct");
        exp.style.display = "block";
        upd();
        renderMath(exp);
      };
      b.addEventListener("click", pick);
      b.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && pick());
      opts.appendChild(b);
    });
    box.append(opts, exp);
    wrap.appendChild(box);
  });
  upd();
  wrap.appendChild(score);
  return wrap;
}

/* "Calculating…" badge and error banner of a lab card, driven by the physics bridge. */
function wireLabState(card) {
  const badge = el("span", { class: "lab-status", role: "status", "aria-live": "polite" });
  card.querySelector("h3").appendChild(badge);
  const err = el("div", { class: "lab-error", role: "alert" });
  card.appendChild(err);
  let timer = null;
  card.addEventListener("labstate", (ev) => {
    const { busy, error, ok } = ev.detail;
    clearTimeout(timer);
    if (busy > 0) timer = setTimeout(() => card.classList.add("busy"), 350);
    else card.classList.remove("busy");
    badge.innerHTML = L("calculando…", "computing…");
    if (error) {
      err.innerHTML = L(
        `<b>El modelo no ha podido resolver estos parámetros.</b> La gráfica muestra el último resultado válido. Detalle: <code>${String(error).slice(0, 220)}</code>`,
        `<b>The model could not solve these parameters.</b> The plot shows the last valid result. Detail: <code>${String(error).slice(0, 220)}</code>`
      );
      card.classList.add("has-error");
    } else if (ok) card.classList.remove("has-error");
  });
  for (const t of ["input", "change", "click", "pointerdown", "keydown"]) card.addEventListener(t, () => setActiveLab(card), true);
}

export function renderModule(root, mod, meta) {
  root.innerHTML = "";
  const block = BLOCKS.find((b) => b.id === meta.block);
  const idx = MODULES.findIndex((m) => m.id === meta.id);

  // hero
  const hero = el("div", { class: "mod-hero" });
  const hc = el("div", { class: "hero-canvas" });
  hero.appendChild(hc);
  if (mod.hero) mod.hero(hc);
  else heroFlow(hc, mod.heroParams, meta.block);
  const ht = el("div", { class: "hero-text" });
  ht.innerHTML = `<div class="kicker">${L("Bloque", "Block")} ${meta.block} · ${L(block.title.es, block.title.en)}</div>
    <h1>${L(meta.title.es, meta.title.en)}</h1><p>${L(mod.subtitle.es, mod.subtitle.en)}</p>`;
  hero.appendChild(ht);
  root.appendChild(hero);

  const banner = el("div", { class: "callout key interview-banner" }, L(
    "<b>Modo entrevista</b>: solo preguntas y laboratorios. Intenta responder en voz alta antes de abrir cada respuesta.",
    "<b>Interview mode</b>: questions and labs only. Try to answer out loud before opening each answer."
  ));
  root.appendChild(banner);

  const body = el("div", { class: "mod-body" });
  root.appendChild(body);
  let n = 1;
  const num = () => String(n++).padStart(2, "0");
  body.appendChild(section("sec-intuition", num(), { es: "Intuición", en: "Intuition" }, LB(mod.intuition.es, mod.intuition.en)));
  body.appendChild(section("sec-physics", num(), { es: "Física y ecuaciones", en: "Physics and equations" }, LB(mod.physics.es, mod.physics.en)));

  const labs = section("sec-labs", num(), { es: "Laboratorio interactivo", en: "Interactive lab" });
  // attach before mounting: labs start animation loops that stop as soon as their canvas is not
  // in the document, so it must already be there when they first check
  body.appendChild(labs);
  for (const lab of mod.labs) {
    const card = el("div", { class: "lab-card" });
    card.innerHTML = `<h3>${L(lab.title.es, lab.title.en)}</h3>` + (lab.desc ? `<p class="lab-desc">${L(lab.desc.es, lab.desc.en)}</p>` : "");
    const holder = el("div");
    card.appendChild(holder);
    labs.appendChild(card);
    wireLabState(card);
    setActiveLab(card);
    try {
      lab.mount(holder);
    } catch (e) {
      console.error(e);
      holder.textContent = "Lab error: " + e.message;
    }
    setActiveLab(null);
  }

  const iv = section("sec-interview", num(), { es: "Lo que te preguntarán en la entrevista", en: "What you'll be asked in the interview" });
  for (const qa of mod.interview) {
    const d = el("details", { class: "qa" });
    d.innerHTML = `<summary>${L(qa.q.es, qa.q.en)}</summary><div class="ans prose">${LB(qa.a.es, qa.a.en)}</div>`;
    iv.appendChild(d);
  }
  body.appendChild(iv);

  const my = section("sec-myths", num(), { es: "Errores comunes y mitos", en: "Common mistakes and myths" });
  for (const m of mod.myths) {
    my.appendChild(el("div", { class: "myth" }, `<span class="x">✗</span><div>${LB(m.es, m.en)}</div>`));
  }
  body.appendChild(my);

  const qz = section("sec-quiz", num(), { es: "Quiz rápido", en: "Quick quiz" });
  qz.appendChild(quizBlock(mod.quiz));
  body.appendChild(qz);

  const rf = section("sec-refs", num(), { es: "Referencias", en: "References" });
  rf.appendChild(el("ul", { class: "refs" }, mod.refs.map((r) => `<li>${r}</li>`).join("")));
  body.appendChild(rf);

  // footer: completion + prev/next
  const foot = el("div", { class: "mod-footer" });
  const prev = MODULES[idx - 1];
  const next = MODULES[idx + 1];
  const doneBtn = el("button", { class: "btn primary", type: "button" });
  const syncDone = () =>
    (doneBtn.innerHTML = progress.has(meta.id) ? L("✓ Completado", "✓ Completed") : L("Marcar como completado", "Mark as completed"));
  doneBtn.addEventListener("click", () => {
    progress.toggle(meta.id);
    syncDone();
  });
  syncDone();
  foot.append(
    prev ? el("a", { class: "btn", href: `#/m/${prev.id}` }, "← " + L(prev.title.es, prev.title.en)) : el("span"),
    doneBtn,
    next ? el("a", { class: "btn", href: `#/m/${next.id}` }, L(next.title.es, next.title.en) + " →") : el("span")
  );
  root.appendChild(foot);
  renderMath(root);
}

export { renderMath, tr };
