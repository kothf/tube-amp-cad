/**
 * Published operating points for every amplifier tube in tube-db.js.
 * Used by scripts/fit-tubes.mjs to fit the Koren models and by
 * tests/engine.test.mjs to check them.
 *
 * Units: volts, mA, mA/V (gm), kΩ (rp).
 *   vg: null  -> the source gives the current but not the bias (e.g. cathode
 *               bias only); the bias is solved from Ia and only gm/rp checked.
 *   mu        -> triodes: amplification factor; pentodes: µ(g1-g2).
 *               Used as a soft prior when the point has no gm/rp pair.
 *   alias     -> electrically equivalent type; uses the referenced data.
 *   largeSignal -> pentodes: published single-ended class-A results at full
 *               drive (B+, cathode resistor rk or fixed bias, load rl, drive
 *               vrms, output power, THD, average Ia/Ig2 at full drive). The
 *               fitter simulates that circuit to set the knee and the screen
 *               share; the reference tests measure it in the app.
 * Rectifiers are not listed: they are simulated as vacuum diodes (perveance
 * from the datasheet drop, sim-engine.js RECTIFIER_PERVEANCE).
 */
export const DATASHEETS = [
  // ---- small-signal triodes ------------------------------------------------
  { tube: "12AX7", kind: "triode", mu: 100, source: "RCA 12AX7A", points: [
    { va: 100, vg: -1, ia: 0.5, gm: 1.25, rp: 80 },
    { va: 250, vg: -2, ia: 1.2, gm: 1.6, rp: 62.5 }] },
  { tube: "6N2P-EV", kind: "triode", mu: 97.5, source: "6Н2П handbook (Ia 2.3 mA, S 2.1 mA/V, µ 97.5)", points: [
    { va: 250, vg: -1.5, ia: 2.3, gm: 2.1, rp: 46.4 }] },
  { tube: "6SL7GT", kind: "triode", mu: 70, source: "RCA 6SL7GT", points: [
    { va: 250, vg: -2, ia: 2.3, gm: 1.6, rp: 44 }] },
  { tube: "6N9S", alias: "6SL7GT", source: "6Н9С = 6SL7GT" },
  { tube: "12AY7", kind: "triode", mu: 44, source: "RCA 12AY7", points: [
    { va: 250, vg: -4, ia: 3, gm: 1.75, rp: 25 }] },
  { tube: "12AT7", kind: "triode", mu: 60, source: "RCA 12AT7", points: [
    { va: 100, vg: -1, ia: 3.7, gm: 4.0, rp: 15 },
    { va: 250, vg: -2, ia: 10, gm: 5.5, rp: 10.9 }] },
  { tube: "12AU7", kind: "triode", mu: 17, source: "RCA 12AU7A", points: [
    { va: 100, vg: 0, ia: 11.8, gm: 3.1, rp: 6.25 },
    { va: 250, vg: -8.5, ia: 10.5, gm: 2.2, rp: 7.7 }] },
  { tube: "6SN7GT", kind: "triode", mu: 20, source: "RCA 6SN7GTB", points: [
    { va: 90, vg: 0, ia: 10, gm: 3.0, rp: 6.7 },
    { va: 250, vg: -8, ia: 9, gm: 2.6, rp: 7.7 }] },
  { tube: "6N8S", alias: "6SN7GT", source: "6Н8С = 6SN7GT" },
  { tube: "6N7S", kind: "triode", mu: 35, source: "RCA 6N7, class A1 per unit", points: [
    { va: 250, vg: -6, ia: 6, gm: 3.1, rp: 11.3 }] },
  { tube: "6N1P-VI", kind: "triode", mu: 35, source: "6Н1П handbook (Ia 7.5 mA, S 4.35 mA/V, µ 35; cathode bias)", points: [
    { va: 250, vg: null, ia: 7.5, gm: 4.35, rp: 8.05 }] },
  { tube: "6N23P-EV", kind: "triode", mu: 33, source: "Philips ECC88 (= 6Н23П)", points: [
    { va: 90, vg: -1.3, ia: 15, gm: 12.5, rp: 2.6 }] },
  { tube: "6N6P", kind: "triode", mu: 20, source: "6Н6П handbook (Ia 30 mA, S 11 mA/V, µ 20, Ri 1.8 k)", points: [
    { va: 120, vg: null, ia: 30, gm: 11, rp: 1.8 }] },
  { tube: "6S45P", kind: "triode", mu: 52, source: "6С45П-Е handbook (Ia 40 mA, S 45 mA/V, µ 52)", points: [
    { va: 150, vg: null, ia: 40, gm: 45, rp: 1.16 }] },
  { tube: "6S3P", kind: "triode", mu: 50, source: "6С3П-Е (Ia 15 mA, S 19.5 mA/V at 150 V; µ 50, rp = µ/S)", points: [
    { va: 150, vg: null, ia: 15, gm: 19.5, rp: 2.56 }] },
  { tube: "WE417A", kind: "triode", mu: 43, source: "WE 417A / 5842 (25 mA, 25 mA/V, µ 43 at 150 V)", points: [
    { va: 150, vg: null, ia: 25, gm: 25, rp: 1.72 }] },
  { tube: "6S19P", kind: "triode", mu: 3, source: "6С19П (110 V, 95 mA, S 7.5 mA/V, Ri 400 Ω)", points: [
    { va: 110, vg: null, ia: 95, gm: 7.5, rp: 0.4 }] },
  // ---- power triodes -------------------------------------------------------
  { tube: "2A3", kind: "triode", mu: 4.2, source: "RCA 2A3", points: [
    { va: 250, vg: -45, ia: 60, gm: 5.25, rp: 0.8 }] },
  { tube: "6S4S", alias: "2A3", source: "6С4С = 6B4G (octal 2A3)" },
  { tube: "300B", kind: "triode", mu: 3.85, source: "Western Electric 300B", points: [
    { va: 300, vg: -61, ia: 60, gm: 5.5, rp: 0.7 }] },
  { tube: "845", kind: "triode", mu: 5.3, source: "RCA 845, class A1", points: [
    { va: 750, vg: -98, ia: 95 },
    { va: 1000, vg: -145, ia: 90, gm: 3.1, rp: 1.7 },
    { va: 1250, vg: -195, ia: 80 }] },
  { tube: "GM-70", kind: "triode", mu: 6, source: "ГМ-70 handbook (850 V, 120 mA, S 6.7 mA/V, Ri 900 Ω)", points: [
    { va: 850, vg: null, ia: 120, gm: 6.7, rp: 0.9 }] },
  { tube: "6S33S-V", kind: "triode", mu: 2.7, source: "6С33С-В (120 V, Rk 35 Ω, 550 mA, S 40 mA/V, µ 2.7)", points: [
    { va: 120, vg: -19.25, ia: 550, gm: 40 }] },
  // ---- pentodes / beam tetrodes (single tube, class A1) ---------------------
  { tube: "EL84", kind: "pentode", mu: 19, source: "Philips EL84", points: [
    { va: 250, vg2: 250, vg: -7.3, ia: 48, ig2: 5.5, gm: 11.3, rp: 38 }],
    // single-ended class A at full drive (cathode bias; B+ includes the 7.2 V cathode rise)
    largeSignal: [{ b: 257, rk: 135, rl: 5200, vrms: 4.3, pout: 5.7, thd: 10, ia: 49.5, ig2: 10.8 }] },
  { tube: "6P14P-EV", alias: "EL84", source: "6П14П = EL84" },
  { tube: "6P14P", alias: "EL84", source: "6П14П = EL84" },
  { tube: "EL34", kind: "pentode", mu: 11, source: "Philips EL34", points: [
    { va: 250, vg2: 250, vg: -13.5, ia: 100, ig2: 14.9, gm: 11, rp: 15 }] },
  { tube: "6P27S", alias: "EL34", source: "6П27С = EL34" },
  { tube: "6V6GT", kind: "pentode", mu: 9.8, source: "RCA 6V6GT", points: [
    { va: 250, vg2: 250, vg: -12.5, ia: 45, ig2: 4.5, gm: 4.1, rp: 52 },
    { va: 315, vg2: 225, vg: -13, ia: 34, ig2: 2.2, gm: 3.75, rp: 77 }],
    largeSignal: [
      { b: 250, vg2: 250, bias: -12.5, rl: 5000, vrms: 12.5 / Math.SQRT2, pout: 4.5, thd: 8, ia: 47, ig2: 7.0 },
      { b: 315, vg2: 225, bias: -13, rl: 8500, vrms: 13 / Math.SQRT2, pout: 5.5, thd: 12, ia: 35, ig2: 6.0 }] },
  { tube: "6P6S", alias: "6V6GT", source: "6П6С = 6V6GT" },
  { tube: "6P1P", kind: "pentode", mu: 9.5, source: "6П1П handbook (Ia 44 mA, S 4.9 mA/V; 6AQ5 class)", points: [
    { va: 250, vg2: 250, vg: -12.5, ia: 44, gm: 4.9 }] },
  { tube: "6L6GC", kind: "pentode", mu: 8, source: "RCA 6L6GC", points: [
    { va: 250, vg2: 250, vg: -14, ia: 72, ig2: 5, gm: 6.0, rp: 22.5 },
    { va: 350, vg2: 250, vg: -18, ia: 54, ig2: 2.5, gm: 5.2, rp: 33 }],
    largeSignal: [{ b: 250, vg2: 250, bias: -14, rl: 2500, vrms: 14 / Math.SQRT2, pout: 6.5, thd: 10 }] },
  { tube: "6P3S-E", alias: "6L6GC", source: "6П3С-Е = 6L6" },
  { tube: "KT88", kind: "pentode", mu: 8, source: "GE 6550A (KT88 class)", points: [
    { va: 250, vg2: 250, vg: -14, ia: 140, ig2: 12, gm: 11, rp: 15 }] },
  { tube: "GU-50", kind: "pentode", mu: 8, source: "ГУ-50 handbook (800 V, Vg2 250 V, Vg1 −40 ± 10 V, 50 mA, S 4 mA/V)", points: [
    { va: 800, vg2: 250, vg: -40, ia: 50, gm: 4 }] },
  { tube: "6P45S", kind: "pentode", mu: 5.5, source: "6П45С handbook (Va 50 V, Vg2 175 V, Vg1 −10 V: 800 mA pulse)", points: [
    { va: 50, vg2: 175, vg: -10, ia: 800 }] }
];

/** The entry with aliases resolved. */
export function datasheetFor(name) {
  const e = DATASHEETS.find(d => d.tube === name);
  if (!e) return null;
  return e.alias ? { ...DATASHEETS.find(d => d.tube === e.alias), tube: name, source: e.source } : e;
}
