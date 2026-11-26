/* AI ▾ → Schematic from a picture…: a photo or scan of a schematic (a magazine page, a hand
   drawing, a forum post, a PDF) read by the AI into the same netlist Design from a description
   uses (ai-design.js checks it against the library and draws it), put on a new sheet and
   simulated. The values the AI could not read for sure come back marked, beside the picture, for
   the user to confirm: the card lists them with links to the parts. Needs the user's AI key. */
(function (root) {
  "use strict";
  // the file as base64 for the provider: a photo scaled to at most maxPx on its long side (the
  // providers take a few MB per image), as JPEG; a PDF as it is. → { mime, data, thumb }
  function readFile(file, maxPx) {
    maxPx = maxPx || 2400;
    return new Promise((ok, bad) => {
      const r = new FileReader();
      r.onerror = () => bad(new Error("could not read " + file.name));
      r.onload = () => {
        const url = String(r.result);
        if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) { ok({ mime: "application/pdf", data: url.replace(/^data:[^,]*,/, ""), thumb: null }); return; }
        const img = new Image();
        img.onerror = () => bad(new Error(`${file.name} is not a picture this browser can open (use JPEG, PNG, WebP or PDF)`));
        img.onload = () => {
          const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
          const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
          const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
          const jpg = cv.toDataURL("image/jpeg", 0.9);
          const t = Math.min(1, 480 / Math.max(cv.width, cv.height)), tc = document.createElement("canvas"); tc.width = Math.round(cv.width * t); tc.height = Math.round(cv.height * t);
          tc.getContext("2d").drawImage(cv, 0, 0, tc.width, tc.height);
          ok({ mime: "image/jpeg", data: jpg.replace(/^data:[^,]*,/, ""), thumb: tc.toDataURL("image/jpeg", 0.8), w: img.naturalWidth, h: img.naturalHeight });
        };
        img.src = url;
      };
      r.readAsDataURL(file);
    });
  }

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadPicture(cad) {
    const { S, circuitIssues, placeDesign, runSim, setStatus, whenSimulated } = cad;
    const P = S.picture = { busy: false };
    const $ = id => document.getElementById(id), esc = s => root.AiCircuit.esc(s);
    const MAX_MB = 30;
    let ai = null, picked = null;

    const SYSTEM = "You are an expert in reading electronic schematics (tube amplifiers, transistor amplifiers, their power supplies; Western, Soviet and Japanese drawing conventions, old magazine pages and hand drawings) working inside Tube Amp CAD, a schematic editor with a circuit simulator. "
      + "You get a picture of a schematic. Transcribe it, part by part and wire by wire, into a netlist of the CAD's parts, exactly as drawn: the same parts, the same values, the same connections, with the designators printed on it where there are any. Do not improve or redesign it. "
      + "Read values in any notation: 4k7 = 4.7k, 4К7 = 4.7k, 0,1 мк = 100n, 1М = 1M, 220 = 220 Ω, 47μ = 47u, 0.01 = 10n for a capacitor marked in µF; Soviet tubes by their library names (6Н2П → 6N2P, 6П14П → 6P14P, 6Н23П → 6N23P). A part the library does not have: the closest library part, listed in uncertain. "
      + "A power supply that is drawn (transformer, rectifier, filter): transcribe it with the library's parts where they exist; otherwise replace it with rails at the voltages marked on the drawing and say so in uncertain. Heaters are not drawn. "
      + "Every value or connection you could not read for sure (smudged, cut off, ambiguous) goes in uncertain with what you read and why; never leave it silently guessed.\n\n";
    function system(addTest) {
      const A = root.AiCircuit;
      return SYSTEM + root.AiDesign.rules().replace(/^- Put a signal generator[^\n]*\n/m, addTest
        ? "- If the drawing has no signal source, add a signal generator (siggen, ref G1) at the input with its + pin on the input net and - on GND at a realistic level, and an oscilloscope (scope, ref P1, pins CH1 CH2 COM) with CH1 on the input, CH2 on the output and COM on GND, so it can be simulated; if it has no load, add one (a speaker or resistor, ref RL or BA1). List each part you added in added.\n"
        : "- Add nothing that is not drawn: no generator, load or scope.\n")
        + '\nAlso answer, in the same JSON object: "uncertain": [{"ref": "R7", "what": "value smudged: read as 47k, could be 4.7k"}], "added": ["G1", "P1"].'
        + "\n\n# The part library (type: name. Pins. Values)\n" + A.catalogue({ skip: ["rail", "offsheet", "netlabel", "bus", "ground"] })
        + "\nscope: Oscilloscope. Pins CH1 CH2 COM. Values: none needed."
        + "\n\n# Tubes in the library (name, kind, max anode voltage, max anode dissipation)\n" + A.tubeList();
    }

    async function read(file, notes, addTest) {
      if (!file || P.busy || !ai) return;
      ai.show();
      if (file.size > MAX_MB * 1048576) { ai.add({ kind: "error", text: `${file.name} is ${(file.size / 1048576).toFixed(1)} MB: the providers take up to about ${MAX_MB} MB. Crop the picture to the schematic.` }); return; }
      if (!AiClient.ready(AiClient.load())) { ai.add({ kind: "setup" }); return; }
      if (S.comps.some(c => c.type !== "frame") && !confirm("Draw the schematic in the picture?\n\nIt replaces the circuit on the sheet. Ctrl+Z brings the circuit back.")) return;
      P.busy = true;
      ai.add({ kind: "user", text: `Schematic from a picture: ${file.name}${notes ? "\n" + notes : ""}`, prompt: "Read this schematic." });
      try {
        const f = await readFile(file);
        const msgs = [{ role: "user", text: `Transcribe this schematic (${file.name}) into the CAD's netlist.${notes ? `\nNotes from the user: ${notes}` : ""}`, files: [{ name: file.name, mime: f.mime, data: f.data }] }];
        const sys = system(addTest);
        let text = await ai.call({ system: sys, messages: msgs, maxTokens: 32000 }, "Reading the schematic");
        let j = AiClient.extractJson(text), checked = root.AiDesign.check(j);
        if (checked.problems.length) {
          msgs.push({ role: "assistant", text }, { role: "user", text: `The CAD could not use this as it is:\n${checked.problems.map(p => "- " + p).join("\n")}\n\nAnswer with the whole transcription again as JSON, corrected; keep to what is drawn.` });
          ai.add({ kind: "note", text: `The transcription has ${checked.problems.length} problem${checked.problems.length === 1 ? "" : "s"} (${checked.problems.slice(0, 3).join("; ")}${checked.problems.length > 3 ? " …" : ""}): asking for a corrected one.` });
          text = await ai.call({ system: sys, messages: msgs, maxTokens: 32000 }, "Reading the schematic · correction");
          j = AiClient.extractJson(text); checked = root.AiDesign.check(j);
        }
        if (!checked.parts.length) throw new Error("The answer has no parts the CAD knows: is the picture a schematic?");
        placeDesign(root.AiDesign.layout(checked, { title: j.title || file.name.replace(/\.[^.]+$/, "") }));
        if (!S.sim.live) runSim("live");
        await whenSimulated();
        const issues = circuitIssues();
        const unc = (Array.isArray(j.uncertain) ? j.uncertain : []).map(u => ({ ref: String(u.ref || ""), what: String(u.what || "") })).filter(u => u.what);
        const added = (Array.isArray(j.added) ? j.added : []).map(String);
        ai.add({ kind: "card", html: card(j, f, file.name, checked, unc, added, issues) });
        setStatus(unc.length || issues.length ? "warn" : "ok", `Schematic from a picture: ${checked.parts.length} parts read${unc.length ? `, ${unc.length} to check` : ""}${issues.length ? `, ${issues.length} problems in the Checks` : ""}`);
      } catch (e) { ai.fail(e); }
      finally { P.busy = false; ai.render(); }
    }
    function card(j, f, name, checked, unc, added, issues) {
      const A = root.AiCircuit, refs = checked.parts.map(p => p.ref);
      const ref = r => (refs.includes(r) ? `<a href="#" class="ai-ref" data-ref="${esc(r)}">${esc(r)}</a>` : esc(r));
      const pic = f.thumb ? `<img class="pic-thumb" src="${f.thumb}" alt="${esc(name)}">` : "";
      const read = `<p>${esc(checked.parts.length)} parts read${checked.problems.length ? ` (${checked.problems.length} left out: ${esc(checked.problems.slice(0, 3).join("; "))}${checked.problems.length > 3 ? " …" : ""})` : ""}.${added.length ? ` Added so it can be simulated: ${added.map(ref).join(", ")}.` : ""}</p>`;
      const u = unc.length ? `<h4>Check these against the picture</h4><table class="ai-fixes"><tr><th>Part</th><th>What was read</th></tr>${unc.map(x => `<tr><td>${ref(x.ref)}</td><td>${esc(x.what)}</td></tr>`).join("")}</table>`
        : "<p>The AI marked nothing as unsure; still compare the values with the picture before you trust the simulation.</p>";
      const ch = issues.length ? `<p>The Checks list ${issues.length} problem${issues.length === 1 ? "" : "s"}${issues.length ? ":" : "."}</p><ul>${issues.slice(0, 8).map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p>Simulated: the Checks find no problems.</p>";
      return `<h4>${esc(j.title || "Schematic")} · from ${esc(name)}</h4><div class="pic-row">${pic}<div class="pic-body">${j.summary ? A.markdown(String(j.summary), refs) : ""}${read}${u}${ch}</div></div>`
        + "<p class=\"muted\">Every pin ends in a ground, a supply rail or a sheet connector named after its net: drag the parts and draw wires to make it look like the original. Ctrl+Z brings back the circuit you had before.</p>";
    }

    // the dialog: a file (or a pasted picture), notes, whether to add a generator and a scope
    function open() {
      const m = $("pic-modal"); if (!m) return;
      picked = null; $("pic-file").value = ""; $("pic-name").textContent = "No picture yet: choose a file, drop one here or paste (Ctrl+V)."; $("pic-preview").hidden = true;
      m.hidden = false;
    }
    function pick(file) {
      if (!file) return;
      picked = file;
      $("pic-name").textContent = `${file.name || "pasted picture"} · ${(file.size / 1048576).toFixed(2)} MB`;
      const pv = $("pic-preview");
      if (/^image\//.test(file.type)) { pv.src = URL.createObjectURL(file); pv.hidden = false; } else pv.hidden = true;
    }
    function go() {
      if (!picked) { $("pic-name").textContent = "⚠ Choose a picture of a schematic first."; return; }
      $("pic-modal").hidden = true;
      read(picked, $("pic-notes").value.trim(), $("pic-add").checked);
    }
    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-picture", open); bind("btn-ai-picture", open);
      bind("btn-pic-go", go); bind("btn-pic-cancel", () => { $("pic-modal").hidden = true; });
      const fi = $("pic-file"); if (fi) fi.addEventListener("change", () => pick(fi.files[0]));
      const m = $("pic-modal");
      if (m) {
        m.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go(); });
        document.addEventListener("paste", e => { if (m.hidden) return; const it = [...((e.clipboardData || {}).items || [])].find(x => /^image\//.test(x.type)); if (it) { e.preventDefault(); pick(it.getAsFile()); } });
        m.addEventListener("dragover", e => e.preventDefault());
        m.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) pick(f); });
      }
      ai.addAction({ id: "btn-ai-picture" });
    }
    return { init, open, read, system };
  }
  root.CadPicture = CadPicture;
  root.CadPicture.readFile = readFile;
})(window);
