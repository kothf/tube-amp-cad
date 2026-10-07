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
 *   tol       -> per-point test tolerance where the source prints a wide spread
 *               (e.g. tol: { rp: 0.25 } for Ri 400 ± 100 Ω).
 *   largeSignal -> pentodes: published single-ended class-A results at full
 *               drive (B+, cathode resistor rk or fixed bias, load rl, drive
 *               vrms, output power, THD, average Ia/Ig2 at full drive; rg2: an
 *               unbypassed screen series resistor, vg2: a separate screen supply). The
 *               fitter simulates that circuit to set the knee and the screen
 *               share; the reference tests measure it in the app.
 * Rectifiers are not listed: they are simulated as vacuum diodes (perveance
 * from the datasheet drop, sim-engine.js RECTIFIER_PERVEANCE).
 */
export const DATASHEETS = [
  // ---- Katsnelson & Larionov 1981, «Отечественные приёмно-усилительные лампы»: rated points ----
  { tube: "6S1P", kind: "triode", mu: 27.26, source: "K&L 1981 p. 81 (6С1П)", points: [
    { va: 250, vg: -7, ia: 6.1, gm: 2.35, rp: 11.6 }] },
  { tube: "6S2S", kind: "triode", mu: 20.5, source: "K&L 1981 p. 85 (6С2С)", points: [
    { va: 250, vg: -8, ia: 9, gm: 2.6, rp: 7.88 }] },
  { tube: "6S3B", kind: "triode", mu: 14, source: "K&L 1981 p. 86 (6С3Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 270, vg: -12.8, ia: 8.5, gm: 2.2, rp: 6.36 }] },
  { tube: "6S3P", kind: "triode", mu: 50, source: "K&L 1981 p. 87 (6С3П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg: -1.6, ia: 16, gm: 19.5, rp: 2.56 }] },
  { tube: "6S6B", kind: "triode", mu: 25, source: "K&L 1981 p. 91 (6С6Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 120, vg: -1.98, ia: 9, gm: 5, rp: 5 }] },
  { tube: "6S7B", kind: "triode", mu: 65, source: "K&L 1981 p. 93 (6С7Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 250, vg: -1.8, ia: 4.5, gm: 4, rp: 16.2 }] },
  { tube: "6S15P", kind: "triode", mu: 52, source: "K&L 1981 p. 95 (6С15П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg: -1.2, ia: 40, gm: 45, rp: 1.16 }] },
  { tube: "6S19P", kind: "triode", mu: 3, source: "K&L 1981 p. 97 (6С19П; Ri printed 400 ± 100 Ω)", points: [
    { va: 110, vg: -7, ia: 95, gm: 7.5, rp: 0.4, tol: { rp: 0.25 } }] },
  { tube: "6S31B", kind: "triode", mu: 17, source: "K&L 1981 p. 103 (6С31Б)", points: [
    { va: 50, vg: 0, ia: 40, gm: 18, rp: 0.944 }] },
  { tube: "6S32B", kind: "triode", mu: 100, source: "K&L 1981 p. 105 (6С32Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 200, vg: -0.998, ia: 3.5, gm: 3.5, rp: 28.6 }] },
  { tube: "6S33S-V", kind: "triode", mu: 3.9, source: "K&L 1981 p. 106 (6С33С, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 120, vg: -18.9, ia: 540, gm: 39, rp: 0.1 }] },
  { tube: "6S34A", kind: "triode", mu: 25, source: "K&L 1981 p. 108 (6С34А, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 100, vg: -1.02, ia: 8.5, gm: 4.6, rp: 5.43 }] },
  { tube: "6S35A", kind: "triode", mu: 70, source: "K&L 1981 p. 110 (6С35А, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 200, vg: -1.14, ia: 3, gm: 4, rp: 17.5 }] },
  { tube: "6S41S", kind: "triode", mu: 2.85, source: "K&L 1981 p. 115 (6С41С, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 90, vg: -9.6, ia: 240, gm: 19, rp: 0.15 }] },
  { tube: "6S45P", kind: "triode", mu: 52, source: "K&L 1981 p. 117 (6С45П-Е, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg: -1.2, ia: 40, gm: 45, rp: 1.16 }] },
  { tube: "6S46G-V", kind: "triode", mu: 7, source: "K&L 1981 p. 119 (6С46Г-В)", points: [
    { va: 42, vg: -1, ia: 60, gm: 20, rp: 0.35 }] },
  { tube: "6S51N", kind: "triode", mu: 30, source: "K&L 1981 p. 122 (6С51Н, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 80, vg: -1.3, ia: 10, gm: 11, rp: 2.73 }] },
  { tube: "6S52N", kind: "triode", mu: 60, source: "K&L 1981 p. 124 (6С52Н, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 120, vg: -1.04, ia: 8, gm: 10, rp: 6 }] },
  { tube: "6S56P", kind: "triode", mu: 2.975, source: "K&L 1981 p. 127 (6С56П; Ri 350 Ω printed without tolerance; a 3/2-power model meeting gm gives ~30 % more)", points: [
    { va: 110, vg: -7, ia: 95, gm: 8.5, rp: 0.35, tol: { rp: 0.35 } }] },
  { tube: "6S66P", kind: "triode", mu: 11, source: "K&L 1981 p. 136 (6С66П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg: -9, ia: 75, gm: 24.5, rp: 0.449 }] },
  { tube: "6N1P-VI", kind: "triode", mu: 35, source: "K&L 1981 p. 137 (6Н1П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 250, vg: -4.5, ia: 7.5, gm: 4.5, rp: 7.78 }] },
  { tube: "6N2P-EV", kind: "triode", mu: 97.5, source: "K&L 1981 p. 140 (6Н2П)", points: [
    { va: 250, vg: -1.5, ia: 1.8, gm: 2.25, rp: 43.3 }] },
  { tube: "6N3P", kind: "triode", mu: 34, source: "K&L 1981 p. 142 (6Н3П)", points: [
    { va: 150, vg: -2, ia: 8.75, gm: 5.9, rp: 5.76 }] },
  { tube: "6N6P", kind: "triode", mu: 20, source: "K&L 1981 p. 146 (6Н6П)", points: [
    { va: 120, vg: -2, ia: 30, gm: 11, rp: 1.82 }] },
  { tube: "6N7S", kind: "triode", mu: 35, source: "K&L 1981 p. 148 (6Н7С; printed for both triodes in parallel, halved per triode)", points: [
    { va: 300, vg: -6, ia: 3.375, gm: 1.7, rp: 20.6 }] },
  { tube: "6N8S", kind: "triode", mu: 21.5, source: "K&L 1981 p. 149 (6Н8С)", points: [
    { va: 250, vg: -8, ia: 9, gm: 3, rp: 7.17 }] },
  { tube: "6N9S", kind: "triode", mu: 70, source: "K&L 1981 p. 150 (6Н9С)", points: [
    { va: 250, vg: -2, ia: 2.3, gm: 1.7, rp: 41.2 }] },
  { tube: "6N13S", kind: "triode", mu: 2.53, source: "K&L 1981 p. 151 (6Н13С)", points: [
    { va: 90, vg: -30, ia: 80, gm: 5.5, rp: 0.46 }] },
  { tube: "6N15P", kind: "triode", mu: 38, source: "K&L 1981 p. 154 (6Н15П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 100, vg: -0.45, ia: 9, gm: 5.6, rp: 6.79 }] },
  { tube: "6N16B", kind: "triode", mu: 25, source: "K&L 1981 p. 156 (6Н16Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 100, vg: -2.05, ia: 6.3, gm: 5, rp: 5 }] },
  { tube: "6N17B", kind: "triode", mu: 75, source: "K&L 1981 p. 158 (6Н17Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 200, vg: -1.07, ia: 3.3, gm: 3.8, rp: 19.7 }] },
  { tube: "6N18B", kind: "triode", mu: 23, source: "K&L 1981 p. 160 (6Н18Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 100, vg: -2.05, ia: 6.3, gm: 5, rp: 4.6 }] },
  { tube: "6N21B", kind: "triode", mu: 82, source: "K&L 1981 p. 162 (6Н21Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 200, vg: -1.16, ia: 3.5, gm: 3.8, rp: 21.6 }] },
  { tube: "6N23P-EV", kind: "triode", mu: 32.5, source: "K&L 1981 p. 164 (6Н23П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 90, vg: -1.23, ia: 15, gm: 12.5, rp: 2.6 }] },
  { tube: "6N28B-V", kind: "triode", mu: 22, source: "K&L 1981 p. 172 (6Н28Б-В)", points: [
    { va: 50, vg: -1, ia: 7, gm: 6.75, rp: 3.26 }] },
  { tube: "6N30P-DR", kind: "triode", mu: 15, source: "K&L 1981 p. 174 (6Н30П-ДР, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 80, vg: -2.24, ia: 40, gm: 18, rp: 0.833 }] },
  { tube: "6N33B", kind: "triode", mu: 70, source: "K&L 1981 p. 178 (6Н33Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 100, vg: -1.35, ia: 0.9, gm: 2, rp: 35 }] },
  { tube: "6E5P", kind: "pentode", mu: 44.9, source: "K&L 1981 p. 180 (6Э5П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg2: 150, vg: -1.44, ia: 43, gm: 30.5, rp: 8 }] },
  { tube: "6E6P-E", kind: "pentode", mu: 41.3, source: "K&L 1981 p. 182 (6Э6П-Е, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg2: 150, vg: -1.62, ia: 44, gm: 29.5, rp: 15, ig2: 10 }] },
  { tube: "6Zh1P", kind: "pentode", mu: 33.6, source: "K&L 1981 p. 203 (6Ж1П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 120, vg2: 120, vg: -1.65, ia: 7.35, gm: 5.15, rp: 300 }] },
  { tube: "6Zh3P", kind: "pentode", mu: 40.7, source: "K&L 1981 p. 210 (6Ж3П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 250, vg2: 150, vg: -1.8, ia: 7, gm: 5, rp: 800, ig2: 2 }] },
  { tube: "6Zh4", kind: "pentode", mu: 42.5, source: "K&L 1981 p. 212 (6Ж4, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 300, vg2: 150, vg: -1.99, ia: 10.25, gm: 9, ig2: 2.2 }] },
  { tube: "6Zh4P", kind: "pentode", mu: 38.4, source: "K&L 1981 p. 213 (6Ж4П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 250, vg2: 150, vg: -1.05, ia: 11, gm: 5.2, rp: 1000, ig2: 4.5 }] },
  { tube: "6Zh5P", kind: "pentode", mu: 36.5, source: "K&L 1981 p. 216 (6Ж5П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 300, vg2: 120, vg: -1.79, ia: 10, gm: 9 }] },
  { tube: "6Zh9P", kind: "pentode", mu: 58.9, source: "K&L 1981 p. 220 (6Ж9П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 150, vg2: 150, vg: -1.39, ia: 15, gm: 17.5, rp: 150, ig2: 2.4 }] },
  { tube: "6Zh32B", kind: "pentode", mu: 42.4, source: "K&L 1981 p. 235 (6Ж32Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 120, vg2: 120, vg: -1.48, ia: 6, gm: 6, ig2: 1.4 }] },
  { tube: "6Zh32P", kind: "pentode", mu: 32.9, source: "K&L 1981 p. 236 (6Ж32П)", points: [
    { va: 250, vg2: 140, vg: -2, ia: 3, gm: 1.8, ig2: 0.6 }] },
  { tube: "6P1P", kind: "pentode", mu: 10, source: "K&L 1981 p. 293 (6П1П)", points: [
    { va: 250, vg2: 250, vg: -12.5, ia: 45, gm: 4.9, rp: 42.5 }] },
  { tube: "6P3S-E", kind: "pentode", mu: 8.28, source: "K&L 1981 p. 295 (6П3С)", points: [
    { va: 250, vg2: 250, vg: -14, ia: 72, gm: 6, rp: 25 }] },
  { tube: "6P6S", kind: "pentode", mu: 9.04, source: "K&L 1981 p. 296 (6П6С)", points: [
    { va: 250, vg2: 250, vg: -12.5, ia: 46, gm: 4.1 }] },
  { tube: "6P9", kind: "pentode", mu: 23.2, source: "K&L 1981 p. 297 (6П9)", points: [
    { va: 300, vg2: 150, vg: -3, ia: 30, gm: 11.7, ig2: 6.5 }] },
  { tube: "6P14P", kind: "pentode", mu: 20.7, source: "K&L 1981 p. 299 (6П14П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 250, vg2: 250, vg: -6.36, ia: 48, gm: 11.3, rp: 30, ig2: 5 }] },
  { tube: "6P15P", kind: "pentode", mu: 29.3, source: "K&L 1981 p. 302 (6П15П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 300, vg2: 150, vg: -2.42, ia: 30, gm: 15, rp: 100, ig2: 4.5 }] },
  { tube: "6P18P", kind: "pentode", mu: 13.6, source: "K&L 1981 p. 304 (6П18П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 180, vg2: 180, vg: -6.71, ia: 53, gm: 11, ig2: 8 }] },
  { tube: "6P25B", kind: "pentode", mu: 6.47, source: "K&L 1981 p. 309 (6П25Б)", points: [
    { va: 110, vg2: 110, vg: -8, ia: 30, gm: 4.5 }] },
  { tube: "6P27S", kind: "pentode", mu: 10.3, source: "K&L 1981 p. 310 (6П27С)", points: [
    { va: 250, vg2: 265, vg: -13.5, ia: 100, gm: 11, rp: 15 }] },
  { tube: "6P30B", kind: "pentode", mu: 5.31, source: "K&L 1981 p. 311 (6П30Б, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 120, vg2: 120, vg: -12, ia: 35, gm: 4.45, ig2: 1.3 }] },
  { tube: "6P33P", kind: "pentode", mu: 7.74, source: "K&L 1981 p. 315 (6П33П)", points: [
    { va: 170, vg2: 170, vg: -12.5, ia: 70, gm: 10, rp: 25 }] },
  { tube: "6P36S", kind: "pentode", mu: 5.38, source: "K&L 1981 p. 319 (6П36С)", points: [
    { va: 100, vg2: 100, vg: -7, ia: 120, gm: 14, rp: 4.5 }] },
  { tube: "6P41S", kind: "pentode", mu: 6.09, source: "K&L 1981 p. 325 (6П41С, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 190, vg2: 190, vg: -20.6, ia: 66, gm: 8.4, rp: 12, ig2: 2.7 }] },
  { tube: "6P43P-E", kind: "pentode", mu: 7.52, source: "K&L 1981 p. 328 (6П43П-Е, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 185, vg2: 185, vg: -16.5, ia: 45, gm: 7.5, ig2: 3.6 }] },
  { tube: "6R5P", kind: "pentode", mu: 17.4, source: "K&L 1981 p. 336 (6Р5П)", points: [
    { va: 250, vg2: 250, vg: -9, ia: 24, gm: 6, ig2: 6 }] },
  { tube: "6F1P-T", kind: "triode", mu: 20, source: "K&L 1981 p. 352 (6Ф1П)", points: [
    { va: 100, vg: -2, ia: 13, gm: 5, rp: 4 }] },
  { tube: "6F1P-P", kind: "pentode", mu: 40.7, source: "K&L 1981 p. 352 (6Ф1П)", points: [
    { va: 170, vg2: 170, vg: -2, ia: 10, gm: 6.2, rp: 400 }] },
  { tube: "6F3P-T", kind: "triode", mu: 75, source: "K&L 1981 p. 355 (6Ф3П)", points: [
    { va: 170, vg: -1.5, ia: 2.5, gm: 2.5, rp: 30 }] },
  { tube: "6F3P-P", kind: "pentode", mu: 8.76, source: "K&L 1981 p. 355 (6Ф3П)", points: [
    { va: 170, vg2: 170, vg: -11.5, ia: 41, gm: 7, rp: 15 }] },
  { tube: "6F4P-T", kind: "triode", mu: 65, source: "K&L 1981 p. 358 (6Ф4П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 200, vg: -1.71, ia: 3, gm: 4, rp: 16.2 }] },
  { tube: "6F4P-P", kind: "pentode", mu: 37.7, source: "K&L 1981 p. 358 (6Ф4П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 200, vg2: 200, vg: -2.97, ia: 18, gm: 10.4, rp: 130, ig2: 3.2 }] },
  { tube: "6F5P-T", kind: "triode", mu: 70, source: "K&L 1981 p. 360 (6Ф5П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 100, vg: -0.832, ia: 5.2, gm: 7, rp: 10 }] },
  { tube: "6F5P-P", kind: "pentode", mu: 8.3, source: "K&L 1981 p. 360 (6Ф5П, rated point; Vg1 = −Ik·Rk)", points: [
    { va: 185, vg2: 185, vg: -14.9, ia: 41, gm: 7.5, ig2: 2.7 }] },
  { tube: "6P14P-EV", alias: "6P14P", source: "K&L 1981 p. 299 (6П14П-ЕВ, same rated point as 6П14П)" },
  // ---- tubes not in K&L 1981: maker datasheets ----
  // ---- small-signal triodes ------------------------------------------------
  { tube: "12AX7", kind: "triode", mu: 100, source: "RCA 12AX7A", points: [
    { va: 100, vg: -1, ia: 0.5, gm: 1.25, rp: 80 },
    { va: 250, vg: -2, ia: 1.2, gm: 1.6, rp: 62.5 }] },
  
  { tube: "6SL7GT", kind: "triode", mu: 70, source: "RCA 6SL7GT", points: [
    { va: 250, vg: -2, ia: 2.3, gm: 1.6, rp: 44 }] },
  
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
  
  
  
  
  
  
  
  
  { tube: "WE417A", kind: "triode", mu: 43, source: "WE 417A / 5842 (25 mA, 25 mA/V, µ 43 at 150 V)", points: [
    { va: 150, vg: null, ia: 25, gm: 25, rp: 1.72 }] },
  
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
  
  // ---- pentodes / beam tetrodes (single tube, class A1) ---------------------
  { tube: "EL84", kind: "pentode", mu: 19, source: "Philips EL84", points: [
    { va: 250, vg2: 250, vg: -7.3, ia: 48, ig2: 5.5, gm: 11.3, rp: 38 }],
    // single-ended class A at full drive (cathode bias; B+ includes the 7.2 V cathode rise)
    largeSignal: [{ b: 257, rk: 135, rl: 5200, vrms: 4.3, pout: 5.7, thd: 10, ia: 49.5, ig2: 10.8 }] },
  
  
  
  { tube: "EL34", kind: "pentode", mu: 11, source: "Philips EL34", points: [
    { va: 250, vg2: 250, vg: -13.5, ia: 100, ig2: 14.9, gm: 11, rp: 15 }] },
  
  { tube: "6V6GT", kind: "pentode", mu: 9.8, source: "RCA 6V6GT", points: [
    { va: 250, vg2: 250, vg: -12.5, ia: 45, ig2: 4.5, gm: 4.1, rp: 52 },
    { va: 315, vg2: 225, vg: -13, ia: 34, ig2: 2.2, gm: 3.75, rp: 77 }],
    largeSignal: [
      { b: 250, vg2: 250, bias: -12.5, rl: 5000, vrms: 12.5 / Math.SQRT2, pout: 4.5, thd: 8, ia: 47, ig2: 7.0 },
      { b: 315, vg2: 225, bias: -13, rl: 8500, vrms: 13 / Math.SQRT2, pout: 5.5, thd: 12, ia: 35, ig2: 6.0 }] },
  
  
  { tube: "6L6GC", kind: "pentode", mu: 8, source: "RCA 6L6GC", points: [
    { va: 250, vg2: 250, vg: -14, ia: 72, ig2: 5, gm: 6.0, rp: 22.5 },
    { va: 350, vg2: 250, vg: -18, ia: 54, ig2: 2.5, gm: 5.2, rp: 33 }],
    largeSignal: [{ b: 250, vg2: 250, bias: -14, rl: 2500, vrms: 14 / Math.SQRT2, pout: 6.5, thd: 10 }] },
  
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
