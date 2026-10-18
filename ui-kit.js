/* The pieces of interface every tool window shares.
   UiKit.menus(header): the toolbar's drop-down menus (.menu > .btn + .menu-list): one open at
     a time; a click on an item closes its menu, a tick item (.check) leaves it open; a click
     elsewhere or Esc closes it. Tick items and on/off switches (.btn.toggle) tell assistive
     technology their state (aria-checked / aria-pressed) from their "active" class.
   UiKit.commands(): a window's table of commands. One entry per thing the user can do:
       cmds.add({ id, keys: ["Ctrl+Z"], run(e), when(), prevent, anyCtrl, inInputs, help, helpKeys })
     keys: "R", "Ctrl+Shift+S", "Delete", "+" … Letters go by the physical key (e.code), so the
     shortcuts work in any keyboard layout (with a Cyrillic layout e.key is "к" for R); other
     keys by e.key, or by e.code when written like one ("NumpadAdd"). A key without Shift also
     fires with Shift held unless another command takes the Shift variant; Ctrl (or ⌘) must match
     unless anyCtrl. The first command, in the order added, whose key matches and whose when()
     allows it runs. inInputs: also while typing in a field (F1). prevent: preventDefault().
     cmds.key(e) handles a keydown (true when a command ran); cmds.bind(el or id, cmdId) runs a
     command on click. A command with check() is an on/off setting: after any command runs (or on
     cmds.sync()) the elements bound to it get the "active" class while check() is true, which
     is the tick of a menu item and the lamp of a switch. cmds.helpRows(host) writes the "Keyboard" list of the help from the
     commands' help texts, so it cannot drift from the shortcuts; cmds.menuItems(host, ids) fills
     a menu with commands (icon, label, key).
   UiKit.contextMenu(items, x, y, title): a right-click menu (UiKit.closeContextMenu() closes it). */
(function (root) {
  "use strict";

  function menus(header) {
    if (!header) return;
    const all = [...header.querySelectorAll(".menu")].filter(m => m.querySelector(":scope > .btn") && m.querySelector(".menu-list"));
    const close = m => { m.querySelector(".menu-list").hidden = true; m.querySelector(":scope > .btn").setAttribute("aria-expanded", "false"); };
    all.forEach(m => {
      const list = m.querySelector(".menu-list"), btn = m.querySelector(":scope > .btn");
      btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", e => {
        e.stopPropagation(); const open = list.hidden;
        all.forEach(o => { if (o !== m) close(o); });
        list.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      });
      list.addEventListener("click", e => { const it = e.target.closest(".menu-item"); if (it && !it.classList.contains("check")) close(m); });
    });
    document.addEventListener("click", e => all.forEach(m => { if (!m.contains(e.target)) close(m); }));
    document.addEventListener("keydown", e => { if (e.key === "Escape") all.forEach(close); });
    const ticks = () => header.querySelectorAll(".menu-item.check, [role=menuitemcheckbox]").forEach(b => b.setAttribute("aria-checked", String(b.classList.contains("active"))));
    const lamps = () => header.querySelectorAll(".btn.toggle").forEach(b => b.setAttribute("aria-pressed", String(b.classList.contains("active"))));
    ticks(); lamps();
    new MutationObserver(() => { ticks(); lamps(); }).observe(header, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  // "Ctrl+Shift+S" -> { ctrl, shift, key: "s" }
  function parseKey(spec) {
    const parts = spec.split("+"), key = parts.pop() || "+";   // "+" alone, or "Ctrl++"
    const mods = parts.filter(Boolean).map(p => p.toLowerCase());
    return { ctrl: mods.includes("ctrl"), shift: mods.includes("shift"), key, lower: key.toLowerCase() };
  }
  const showKey = spec => spec.replace(/^-$|(\+)-$/, "$1−").replace("Delete", "Del").replace("Escape", "Esc");

  function commands() {
    const list = [];
    const api = {
      list,
      add(c) { c.parsed = (c.keys || []).map(parseKey); list.push(c); return api; },
      get: id => list.find(c => c.id === id),
      run(id, e) { const c = api.get(id); if (c && (!c.when || c.when())) { c.run(e); api.sync(); return true; } return false; },
      sync() { list.forEach(c => { if (c.check && c.els) { const on = !!c.check(); c.els.forEach(el => el.classList.toggle("active", on)); } }); },
      key(e) {
        const tag = (e.target && e.target.tagName || "").toUpperCase(), typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
        const ctrl = e.ctrlKey || e.metaKey, code = e.code || "";
        const L = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : String(e.key).toLowerCase();
        const hit = (k, shiftExact) => (k.lower === L || k.key === code) && (shiftExact ? k.shift === e.shiftKey : !k.shift);
        const pick = shiftExact => list.find(c => (!typing || c.inInputs) && c.parsed.some(k => (c.anyCtrl || k.ctrl === ctrl) && hit(k, shiftExact)) && (!c.when || c.when()));
        const c = pick(true) || (e.shiftKey ? pick(false) : null);
        if (!c) return false;
        c.run(e);
        if (c.prevent) e.preventDefault();
        api.sync();
        return true;
      },
      bind(el, id) {
        if (typeof el === "string") el = document.getElementById(el);
        const c = api.get(id);
        if (el && c) { (c.els = c.els || []).push(el); el.addEventListener("click", e => api.run(id, e)); }
        return api;
      },
      // menu items for commands (null: a separator): the command's icon, label and first key;
      // each item is bound to its command and gets the id "btn-" + the command's id (or its menuId)
      menuItems(host, ids) {
        if (!host) return api;
        ids.forEach(id => {
          if (!id) { const sep = document.createElement("div"); sep.className = "menu-sep"; host.appendChild(sep); return; }
          const c = api.get(id), b = document.createElement("button");
          b.className = "menu-item" + (c.check ? " check" : ""); b.id = c.menuId || "btn-" + id; b.setAttribute("role", c.check ? "menuitemcheckbox" : "menuitem");
          b.innerHTML = `<span>${c.icon || ""}${c.label}</span>` + (c.keys && c.keys.length ? `<kbd>${showKey(c.keys[0])}</kbd>` : "");
          if (c.title) b.title = c.title;
          host.appendChild(b); api.bind(b, id);
        });
        return api;
      },
      helpRows(host) {
        if (!host) return;
        host.innerHTML = "";
        list.filter(c => c.help).forEach(c => {
          const k = document.createElement("span"), t = document.createElement("span");
          (c.helpKeys || c.keys.slice(0, 1)).forEach((spec, i) => {
            if (i) k.appendChild(document.createTextNode(" "));
            const kb = document.createElement("kbd"); kb.textContent = showKey(spec); k.appendChild(kb);
          });
          k.style.justifySelf = "start"; t.textContent = c.help;
          host.appendChild(k); host.appendChild(t);
        });
      }
    };
    return api;
  }

  // A right-click menu at (x, y) in the window: items { label, key, run, disabled } or null for a
  // separator, with an optional title line. A click on an item runs it; Esc, a click elsewhere,
  // scrolling or resizing closes it. One at a time: opening another replaces it.
  let ctxEl = null;
  function closeContextMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  function contextMenu(items, x, y, title) {
    closeContextMenu();
    const el = ctxEl = document.createElement("div");
    el.className = "menu-list ctx"; el.setAttribute("role", "menu");
    if (title) { const t = document.createElement("div"); t.className = "ctx-title"; t.textContent = title; el.appendChild(t); }
    items.forEach(m => {
      if (!m) { const sep = document.createElement("div"); sep.className = "menu-sep"; el.appendChild(sep); return; }
      const b = document.createElement("button"); b.className = "menu-item"; b.setAttribute("role", "menuitem"); b.disabled = !!m.disabled;
      b.innerHTML = `<span>${m.icon || ""}</span>`; b.firstChild.appendChild(document.createTextNode(m.label));
      if (m.key) { const k = document.createElement("kbd"); k.textContent = showKey(m.key); b.appendChild(k); }
      b.addEventListener("click", e => { closeContextMenu(); m.run(e); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    el.style.left = Math.max(0, Math.min(x, innerWidth - el.offsetWidth - 6)) + "px";
    el.style.top = Math.max(0, Math.min(y, innerHeight - el.offsetHeight - 6)) + "px";
    const first = el.querySelector(".menu-item:not(:disabled)"); if (first) first.focus({ preventScroll: true });
    return el;
  }
  if (typeof document !== "undefined") {
    document.addEventListener("mousedown", e => { if (ctxEl && !ctxEl.contains(e.target)) closeContextMenu(); }, true);
    // Esc closes the menu and goes no further (it would also clear the selection)
    document.addEventListener("keydown", e => { if (ctxEl && e.key === "Escape") { closeContextMenu(); e.stopPropagation(); e.preventDefault(); } });
    window.addEventListener("resize", closeContextMenu);
    document.addEventListener("wheel", e => { if (ctxEl && !ctxEl.contains(e.target)) closeContextMenu(); }, { passive: true, capture: true });
  }

  root.UiKit = { menus, commands, parseKey, contextMenu, closeContextMenu };
})(typeof window !== "undefined" ? window : globalThis);
