/* Web Worker hosting the Python physics engine (Pyodide + NumPy).
   The aerolab_physics package is fetched from the site and written into Pyodide's FS.

   Requests are queued here. A request carrying a `key` (one per gadget) supersedes any older
   request with the same key that has not started yet: while a slider is dragged only the newest
   position is computed, instead of every intermediate one. */
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js");

const MODULES = [
  "__init__", "naca", "panel", "boundary_layer", "airfoil", "potential", "lifting_line",
  "vlm", "vortex", "nozzle", "delta", "floor", "drag", "cfd", "tunnel", "duct", "underbody", "vii", "unsteady", "car", "reference_data", "compressible", "aeroelastic", "flowcontrol", "postpro", "selftest", "api",
];

let api = null;
let ready = null;
const queue = [];
let pumping = false;

function status(stage) {
  postMessage({ type: "status", stage });
}

async function init() {
  status("pyodide");
  const py = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/" });
  status("numpy");
  await py.loadPackage("numpy");
  status("engine");
  const base = new URL("../../../aerolab_physics/", self.location);
  py.FS.mkdirTree("/home/pyodide/aerolab_physics");
  const files = await Promise.all(
    MODULES.map(async (m) => {
      const res = await fetch(new URL(m + ".py", base), { cache: "no-cache" });
      if (!res.ok) throw new Error("cannot load " + m + ".py");
      return [m, await res.text()];
    })
  );
  for (const [m, src] of files) py.FS.writeFile(`/home/pyodide/aerolab_physics/${m}.py`, src);
  py.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')");
  api = py.pyimport("aerolab_physics.api");
  postMessage({ type: "ready" });
}

ready = init().catch((err) => postMessage({ type: "fatal", error: String(err) }));

function pump() {
  // run one job per task so that messages that arrived meanwhile are queued before choosing
  setTimeout(() => {
    const job = queue.shift();
    if (!job) {
      pumping = false;
      return;
    }
    if (job.key && queue.some((j) => j.key === job.key)) {
      postMessage({ id: job.id, superseded: true });
    } else if (!api) {
      postMessage({ id: job.id, json: JSON.stringify({ ok: false, error: "engine not loaded" }) });
    } else {
      const json = api.call(job.name, JSON.stringify(job.params || {}));
      postMessage({ id: job.id, json });
    }
    pump();
  }, 0);
}

self.onmessage = async (ev) => {
  queue.push(ev.data);
  await ready;
  if (!pumping) {
    pumping = true;
    pump();
  }
};
