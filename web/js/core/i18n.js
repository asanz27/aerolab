/* Bilingual (ES/EN) helpers. Both languages live in the DOM; CSS shows the active one,
   so switching language never resets widget state. Canvas text uses tr(). */
const KEY = "aerolab.lang";
let lang = "es";
try {
  const saved = localStorage.getItem(KEY);
  if (saved === "es" || saved === "en") lang = saved;
} catch (e) {
  /* storage unavailable */
}

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = l === "en" ? "en" : "es";
  document.documentElement.setAttribute("data-lang", lang);
document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("lang", lang);
  try {
    localStorage.setItem(KEY, lang);
  } catch (e) {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
}

/* Inline bilingual markup. */
export function L(es, en) {
  if (typeof es === "object" && es !== null) ({ es, en } = es);
  return `<span class="i-es">${es}</span><span class="i-en">${en ?? es}</span>`;
}

/* Block bilingual markup. */
export function LB(es, en) {
  return `<div class="i-es">${es}</div><div class="i-en">${en ?? es}</div>`;
}

/* Current-language string from {es, en} or a plain string. */
export function tr(t) {
  if (t == null) return "";
  if (typeof t === "string") return t;
  return t[lang] ?? t.es ?? "";
}

/* Re-run fn whenever the language changes (for canvas redraws). Returns unsubscribe. */
export function onLang(fn) {
  const h = () => fn(lang);
  window.addEventListener("langchange", h);
  return () => window.removeEventListener("langchange", h);
}

document.documentElement.setAttribute("data-lang", lang);
