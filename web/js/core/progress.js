/* Completed-module tracking (per-viewer convenience, stored in localStorage). */
const KEY = "aerolab.done";
let done = new Set();
try {
  done = new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
} catch (e) {
  done = new Set();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch (e) {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("progresschange"));
}

export const progress = {
  has: (id) => done.has(id),
  toggle(id) {
    done.has(id) ? done.delete(id) : done.add(id);
    save();
  },
  count: () => done.size,
};
