/* The Vaults window: every place projects and their revisions can be kept, managed in one list, as
   MöbiusCAD's Vault menu does it (File ▾ → Vaults…, Kept in → Manage vaults…, and the project
   manager's Vaults… button):
     On the server             aerocat.tech, for the site's owner (Cloudflare login)
     In a folder on this computer
                               New vault in a folder…, Open vault folder…, and the folders used before
                               (Chrome, Edge; Safari and Firefox open a folder to read only)
     In this browser           New browser vault (a name), Import backup…, and the vaults kept there
   Each vault has Use, Back up (a ZIP of its files) and Forget (a folder: its files stay) or
   Delete (a browser vault: for good). The engine is cad-vault.js; this file only draws and asks.
   It also makes the grouped options of the "Kept in" lists (storeOptions). */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NOFOLDER = "A vault in a folder needs Chrome or Edge on a computer. In this browser, use a browser vault and Back up for backups.";
  const NOREAD = "This browser cannot open a folder on the computer.";
  const NOBROWSER = "This browser has no storage of its own for a vault: pick a folder instead.";

  // "Kept in": the server, the folders, this browser's vaults, then Manage vaults… → { html, value }
  // list: CadVault's vaults(); store: "site" or "vault"
  function storeOptions(list, store, o = {}) {
    const folders = list.filter(v => v.kind !== "browser"), here = list.filter(v => v.kind === "browser");
    const opt = v => `<option value="vault:${esc(v.id)}">${esc(v.name)}${v.readOnly ? " (read only)" : ""}</option>`;
    const html = `<optgroup label="On the server"><option value="site">${esc(o.siteLabel || "aerocat.tech")}</option></optgroup>`
      + (folders.length ? `<optgroup label="In a folder on this computer">${folders.map(opt).join("")}</optgroup>` : "")
      + (here.length ? `<optgroup label="In this browser">${here.map(opt).join("")}</optgroup>` : "")
      + `<option value="manage">${list.length ? "Manage vaults…" : "New vault…"}</option>`;
    const now = list.find(v => v.current);
    return { html, value: store === "vault" ? (now ? "vault:" + now.id : "manage") : "site" };
  }

  // host: { el (the box to draw in), vault (CadVault client), site ({ available }), store () → "site"|"vault",
  //   use (where: "site" | { id }) → Promise (the host switches to it), say (text, kind), confirm (text) → Promise<boolean>,
  //   siteNote (text under aerocat.tech) }
  function VaultsUI(host) {
    const { el, vault } = host;
    const say = host.say || (() => {});
    const ask = host.confirm || (t => Promise.resolve(root.confirm(t)));
    let busy = false;

    async function draw() {
      const list = vault ? await vault.vaults(true).catch(() => []) : [];
      const store = host.store(), folders = list.filter(v => v.kind !== "browser"), here = list.filter(v => v.kind === "browser");
      const siteOn = !!(host.site && host.site.available);
      const badge = on => (on ? `<span class="vault-on" title="Projects and revisions go here now">In use</span>` : "");
      const row = (v, acts) => `<div class="vault-row${v.current && store === "vault" ? " on" : ""}" data-id="${esc(v.id)}">
        <span class="vault-name" title="${esc(v.name)}">${esc(v.name)}${v.readOnly ? ` <span class="vault-note">read only</span>` : ""}</span>${badge(v.current && store === "vault")}
        <span class="vault-acts">${v.current && store === "vault" ? "" : `<button class="btn" data-v="use" title="Keep projects and revisions in this vault from now on">Use</button>`}${acts}</span></div>`;
      const folderActs = v => (v.readOnly ? "" : `<button class="btn" data-v="backup" title="Every file of this vault in one ZIP, to keep somewhere safe; Import backup… brings it back">Back up</button>`)
        + `<button class="btn" data-v="forget" title="Take this folder off the list. Its files stay where they are, and Open vault folder… brings it back">Forget</button>`;
      const browserActs = `<button class="btn" data-v="backup" title="Every file of this vault in one ZIP, to keep somewhere safe; Import backup… brings it back">Back up</button><button class="btn danger" data-v="delete" title="Delete this vault and everything in it from this browser, for good">Delete…</button>`;
      el.innerHTML = `<div class="vaults">
        <p class="insp-help vault-lead">A vault keeps your projects and every revision of them. Keep them on the server, in a folder on this computer, or in this browser, and switch between them any time.</p>
        <section class="vault-sec"><h4>On the server</h4>
          <div class="vault-row${store === "site" ? " on" : ""}"><span class="vault-name">aerocat.tech</span>${badge(store === "site")}<span class="vault-acts">${store === "site" ? "" : `<button class="btn" data-v="site" title="Keep projects and revisions on aerocat.tech, for the site's owner (Cloudflare login)"${siteOn ? "" : " disabled"}>Use</button>`}</span></div>
          <p class="insp-help vault-note">${esc(host.siteNote || (siteOn ? "For the site's owner only: the browser signs in on aerocat.tech (Cloudflare login)." : "Only on aerocat.tech, for the site's owner."))}</p>
        </section>
        <section class="vault-sec"><h4>In a folder on this computer</h4>
          ${folders.map(v => row(v, folderActs(v))).join("")}
          ${vault && vault.writes ? `<p class="insp-help vault-note">Pick any folder, also on a network drive or a synced one: the projects and all their revisions are kept there as plain files.</p>
          <div class="vault-btns"><button class="btn active" data-v="new-dir" title="Pick a folder: the vault's files and all their versions are kept there">New vault in a folder…</button><button class="btn" data-v="open-dir" title="Pick a folder that holds a vault made before">Open vault folder…</button></div>`
          : vault && vault.reads ? `<p class="insp-help vault-note">${esc(NOFOLDER)}</p><div class="vault-btns"><button class="btn" data-v="open-dir" title="Pick a vault's folder (or one project's folder) to see its revisions, open them and compare them; nothing is saved into it">Open vault folder (read only)…</button></div>`
          : `<p class="insp-help vault-note">${esc(NOREAD)} ${esc(NOFOLDER)}</p>`}
        </section>
        <section class="vault-sec"><h4>In this browser</h4>
          ${here.map(v => row(v, browserActs)).join("")}
          ${vault && vault.browser ? `<p class="insp-help vault-note">Kept in this browser's own storage on this computer: no folder to pick, and it works in Safari and Firefox too. Clearing the site's data deletes it, so Back up now and then.</p>
          <div class="vault-btns"><input type="text" class="vault-new-name" maxlength="60" spellcheck="false" placeholder="Vault name" aria-label="New browser vault's name"><button class="btn active" data-v="new-ws" title="A new vault in this browser's own storage, with this name">New browser vault</button><button class="btn" data-v="import" title="A vault backup (Back up) becomes a vault in this browser">Import backup…</button><input type="file" class="vault-zip" accept=".zip,application/zip" hidden></div>`
          : `<p class="insp-help vault-note">${esc(NOBROWSER)}</p>`}
        </section>
      </div>`;
    }

    // a ZIP the browser saves
    function download(name, bytes) {
      const a = root.document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      a.download = name;
      root.document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    const stamp = () => new Date().toISOString().slice(0, 10);
    async function useVault(id, text) { await host.use({ id }); if (text) say(text, "ok"); }

    // a new vault in a picked folder (create) or the vault of a picked folder (open), as MöbiusCAD does
    async function folder(create) {
      const got = await vault.pickFolder();
      if (!got) return;
      if (got.handle.readOnly) { await vault.use(got.handle); await useVault(vault.id(), `Reading the vault in the folder ${got.name}`); return; }
      if (!got.vault && !create && !(await ask(`The folder ${got.name} holds no vault yet. Create a vault in it?`))) return;
      await vault.use(got.handle);
      await useVault(vault.id(), got.vault ? (create ? `The folder ${got.name} already held a vault: it is open now` : `Vault ${got.name} open`) : `New vault in the folder ${got.name}`);
      if (got.vault) return;
      // a project's folder with designs in it already: they can become projects where they are
      const loose = await vault.looseDesigns().catch(() => []);
      if (!loose.length) return;
      const names = loose.slice(0, 8).map(x => "  " + x.path).join("\n") + (loose.length > 8 ? `\n  and ${loose.length - 8} more` : "");
      if (!(await ask(`The folder already holds ${loose.length} design${loose.length === 1 ? "" : "s"}:\n${names}\n\nAdd ${loose.length === 1 ? "it" : "each"} to the vault as a project, the file as its first revision? The files stay where they are.`))) return;
      const n = await vault.adopt(loose.map(x => x.path));
      await host.use({ id: vault.id() });
      say(`Added ${n} project${n === 1 ? "" : "s"} from the folder`, "ok");
    }

    async function act(b) {
      const what = b.dataset.v, id = b.closest(".vault-row") && b.closest(".vault-row").dataset.id;
      const v = id ? (await vault.vaults()).find(x => x.id === id) : null;
      switch (what) {
        case "site": await host.use("site"); break;
        case "use": await useVault(id); break;
        case "new-dir": case "open-dir": await folder(what === "new-dir"); break;
        case "new-ws": {
          const inp = el.querySelector(".vault-new-name"), name = inp.value.trim();
          if (!name) { inp.focus(); say("Type a name for the new vault first", "warn"); return; }
          const r = await vault.createBrowser(name);
          await useVault(r.id, `New vault ${r.name} in this browser`);
          break;
        }
        case "import": el.querySelector(".vault-zip").click(); return;
        case "backup": {
          say("Putting the backup together…");
          const z = await vault.backup(id);
          download(`${z.name}-vault-${stamp()}.zip`, z.bytes);
          say(`Backed up ${v ? v.name : z.name}: ${z.files} files`, "ok");
          break;
        }
        case "forget":
          if (!(await ask(`Take the folder ${v.name} off this list?\n\nIts files stay where they are; Open vault folder… brings it back.`))) return;
          {
            const was = vault.id() === id;
            await vault.disconnect(id);
            if (was && host.store() === "vault") await host.use(vault.current() ? { id: vault.id() } : "site"); else await host.use(null);
            say(`Forgot the folder ${v.name}; its files stay where they are`, "ok");
          }
          break;
        case "delete": {
          let count = "";
          try { const c = await vault.other(id); const me = await c.me(); count = ` with its ${me.revisions.projects} project${me.revisions.projects === 1 ? "" : "s"} and ${me.revisions.count} revision${me.revisions.count === 1 ? "" : "s"}`; } catch (e) { /* the count is left out */ }
          if (!(await ask(`Delete the browser vault ${v.name}${count}, for good?\n\nThis cannot be undone. Back up first if you may want them again.`))) return;
          const was = vault.id() === id;
          await vault.destroy(id);
          if (was && host.store() === "vault") await host.use(vault.current() ? { id: vault.id() } : "site"); else await host.use(null);
          say(`Deleted the vault ${v.name}`, "ok");
          break;
        }
      }
      await draw();
    }

    el.addEventListener("click", async e => {
      const b = e.target.closest("button[data-v]");
      if (!b || b.disabled || busy) return;
      busy = true;
      try { await act(b); } catch (err) { say(err && err.message ? err.message : String(err), "warn"); await draw().catch(() => {}); } finally { busy = false; }
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("vault-new-name")) { e.preventDefault(); e.stopPropagation(); const b = el.querySelector('[data-v="new-ws"]'); if (b) b.click(); } });
    el.addEventListener("change", async e => {
      if (!e.target.classList.contains("vault-zip")) return;
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      try {
        say("Reading the backup…");
        const r = await vault.restore(await f.arrayBuffer());
        await useVault(r.id, `The backup is the browser vault ${r.name} now: ${r.projects} project${r.projects === 1 ? "" : "s"}`);
      } catch (err) { say(err.message, "warn"); }
      await draw();
    });
    return { draw };
  }

  root.CadVaultsUI = { VaultsUI, storeOptions, NOFOLDER };
})(typeof window !== "undefined" ? window : globalThis);
