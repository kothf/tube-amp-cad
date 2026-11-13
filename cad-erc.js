/* Electrical rules check on pin types (no DOM; the CAD's Checks list, Node tests).
   Every pin of every part has a role:
     in    an input that draws no current to speak of and takes its DC level from outside: a
           grid, a gate, a base, an op-amp's inputs, a regulator's ADJ, a 555's trigger
     out   an output that sets its net's voltage: an op-amp's, a regulator's, a 555's
     pwr   a supply pin of an IC
     src   a supply or a signal source (a battery, a rail, the mains, a generator)
     def   any other terminal that carries DC and so defines the level of what it is wired to (an
           anode, a cathode, a collector, a diode, a connector to the outside world)
     -     a capacitor's plate: no DC through it
   and some parts pass DC from pin to pin (a resistor, a choke, a winding, a switch, a fuse).
   The rules:
     1  an input with no DC path: nothing but capacitors and other inputs on its net, however far
        one follows resistors and windings (a grid without its leak, a gate left hanging)
     2  a supply pin fed by nothing
     3  outputs wired together, or an output wired to ground or straight to a supply
     4  an IC's two supply pins on one net; a supply shorted by its own wiring
   check({ parts: [{ label, type, params, pins: [{ id, net }] }] }) → [{ rule, text, refs: [label] }];
   net 0 is ground, a pin without a net is left to the "unconnected pins" check. */
(function (root) {
  "use strict";
  const SYM = () => (root.CadLib && root.CadLib.SPICE_SYMS) || {};
  // a SPICE part's box pin, by what its maker called it (only the plain cases: a wrong guess is a false alarm)
  const boxRole = name => { const n = String(name || "").toLowerCase().replace(/[\s_]/g, ""); return /^(vcc|vdd|vee|vss|v\+|v-|vs\+|vs-|vp|vn|vin)$/.test(n) ? "pwr" : /^(out|output|vout|vo)$/.test(n) ? "out" : /^(in\+|in-|\+in|-in|inp|inn|inv|noninv|adj|fb)$/.test(n) ? "in" : "def"; };
  const ROLES = {
    ground: () => "-", offsheet: () => "-", capacitor: () => "-", electrolytic: () => "-", note: () => "-", frame: () => "-", scope: () => "-", mov: () => "-",
    tube: id => (/^G\d?$/.test(id) ? "in" : "def"), eye: id => (id === "G" ? "in" : "def"),
    npn: id => (id === "B" ? "in" : "def"), pnp: id => (id === "B" ? "in" : "def"),
    nmos: id => (id === "G" ? "in" : "def"), pmos: id => (id === "G" ? "in" : "def"), njf: id => (id === "G" ? "in" : "def"), pjf: id => (id === "G" ? "in" : "def"),
    opamp: id => (id === "+" || id === "-" ? "in" : id === "OUT" ? "out" : id === "V+" || id === "V-" ? "pwr" : "-"),
    chipamp: id => (id === "+" || id === "-" ? "in" : id === "OUT" ? "out" : id === "V+" || id === "V-" ? "pwr" : "-"),
    timer555: id => ({ 1: "pwr", 8: "pwr", 3: "out", 2: "in", 6: "in", 4: "in" }[id] || "def"),
    reg: id => (id === "O" ? "out" : id === "I" ? "pwr" : "in"), tl431: id => (id === "R" ? "in" : "def"),
    vcvs: id => (/^C/.test(id) ? "in" : "src"), vccs: id => (/^C/.test(id) ? "in" : "def"),
    vdc: () => "src", battery: () => "src", rail: () => "src", mains: () => "src", siggen: () => "src", pickup: () => "src", phono: () => "src", isrc: () => "def",
    spice: (id, p) => { const sy = SYM()[p.sym]; if (sy) return (ROLES[sy.type] || (() => "def"))(id, {}); return boxRole((p.pinNames || [])[+id - 1]); }
  };
  // the pins DC passes between: groups of pin ids, or true for all of a part's pins
  const PASS = {
    resistor: true, pot: true, inductor: true, fuse: true, ntc: true, lamp: true, meter: true, speaker: true, switch: true, spst: true, rotary: true,
    opt_se: [["P1", "P2"], ["S1", "S2"]], opt_cat: [["P1", "P2"], ["S1", "S2"]], itx: [["P1", "P2"], ["S1", "S2"]], opt_pp: [["P1", "U1", "CT", "U2", "P2"], ["S1", "S2"]],
    ptx: [["HT1", "CT", "HT2"]], ptx_cat: [["P1", "P2"], ["HT1", "CT", "HT2"]], vactrol: [["1", "2"]],
    relay: pins => [["A1", "A2"], ...[1, 2, 3, 4].map(k => [`${k}1`, `${k}2`, `${k}4`]).filter(g => pins.includes(g[0]))]
  };
  const roleOf = (part, id) => { const f = ROLES[part.type]; return f ? f(id, part.params || {}) : PASS[part.type] ? "-" : "def"; };

  function check(circuit) {
    const parts = (circuit && circuit.parts) || [], issues = [];
    // nets joined by what passes DC (union-find over net numbers)
    const up = new Map(), find = n => { let r = n; while (up.has(r) && up.get(r) !== r) r = up.get(r); up.set(n, r); return r; }, join = (a, b) => { a = find(a); b = find(b); if (a !== b) up.set(a, b); };
    const wired = p => p.net !== undefined && p.net !== null;
    parts.forEach(part => {
      let g = PASS[part.type]; if (!g) return;
      const ids = part.pins.map(p => p.id);
      if (typeof g === "function") g = g(ids);
      (g === true ? [ids] : g).forEach(group => { const nets = part.pins.filter(p => group.includes(p.id) && wired(p)).map(p => p.net); nets.forEach(n => join(nets[0], n)); });
    });
    // per net: its pins by role; per DC island: whether anything defines its level
    const onNet = new Map(), defined = new Set([find(0)]);
    parts.forEach(part => part.pins.forEach(p => {
      if (!wired(p)) return;
      const role = roleOf(part, p.id);
      if (!onNet.has(p.net)) onNet.set(p.net, []);
      onNet.get(p.net).push({ part, id: p.id, role });
      if (role === "def" || role === "src" || role === "out") defined.add(find(p.net));
    }));
    // the island is fixed once every join is made: resolve again
    const isDefined = n => [...defined].some(d => find(d) === find(n));
    const name = x => `${x.part.label || x.part.type}.${x.id}`;
    const say = (rule, text, list) => issues.push({ rule, text, refs: [...new Set(list.map(x => x.part.label).filter(Boolean))] });

    // 1, 2: inputs and supply pins with nothing behind them
    const floating = { in: [], pwr: [] };
    onNet.forEach((list, net) => { if (isDefined(net)) return; list.forEach(x => { if (floating[x.role]) floating[x.role].push(x); }); });
    if (floating.in.length) say("float", `No DC path for ${floating.in.map(name).join(", ")}: only capacitors and other inputs are wired to ${floating.in.length > 1 ? "them" : "it"}. Give ${floating.in.length > 1 ? "each" : "it"} a resistor to ground or to its bias (a grid leak, a gate or base resistor).`, floating.in);
    if (floating.pwr.length) say("power", `Supply pin${floating.pwr.length > 1 ? "s" : ""} fed by nothing: ${floating.pwr.map(name).join(", ")}.`, floating.pwr);
    // 3: outputs against each other, against ground, against a supply
    onNet.forEach((list, net) => {
      const outs = list.filter(x => x.role === "out"), src = list.filter(x => x.role === "src" && (x.part.type === "rail" || x.part.type === "vdc" || x.part.type === "battery"));
      if (!outs.length) return;
      const byPart = [...new Set(outs.map(x => x.part))];
      if (byPart.length > 1) say("outputs", `Outputs wired together: ${outs.map(name).join(", ")}. Put a resistor in each, or use one.`, outs);
      if (net === 0) say("outputs", `Output${outs.length > 1 ? "s" : ""} wired to ground: ${outs.map(name).join(", ")}.`, outs);
      else if (src.length) say("outputs", `Output ${outs.map(name).join(", ")} wired straight to the supply ${src.map(x => (x.part.type === "rail" && x.part.params && x.part.params.name) || x.part.label).filter((t, i, a) => a.indexOf(t) === i).join(", ")}.`, outs.concat(src));
    });
    // 4: an IC's supply pins on one net; a supply's own terminals on one net
    parts.forEach(part => {
      const pw = part.pins.filter(p => wired(p) && roleOf(part, p.id) === "pwr");
      if (pw.length === 2 && pw[0].net === pw[1].net && (part.type === "opamp" || part.type === "chipamp" || part.type === "timer555" || part.type === "spice")) say("power", `${part.label}: its supply pins ${pw[0].id} and ${pw[1].id} are on one net, so it has no supply.`, [{ part }]);
      if ((part.type === "vdc" || part.type === "battery" || part.type === "mains") && part.pins.length === 2 && wired(part.pins[0]) && part.pins[0].net === part.pins[1].net) say("short", `${part.label} is shorted: both its terminals are on one net.`, [{ part }]);
    });
    return issues;
  }
  root.CadErc = { check, roleOf };
})(typeof window !== "undefined" ? window : globalThis);
