/* Asynchronous bridge to the Python physics engine running in a Web Worker.

   await physics.call("airfoil.analyze", {spec: {code: "2412"}, alpha: 4})
   physics.latest("cp-lab", name, params)  -> resolves only for the newest request of a key

   Each request is attributed to the lab card that was active when it was made (the template
   marks the card while mounting a lab and on every user interaction inside it). The card then
   receives "labstate" events: {busy: n} while requests are pending and {error} on failure, so
   it can show "calculating…" and explain a failure instead of silently keeping an old result.
*/
const listeners = new Set();
let worker = null;
let nextId = 1;
const pending = new Map();
const latestTicket = new Map();
let state = { stage: "boot", ready: false, error: null };
let activeLab = null;

export function setActiveLab(el) {
  activeLab = el;
}

const busyCount = new WeakMap();
function labState(owner, delta, error) {
  if (!owner) return;
  const n = Math.max(0, (busyCount.get(owner) || 0) + delta);
  busyCount.set(owner, n);
  owner.dispatchEvent(new CustomEvent("labstate", { detail: { busy: n, error: error || null, ok: delta < 0 && !error } }));
}

function emit() {
  for (const fn of listeners) fn(state);
}

function start() {
  if (worker) return;
  worker = new Worker(new URL("./worker.js", import.meta.url));
  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === "status") {
      state = { ...state, stage: msg.stage };
      emit();
      return;
    }
    if (msg.type === "ready") {
      state = { ...state, stage: "ready", ready: true };
      emit();
      return;
    }
    if (msg.type === "fatal") {
      state = { ...state, stage: "error", error: msg.error };
      emit();
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.superseded) {
      labState(p.owner, -1);
      p.resolve(null);
      return;
    }
    let out;
    try {
      out = JSON.parse(msg.json);
    } catch (e) {
      labState(p.owner, -1, e.message);
      p.reject(e);
      return;
    }
    if (out.ok) {
      labState(p.owner, -1);
      p.resolve(out.result);
    } else {
      console.error("[physics]", out.error, out.trace || "");
      labState(p.owner, -1, out.error);
      p.reject(new Error(out.error));
    }
  };
  worker.onerror = (e) => {
    state = { ...state, stage: "error", error: e.message };
    emit();
  };
}

export const physics = {
  start,
  get state() {
    return state;
  },
  onStatus(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  },
  /* key (optional): a newer queued request with the same key makes this one resolve to null. */
  call(name, params = {}, key = null) {
    start();
    const id = nextId++;
    const owner = activeLab && activeLab.isConnected !== false ? activeLab : null;
    labState(owner, +1);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, owner });
      worker.postMessage({ id, name, params, key });
    });
  },
  /* Only the newest request per key resolves; older ones resolve to null (and are not even
     computed if they were still queued). */
  async latest(key, name, params = {}) {
    const ticket = (latestTicket.get(key) || 0) + 1;
    latestTicket.set(key, ticket);
    const res = await this.call(name, params, key);
    return latestTicket.get(key) === ticket ? res : null;
  },
};

/* Debounced, latest-only caller bound to one widget. */
export function liveCall(key, name, delay = 60) {
  let timer = null;
  return (params, cb) => {
    const owner = activeLab;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const prev = activeLab;
      activeLab = owner;
      const p = physics.latest(key, name, params);
      activeLab = prev;
      try {
        const r = await p;
        if (r) cb(r);
      } catch (e) {
        console.error(e);
      }
    }, delay);
  };
}
