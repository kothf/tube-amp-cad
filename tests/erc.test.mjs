/**
 * Electrical rules on pin types (cad-erc.js): inputs without a DC path, supply pins fed by
 * nothing, outputs against each other, against ground and against a supply (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "cad-erc.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const ERC = globalThis.CadErc;
const part = (label, type, pins, params) => ({ label, type, params: params || {}, pins: Object.entries(pins).map(([id, net]) => ({ id, net })) });
const texts = parts => ERC.check({ parts }).map(i => i.text).join(" | ");
const R = (label, a, b) => part(label, "resistor", { 1: a, 2: b }), C = (label, a, b) => part(label, "capacitor", { 1: a, 2: b });
// a triode stage: B+ on net 1, anode 2, grid 3, cathode 4, input 5
const stage = extra => [part("G1", "vdc", { "+": 1, "-": 0 }), R("R1", 1, 2), part("VL1", "tube", { A: 2, G: 3, K: 4 }), R("R2", 4, 0), C("C1", 5, 3), part("G2", "siggen", { "+": 5, "-": 0 }), ...extra];

test("a grid behind its coupling capacitor needs a leak; a resistor, however far, gives the path", () => {
  assert.match(texts(stage([])), /No DC path for VL1\.G: only capacitors and other inputs are wired to it/);
  assert.equal(texts(stage([R("R3", 3, 0)])), "");
  // a grid stopper to a leak, a leak to a bias supply, a grid on the stage before (DC coupled), a choke, a winding
  assert.equal(texts(stage([R("R3", 3, 6), R("R4", 6, 0)])), "");
  assert.equal(texts(stage([R("R3", 3, 6), part("G3", "vdc", { "+": 0, "-": 6 })])), "");
  assert.equal(texts(stage([part("VL2", "tube", { A: 3, G: 5, K: 0 }), R("R5", 1, 3)])), "");
  assert.equal(texts(stage([part("L1", "inductor", { 1: 3, 2: 0 })])), "");
  assert.equal(texts(stage([part("T1", "itx", { P1: 5, P2: 0, S1: 3, S2: 0 })])), "");
  // a stopper that leads to another capacitor only: still no path, and both grids on it are named
  assert.match(texts(stage([R("R3", 3, 6), C("C2", 6, 0), part("VL2", "tube", { A: 1, G: 6, K: 0 })])), /No DC path for VL1\.G, VL2\.G: .* wired to them\. Give each/);
});

test("gates, bases, op-amp inputs, a regulator's ADJ; a pin not wired at all is the other check's", () => {
  const sup = [part("G1", "vdc", { "+": 1, "-": 0 }), part("G2", "vdc", { "+": 0, "-": 2 })];
  assert.match(texts([...sup, part("VT1", "nmos", { D: 1, G: 3, S: 0 }), C("C1", 3, 4), part("G3", "siggen", { "+": 4, "-": 0 })]), /No DC path for VT1\.G/);
  assert.match(texts([...sup, part("VT1", "npn", { C: 1, B: 3, E: 0 }), C("C1", 3, 0)]), /No DC path for VT1\.B/);
  // a follower: the − input on the output, the + input behind a capacitor
  const amp = plus => part("DA1", "opamp", { "+": plus, "-": 4, OUT: 4, "V+": 1, "V-": 2 });
  assert.match(texts([...sup, amp(3), C("C1", 3, 5), part("G3", "siggen", { "+": 5, "-": 0 })]), /No DC path for DA1\.\+:/);
  assert.equal(texts([...sup, amp(3), C("C1", 3, 5), R("R1", 3, 0), part("G3", "siggen", { "+": 5, "-": 0 })]), "");
  assert.match(texts([part("G1", "vdc", { "+": 1, "-": 0 }), part("DA1", "reg", { I: 1, O: 3, A: 4 }), C("C1", 4, 0), R("R1", 3, 0)]), /No DC path for DA1\.A/);
  assert.equal(texts([...sup, part("VT1", "nmos", { D: 1, G: undefined, S: 0 })]), "");
});

test("supply pins: fed by nothing, both on one net; outputs together, to ground, to a rail; a shorted supply", () => {
  const sup = [part("G1", "vdc", { "+": 1, "-": 0 }), part("G2", "vdc", { "+": 0, "-": 2 })];
  const amp = (label, out, vp, vn) => part(label, "opamp", { "+": 0, "-": out, OUT: out, "V+": vp, "V-": vn });
  assert.match(texts([...sup, amp("DA1", 4, 7, 2), C("C1", 7, 0)]), /Supply pin fed by nothing: DA1\.V\+\./);
  assert.match(texts([...sup, amp("DA1", 4, 1, 1)]), /DA1: its supply pins V\+ and V- are on one net/);
  assert.equal(texts([...sup, amp("DA1", 4, 1, 0)]), "", "single supply: V− on ground");
  assert.match(texts([...sup, amp("DA1", 4, 1, 2), amp("DA2", 4, 1, 2)]), /Outputs wired together: DA1\.OUT, DA2\.OUT/);
  assert.equal(texts([...sup, amp("DA1", 4, 1, 2), amp("DA2", 5, 1, 2), R("R1", 4, 6), R("R2", 5, 6)]), "", "summed through resistors");
  assert.match(texts([...sup, amp("DA1", 0, 1, 2)]), /Output wired to ground: DA1\.OUT/);
  assert.match(texts([...sup, amp("DA1", 4, 1, 2), part("", "rail", { 1: 4 }, { name: "+5V", v: 5 })]), /Output DA1\.OUT wired straight to the supply \+5V/);
  assert.match(texts([part("G1", "vdc", { "+": 3, "-": 3 }), R("R1", 3, 0)]), /G1 is shorted: both its terminals are on one net/);
  assert.match(texts([part("G1", "vdc", { "+": 1, "-": 0 }), part("DA1", "timer555", { 1: 0, 8: 9, 2: 3, 6: 3, 3: 4, 4: 1, 5: 5, 7: 6 }), R("R1", 1, 3), R("R2", 4, 0), R("R3", 6, 1), C("C1", 5, 0)]), /Supply pin fed by nothing: DA1\.8/);
});

test("a SPICE part: its symbol's roles; a box by the plain pin names, anything else left alone", () => {
  const sup = [part("G1", "vdc", { "+": 1, "-": 0 }), part("G2", "vdc", { "+": 0, "-": 2 })];
  const sp = (pins, params) => part("DA1", "spice", pins, params);
  assert.match(texts([...sup, sp({ "+": 3, "-": 4, OUT: 4, "V+": 1, "V-": 2 }, { sym: "opamp" }), C("C1", 3, 0)]), /No DC path for DA1\.\+/);
  assert.match(texts([...sup, sp({ D: 1, G: 3, S: 0 }, { sym: "nmos" }), C("C1", 3, 0)]), /No DC path for DA1\.G/);
  const box = { sym: "box", pinNames: ["IN+", "IN-", "VCC", "VEE", "OUT", "COMP"] };
  assert.match(texts([...sup, sp({ 1: 3, 2: 4, 3: 1, 4: 2, 5: 4, 6: 7 }, box), C("C1", 3, 0), C("C2", 7, 0)]), /No DC path for DA1\.1:/);
  assert.equal(ERC.roleOf({ type: "spice", params: box }, "6"), "def");
  assert.equal(ERC.roleOf({ type: "spice", params: box }, "3"), "pwr");
});
