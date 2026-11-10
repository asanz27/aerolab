/* Small UI kit for the labs: sliders, toggles, selects, readouts and lab layout. */
import { L, tr, onLang } from "./i18n.js";

export function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}

const fmtDefault = (v, step) => {
  const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return Number(v).toFixed(d);
};

/* Slider with bilingual label. opts: {label:{es,en}, min, max, step, value, unit, format, onInput, log} */
export function slider(opts) {
  const { min, max, step = 0.01, unit = "", log = false } = opts;
  const wrap = el("label", { class: "ctl ctl-slider" });
  const head = el("div", { class: "ctl-head" });
  head.innerHTML = `<span class="ctl-label">${L(opts.label.es, opts.label.en)}</span>`;
  const val = el("output", { class: "ctl-value" });
  head.appendChild(val);
  const input = el("input", { type: "range" });
  const toPos = (v) => (log ? Math.log10(v) : v);
  const fromPos = (p) => (log ? Math.pow(10, p) : p);
  input.min = toPos(min);
  input.max = toPos(max);
  input.step = log ? (toPos(max) - toPos(min)) / 200 : step;
  input.value = toPos(opts.value);
  const fmt = opts.format || ((v) => fmtDefault(v, step));
  const api = {
    el: wrap,
    get value() {
      return fromPos(parseFloat(input.value));
    },
    set value(v) {
      input.value = toPos(v);
      show();
    },
    input,
  };
  function show() {
    val.textContent = fmt(api.value) + (unit ? " " + unit : "");
  }
  input.addEventListener("input", () => {
    show();
    opts.onInput && opts.onInput(api.value);
  });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  show();
  wrap.append(head, input);
  return api;
}

export function toggle(opts) {
  const wrap = el("label", { class: "ctl ctl-toggle" });
  const input = el("input", { type: "checkbox" });
  input.checked = !!opts.value;
  wrap.append(input, el("span", { class: "switch" }), el("span", { class: "ctl-label" }, L(opts.label.es, opts.label.en)));
  input.addEventListener("change", () => opts.onInput && opts.onInput(input.checked));
  return {
    el: wrap,
    get value() {
      return input.checked;
    },
    set value(v) {
      input.checked = !!v;
    },
  };
}

/* options: [{value, label:{es,en}}] rendered as segmented buttons */
export function segmented(opts) {
  const wrap = el("div", { class: "ctl ctl-seg" });
  if (opts.label) wrap.appendChild(el("div", { class: "ctl-label" }, L(opts.label.es, opts.label.en)));
  const row = el("div", { class: "seg-row", role: "radiogroup" });
  let value = opts.value;
  const btns = opts.options.map((o) => {
    const b = el("button", { type: "button", class: "seg-btn", role: "radio" }, L(o.label.es, o.label.en));
    b.addEventListener("click", () => {
      value = o.value;
      sync();
      opts.onInput && opts.onInput(value);
    });
    row.appendChild(b);
    return [o.value, b];
  });
  function sync() {
    for (const [v, b] of btns) {
      b.classList.toggle("on", v === value);
      b.setAttribute("aria-checked", v === value);
    }
  }
  sync();
  wrap.appendChild(row);
  return {
    el: wrap,
    get value() {
      return value;
    },
    set value(v) {
      value = v;
      sync();
    },
  };
}

export function button(label, onClick, cls = "") {
  const b = el("button", { type: "button", class: "btn " + cls }, L(label.es, label.en));
  b.addEventListener("click", onClick);
  return b;
}

/* Readout tile: label + big value. */
export function readout(label, unit = "") {
  const wrap = el("div", { class: "readout" });
  wrap.innerHTML = `<div class="ro-label">${L(label.es, label.en)}</div><div class="ro-value">–</div>`;
  const v = wrap.querySelector(".ro-value");
  return {
    el: wrap,
    set(val, cls = "") {
      // values may be bilingual markup from L(); unit suffix is plain text
      v.innerHTML = String(val) + (unit ? " " + unit : "");
      v.className = "ro-value " + cls;
    },
  };
}

/* Standard lab layout: visual area(s) on the left/top, controls and readouts on the side. */
export function labLayout(container, { wide = false, stack = false } = {}) {
  container.classList.add("lab");
  if (wide) container.classList.add("lab-wide");
  if (stack) container.classList.add("lab-stack");
  const viz = el("div", { class: "lab-viz" });
  const side = el("div", { class: "lab-side" });
  const controls = el("div", { class: "lab-controls" });
  const readouts = el("div", { class: "lab-readouts" });
  const note = el("div", { class: "lab-note" });
  side.append(controls, readouts, note);
  container.append(viz, side);
  return { viz, side, controls, readouts, note };
}

/* A canvas that tracks its CSS size and devicePixelRatio. */
export function canvasBox(parent, { height = 320, cls = "" } = {}) {
  const box = el("div", { class: "cbox " + cls, style: `height:${height}px` });
  const c = el("canvas");
  box.appendChild(c);
  parent.appendChild(box);
  return { box, canvas: c };
}

export function engineBadge(container) {
  const b = el("div", { class: "engine-wait" }, L("Esperando al motor de física (Python)…", "Waiting for the physics engine (Python)…"));
  container.appendChild(b);
  return b;
}

/* Run fn once now and whenever language changes, while the element is in the DOM. */
export function bindLang(elm, fn) {
  const off = onLang(() => {
    if (!document.body.contains(elm)) {
      off();
      return;
    }
    fn();
  });
  return off;
}

export { L, tr };
