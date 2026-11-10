/**
 * cad-vault.js: projects and revisions kept in a folder on this computer, over a stand-in for the
 * browser's folder handles (File System Access API).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../cad-vault.js", import.meta.url), "utf8"), { filename: "cad-vault.js" });
const V = globalThis.CadVault;
const example = f => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8"));

// a folder in memory with the calls the vault uses
const missing = () => Object.assign(new Error("not found"), { name: "NotFoundError" });
function dir(name = "vault") {
  const kids = new Map();
  return {
    kind: "directory", name, kids, permission: "granted",
    async queryPermission() { return this.permission; },
    async requestPermission() { this.permission = "granted"; return "granted"; },
    async getDirectoryHandle(n, o = {}) { const k = kids.get(n); if (k && k.kind === "directory") return k; if (k || !o.create) throw missing(); const d = dir(n); kids.set(n, d); return d; },
    async getFileHandle(n, o = {}) {
      const k = kids.get(n); if (k && k.kind === "file") return k; if (k || !o.create) throw missing();
      const f = { kind: "file", name: n, data: new Uint8Array(0), async getFile() { return new Blob([this.data]); }, async createWritable() { const me = this; let d = null; return { async write(x) { d = typeof x === "string" ? new TextEncoder().encode(x) : new Uint8Array(x); }, async close() { me.data = d; } }; } };
      kids.set(n, f); return f;
    },
    async removeEntry(n) { if (!kids.delete(n)) throw missing(); },
    async *entries() { yield* [...kids.entries()]; },
  };
}
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const text = async (d, ...path) => { let h = d; for (const p of path.slice(0, -1)) h = await h.getDirectoryHandle(p); return (await (await h.getFileHandle(path.at(-1))).getFile()).text(); };

test("a folder becomes a vault: projects are folders named after them, revisions are files File › Open reads", async () => {
  const root = dir(), v = V.client({ handle: root }), d = example("08-555-astable.json");
  assert.deepEqual(await v.projects(), []);
  assert.equal(JSON.parse(await text(root, V.MARK)).app, "TubeAmpCAD-vault");
  const p = await v.createProject("555: astable / test?", "notes");
  assert.match(p.id, /^[A-Za-z0-9]{10}$/);
  assert.equal(p.folder, "555_ astable _ test_");
  const again = await v.createProject("555: astable / test?");
  assert.equal(again.folder, "555_ astable _ test_ 2", "a second project of the same name gets its own folder");
  const r1 = await v.saveRevision(p.id, { message: "first", summary: "first revision", thumb: PNG, bthumb: PNG, metrics: { "Output (W)": 1.23456789 }, design: d });
  assert.equal(r1.n, 1); assert.equal(r1.thumb, "image/png"); assert.deepEqual(r1.metrics, { "Output (W)": 1.23457 });
  assert.deepEqual(JSON.parse(await text(root, p.folder, "r1.json")), d);
  assert.ok(root.kids.get(p.folder).kids.has("r1.sheet.png") && root.kids.get(p.folder).kids.has("r1.board.png"));
  assert.equal((await v.saveRevision(p.id, { design: structuredClone(d) })).same, true, "the same design again makes no revision");
  const d2 = structuredClone(d); d2.comps[0].x += 10;
  const r2 = await v.saveRevision(p.id, { message: "moved", design: d2 });
  assert.equal(r2.n, 2); assert.notEqual(r2.hash, r1.hash);
  const r3 = await v.saveRevision(p.id, { message: "back", design: d, parent: 1, force: true });
  assert.equal(r3.parent, 1); assert.equal(r3.hash, r1.hash);
  const got = await v.project(p.id);
  assert.deepEqual(got.revs.map(r => r.n), [1, 2, 3]); assert.equal(got.count, 3); assert.equal(got.thumb, 1);
  assert.match(v.thumbUrl(p.id, 1), /^blob:/); assert.match(v.bthumbUrl(p.id, 1), /^blob:/); assert.equal(v.thumbUrl(p.id, 2), "");
  assert.deepEqual(await v.revision(p.id, 2), d2);
  const me = await v.me();
  assert.equal(me.vault, true); assert.equal(me.folder, "vault"); assert.equal(me.revisions.projects, 2); assert.equal(me.revisions.count, 3); assert.ok(me.revisions.bytes > 1000);
});

test("the hash is the site's: SHA-256 of the design's JSON, base64url, 16 characters", async () => {
  const { createHash } = await import("node:crypto");
  const v = V.client({ handle: dir() }), d = example("01-2n3904-ce-unbypassed.json");
  const p = await v.createProject("x"), r = await v.saveRevision(p.id, { design: d });
  assert.equal(r.hash, createHash("sha256").update(JSON.stringify(d)).digest("base64url").slice(0, 16));
});

test("milestones, messages, project fields, search", async () => {
  const v = V.client({ handle: dir() }), d = example("08-555-astable.json");
  const p = await v.createProject("Amp");
  await v.saveRevision(p.id, { message: "as drawn", design: d });
  assert.equal((await v.updateRevision(p.id, 1, { milestone: "Sent to fab", message: "final" })).milestone, "Sent to fab");
  assert.equal((await v.updateRevision(p.id, 1, { milestone: "" })).milestone, undefined);
  const u = await v.updateProject(p.id, { name: "Amp II", notes: "push-pull", status: "building", tags: "EL84, PP, el84" });
  assert.deepEqual([u.name, u.status, u.tags], ["Amp II", "building", ["el84", "pp"]]);
  assert.equal(u.folder, "Amp", "renaming the project leaves its folder");
  await assert.rejects(v.updateProject(p.id, { status: "nope" }), /status/);
  assert.deepEqual((await v.search("FINAL")).map(h => [h.name, h.n]), [["Amp II", 1]]);
  assert.deepEqual((await v.search("el84")).map(h => h.n), [null]);
  await assert.rejects(v.revision(p.id, 9), /no such revision/);
  await assert.rejects(v.project("nope"), /no such project/);
  await assert.rejects(v.saveRevision(p.id, { design: { app: "other" } }), /not a Tube Amp CAD design/);
});

test("the trash: restore, delete for good, emptied after 30 days; numbers are not reused", async () => {
  let t = Date.parse("2026-01-01T00:00:00Z");
  const root = dir(), v = V.client({ handle: root, now: () => t }), d = example("08-555-astable.json");
  const p = await v.createProject("Amp"), d2 = structuredClone(d); d2.comps[0].x += 10;
  await v.saveRevision(p.id, { design: d, thumb: PNG }); await v.saveRevision(p.id, { design: d2 });
  await v.deleteRevision(p.id, 2);
  assert.deepEqual((await v.project(p.id)).revs.map(r => r.n), [1]);
  await assert.rejects(v.revision(p.id, 2), /in the trash/);
  assert.deepEqual((await v.trash()).revs.map(r => [r.n, r.until]), [[2, "2026-01-31T00:00:00.000Z"]]);
  const d3 = structuredClone(d); d3.comps[0].x += 20;
  assert.equal((await v.saveRevision(p.id, { design: d3 })).n, 3, "the number of a revision in the trash is not given again");
  await v.restoreRevision(p.id, 2);
  assert.deepEqual((await v.project(p.id)).revs.map(r => r.n), [1, 2, 3]);
  await v.deleteRevision(p.id, 1); await v.deleteRevision(p.id, 1, true);
  assert.ok(!root.kids.get("Amp").kids.has("r1.json") && !root.kids.get("Amp").kids.has("r1.sheet.png"), "deleted for good: its files are gone");
  await v.deleteProject(p.id);
  assert.deepEqual(await v.projects(), []); await assert.rejects(v.project(p.id), /in the trash/);
  assert.equal((await v.trash()).projects[0].name, "Amp");
  await v.restoreProject(p.id);
  assert.equal((await v.projects()).length, 1);
  await v.deleteRevision(p.id, 2); await v.deleteProject(p.id);
  // a later visit, 31 days on: the trash has emptied itself
  t += 31 * 86400e3;
  const later = V.client({ handle: root, now: () => t });
  assert.deepEqual(await later.trash(), { days: 30, projects: [], revs: [] });
  assert.ok(!root.kids.has("Amp"));
  const q = await later.createProject("B"); await later.deleteProject(q.id); await later.purgeProject(q.id);
  assert.ok(!root.kids.has("B"));
});

test("release files, and a project copied out and in again with everything", async () => {
  const a = V.client({ handle: dir("a") }), rootB = dir("b"), b = V.client({ handle: rootB }), d = example("08-555-astable.json");
  const p = await a.createProject("Amp", "n");
  await a.saveRevision(p.id, { message: "one", design: d, thumb: PNG, metrics: { x: 1 } });
  const d2 = structuredClone(d); d2.comps[0].x += 10;
  await a.saveRevision(p.id, { message: "two", design: d2, parent: 1 });
  await a.updateRevision(p.id, 1, { milestone: "Built" });
  assert.deepEqual(await a.addFile(p.id, 1, { name: "bom.csv", type: "text/csv", data: btoa("R1,1k\n") }), [{ name: "bom.csv", type: "text/csv", size: 6 }]);
  await assert.rejects(a.addFile(p.id, 1, { name: "../x", type: "text/csv", data: "QQ==" }), /file name/);
  await a.project(p.id);
  assert.match(a.fileUrl(p.id, 1, "bom.csv"), /^blob:/);
  const bundle = await a.exportBundle(p.id);
  assert.equal(bundle.app, "TubeAmpCAD-project"); assert.equal(bundle.project.revs[0].thumbData, PNG); assert.equal(atob(bundle.project.revs[0].files[0].data), "R1,1k\n");
  const q = await b.importProject(JSON.parse(JSON.stringify(bundle)));
  assert.equal(q.id, p.id, "the project keeps its id in another vault"); assert.equal(q.count, 2);
  const got = await b.project(q.id);
  assert.deepEqual(got.revs.map(r => [r.n, r.message, r.milestone, r.thumb, r.metrics, r.files && r.files[0].name]), [[1, "one", "Built", "image/png", { x: 1 }, "bom.csv"], [2, "two", undefined, undefined, undefined, undefined]]);
  assert.deepEqual(await b.revision(q.id, 2), d2);
  assert.equal(await text(rootB, "Amp", "r1.files", "bom.csv"), "R1,1k\n");
  assert.notEqual((await b.importProject(bundle)).id, p.id, "imported twice: the copy gets an id of its own");
  assert.deepEqual(await a.deleteFile(p.id, 1, "bom.csv"), []);
  await assert.rejects(b.importProject({ app: "x" }), /not a Tube Amp CAD project/);
});

test("a folder not ready says why: leave to use it, moved away, a browser without folders", async () => {
  const root = dir(), v = V.client({ handle: root });
  await v.createProject("Amp");
  root.permission = "prompt";
  await assert.rejects(v.projects(), e => e.folder === "permission");
  assert.deepEqual(await v.status(), { supported: true, id: v.id(), name: "vault", granted: false, count: 1 });
  assert.equal(await v.grant(), true);
  assert.equal((await v.projects()).length, 1);
  // a project's folder renamed by hand is still found, by the id in its project.json
  root.kids.set("Renamed", root.kids.get("Amp")); root.kids.delete("Amp");
  const [p] = await v.projects();
  assert.equal(p.folder, "Renamed"); assert.equal((await v.project(p.id)).name, "Amp");
  const none = V.client({});
  assert.equal(none.available, false);
  await assert.rejects(none.projects(), e => e.folder === "unsupported");
});

test("several vaults: each folder added is remembered, and Kept in switches between them", async () => {
  const a = dir("Amp A"), b = dir("Amp B"), v = V.client({ handle: a }), d = example("08-555-astable.json");
  const pa = await v.createProject("A"); await v.saveRevision(pa.id, { design: d, thumb: PNG });
  const idA = v.id();
  assert.match(idA, /^[A-Za-z0-9]{10}$/); assert.equal(JSON.parse(await text(a, V.MARK)).id, idA);
  await v.use(b);
  const idB = v.id();
  assert.notEqual(idB, idA);
  assert.deepEqual(await v.vaults(), [{ id: idA, name: "Amp A", current: false }, { id: idB, name: "Amp B", current: true }]);
  assert.deepEqual(await v.projects(), [], "the second folder has its own projects");
  await v.createProject("B");
  assert.equal(await v.select(idA), true);
  assert.deepEqual((await v.projects()).map(p => p.name), ["A"]);
  assert.equal(await v.select("nope"), false);
  await v.use(a);
  assert.equal((await v.vaults()).length, 2, "a folder added again is not listed twice");
  await v.disconnect();
  assert.deepEqual(await v.vaults(), [{ id: idB, name: "Amp B", current: true }]);
  assert.deepEqual((await v.projects()).map(p => p.name), ["B"]);
  assert.ok(a.kids.has("A"), "a folder taken off the list keeps its files");
  await v.disconnect();
  await assert.rejects(v.projects(), e => e.folder === "none");
});
