/* Minimal three.js scene helper (loaded on demand from the import map). */
import { cssVar } from "./plot.js";

export async function scene3d(parent, { height = 360, camera = [1.6, 1.0, 1.6], target = [0.3, 0, 0] } = {}) {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const box = document.createElement("div");
  box.className = "cbox";
  box.style.height = height + "px";
  parent.appendChild(box);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cssVar("--flow-bg", "#05080e"));
  const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  cam.position.set(...camera);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.set(...target);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9);
  dl.position.set(2, 3, 2);
  scene.add(dl);
  const grid = new THREE.GridHelper(4, 20, 0x334155, 0x1e293b);
  grid.position.y = -0.4;
  scene.add(grid);
  const frameFns = [];
  let visible = true;
  const io = new IntersectionObserver((e) => (visible = e[0].isIntersecting));
  io.observe(box);
  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px";
    renderer.domElement.style.height = h + "px";
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(box);
  resize();
  const clock = new THREE.Clock();
  const onTheme = () => (scene.background = new THREE.Color(cssVar("--flow-bg", "#05080e")));
  window.addEventListener("themechange", onTheme);
  let seen = false;
  (function loop() {
    // release GPU resources, observers and listeners once the scene has left the page
    if (box.isConnected) seen = true;
    else if (seen) {
      renderer.dispose();
      controls.dispose();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("themechange", onTheme);
      frameFns.length = 0;
      return;
    }
    requestAnimationFrame(loop);
    if (!visible) return;
    const dt = Math.min(0.05, clock.getDelta());
    for (const f of frameFns) f(dt);
    controls.update();
    renderer.render(scene, cam);
  })();
  return { THREE, scene, camera: cam, renderer, controls, box, grid, onFrame: (f) => frameFns.push(f) };
}

/* Colour helper for scalar values in [0,1] (blue -> cyan -> amber). */
export function heat(THREE, t) {
  t = Math.max(0, Math.min(1, t));
  const c = new THREE.Color();
  if (t < 0.5) c.setRGB(0.12 + 0.1 * t, 0.35 + 0.9 * t, 0.85);
  else c.setRGB(0.2 + 1.5 * (t - 0.5), 0.8 - 0.3 * (t - 0.5), 0.85 - 1.4 * (t - 0.5));
  return c;
}
