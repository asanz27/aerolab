/* Interface self-audit (#/audit): renders every module in a sandbox inside the page, moves
   every control (sliders to min/max/back, switches, segmented buttons, selects, buttons) and
   reports engine errors, JavaScript errors, empty/NaN readouts and broken images.
   The same check used to review the site, available to re-run after any change. */
import { L } from "../core/i18n.js";
import { el } from "../core/ui.js";
import { MODULES } from "../../modules/registry.js";
import { renderModule } from "../core/template.js";
import { physics } from "../bridge/physics.js";
import { withExtras } from "../data/extra_content.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function auditPage(page) {
  page.innerHTML = `<h1>${L("Auditoría de la interfaz", "Interface audit")}</h1>
    <p class="prose" style="color:var(--fg-muted)">${L(
      "Carga cada módulo, mueve todos sus controles y comprueba que el motor no da errores, que no hay valores vacíos o NaN y que las imágenes cargan. Tarda varios minutos (los barridos lentos esperan al motor).",
      "Loads every module, moves all its controls and checks that the engine raises no errors, that there are no empty or NaN values and that images load. It takes several minutes (slow sweeps wait for the engine)."
    )}</p>`;
  const bar = el("div", { class: "quiz-bar" });
  const deep = el("label", { class: "ctl ctl-toggle" }, `<input type="checkbox" checked><span class="switch"></span><span class="ctl-label">${L("Mover también todos los controles", "Also move every control")}</span>`);
  const go = el("button", { class: "btn primary", type: "button" }, L("Ejecutar auditoría", "Run audit"));
  const status = el("div", { class: "fc-info mono" });
  bar.append(deep, go, status);
  page.appendChild(bar);
  const table = el("div");
  page.appendChild(table);
  const stage = el("div", { class: "audit-stage" });
  page.appendChild(stage);

  go.addEventListener("click", async () => {
    go.disabled = true;
    const doDeep = deep.querySelector("input").checked;
    let out = 0;
    const errs = [];
    let cur = null;
    const origCall = physics.call.bind(physics);
    physics.call = (name, params, key) => {
      out++;
      return origCall(name, params, key).then(
        (r) => (out--, r),
        (e) => {
          out--;
          errs.push({ mod: cur, msg: `${name}: ${e.message}` });
          throw e;
        }
      );
    };
    const onErr = (e) => errs.push({ mod: cur, msg: "JS: " + (e.message || e.reason) });
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr);
    const idle = async (max = 30000) => {
      const t0 = performance.now();
      await sleep(200);
      while (performance.now() - t0 < max) {
        if (out === 0) {
          await sleep(250);
          if (out === 0) return;
        }
        await sleep(100);
      }
    };
    const rows = [];
    const draw = () =>
      (table.innerHTML = `<table class="tests"><thead><tr><th></th><th>${L("Módulo", "Module")}</th><th>${L("Acciones", "Actions")}</th><th>${L("Incidencias", "Issues")}</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td>${r.issues.length ? '<span class="badge no">FAIL</span>' : '<span class="badge ok">OK</span>'}</td><td>${r.id}</td><td class="mono">${r.acts}</td><td>${r.issues.join("<br>") || "–"}</td></tr>`)
        .join("")}</tbody></table>`);
    for (const meta of MODULES) {
      cur = meta.id;
      status.textContent = `${meta.id} (${rows.length + 1}/${MODULES.length})`;
      const e0 = errs.length;
      const host = el("div");
      stage.innerHTML = "";
      stage.appendChild(host);
      let acts = 0;
      try {
        const mod = (await import(`../../modules/${meta.file}`)).default;
        renderModule(host, withExtras(mod, meta.id), meta);
        await idle(60000);
        if (doDeep) {
          for (const card of host.querySelectorAll(".lab-card")) {
            for (const inp of card.querySelectorAll("input[type=range]")) {
              const v0 = inp.value;
              for (const v of [inp.min, inp.max, v0]) {
                inp.value = v;
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                acts++;
                await idle();
              }
            }
            for (const cb of card.querySelectorAll("input[type=checkbox]"))
              for (let k = 0; k < 2; k++) {
                cb.click();
                acts++;
                await idle(60000);
              }
            for (const row of card.querySelectorAll(".seg-row")) {
              const btns = [...row.querySelectorAll("button")];
              const on = btns.findIndex((b) => b.classList.contains("on"));
              for (const b of btns) {
                b.click();
                acts++;
                await idle(60000);
              }
              if (on >= 0) btns[on].click();
              await idle(60000);
            }
            for (const b of card.querySelectorAll(".lab-side button.btn")) {
              b.click();
              acts++;
              await idle(60000);
            }
          }
        }
      } catch (e) {
        errs.push({ mod: cur, msg: "load: " + e.message });
      }
      const issues = errs.slice(e0).map((x) => x.msg.slice(0, 200));
      const txt = host.innerText;
      for (const pat of ["NaN", "undefined", "[object"]) if (txt.includes(pat)) issues.push(`text contains “${pat}”`);
      host.querySelectorAll(".ro-value").forEach((v) => v.innerText.trim() === "–" && issues.push("empty readout: " + v.parentElement.querySelector(".ro-label").innerText));
      host.querySelectorAll("img").forEach((im) => im.complete && im.naturalWidth === 0 && issues.push("broken image " + im.src));
      host.querySelectorAll(".katex-error").forEach((k) => issues.push("KaTeX: " + k.textContent.slice(0, 60)));
      rows.push({ id: meta.id, acts, issues: [...new Set(issues)] });
      draw();
    }
    stage.innerHTML = "";
    physics.call = origCall;
    window.removeEventListener("error", onErr);
    window.removeEventListener("unhandledrejection", onErr);
    const bad = rows.filter((r) => r.issues.length).length;
    status.innerHTML = bad ? L(`${bad} módulos con incidencias`, `${bad} modules with issues`) : L("Todo correcto", "All good");
    go.disabled = false;
  });
}
