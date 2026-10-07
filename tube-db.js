/* =============================================================================
   VACUUM TUBE DATABASE — single source of truth for every window
   (curve tracer, circuit CAD). Koren model parameters per operating mode,
   ratings and socket pinouts.
   ============================================================================= */
var TUBE_DATABASE = [
  // ---------------- Small Signal Soviet (GOST) ----------------
  {
    nameGost: "6Н2П / 6Н2П-ЕВ", nameWestern: "6N2P-EV / 6CC41", commonName: "6N2P-EV",
    type: "Dual High-Mu Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.34,
    book: {"source": "Katsnelson & Larionov 1981", "page": 140, "name": "6Н2П", "purpose": "LF voltage amplifier", "variants": ["6Н2П-ЕВ", "6Н2П-ЕР"], "analogs": ["6CC41"], "limits": {"va": 300, "vkh": 100, "ik": 10, "pa": 1.0, "rg": 0.5}, "nominal": {"va": 250, "vg": -1.5, "ia": 1.8, "gm": 2.25, "rp": 43.3}},
    heaterWarning: "CRITICAL PINOUT HAZARD: Pin 9 is an Electrostatic Shield (GND)! Heater is 6.3V STRICTLY on Pins 4 & 5. NEVER wire to 12AX7 12.6V supply or pin 9 center-tap!",
    hasPin9Shield: true,
    vaMax: 300, paMax: 1, ikMax: 10, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 102.5, kg: 1085, kp: 609.5, kvb: 455.9, x: 1.35 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true },
      { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 4, sym: "H", role: "Heater (6.3V)", isHeater: true },
      { pin: 5, sym: "H", role: "Heater (6.3V)", isHeater: true },
      { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true },
      { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Internal Shield (GND ONLY)", isShield: true }
    ]
  },
  {
    nameGost: "6Н1П / 6Н1П-ВИ", nameWestern: "6N1P-VI", commonName: "6N1P-VI",
    type: "Dual Medium-Mu Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.6,
    book: {"source": "Katsnelson & Larionov 1981", "page": 137, "name": "6Н1П", "purpose": "LF voltage amplifier", "variants": ["6Н1П-ВИ", "6Н1П-ЕВ"], "limits": {"va": 300, "va_cutoff": 470, "vkh": 100, "ik": 25, "pa": 2.2, "rg": 1.0}, "nominal": {"va": 250, "vg": -4.5, "vg_from_rk": 600, "ia": 7.5, "gm": 4.5, "rp": 7.78}},
    heaterWarning: "Pins 4 & 5: 6.3V @ 0.6A. Pin 9 is internal shield. Ensure filament supply can deliver 600mA!",
    hasPin9Shield: true,
    vaMax: 300, paMax: 2.2, ikMax: 25, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 36.95, kg: 872.5, kp: 378.4, kvb: 174.7, x: 1.43 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Internal Shield", isShield: true }
    ]
  },
  {
    nameGost: "6Н23П / 6Н23П-ЕВ", nameWestern: "6N23P-EV / ECC88", commonName: "6N23P-EV",
    type: "Dual Frame-Grid Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.31,
    book: {"source": "Katsnelson & Larionov 1981", "page": 164, "name": "6Н23П", "purpose": "wideband HF amplifier, LF, pulse", "variants": ["6Н23П-ЕВ"], "analogs": ["ECC88"], "limits": {"va": 300, "va_cutoff": 470, "vkh": 150, "ik": 20, "pa": 2.0, "rg": 1.0}, "nominal": {"va": 90, "vg": -1.23, "vg_from_rk": 82, "ia": 15, "gm": 12.5, "rp": 2.6}},
    heaterWarning: "Pins 4 & 5: 6.3V. Pin 9: Internal Shield (GND).",
    hasPin9Shield: true,
    vaMax: 300, paMax: 2, ikMax: 20, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 32.96, kg: 233.6, kp: 205.6, kvb: 161.1, x: 1.32 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Shield", isShield: true }
    ]
  },
  {
    nameGost: "6Н6П", nameWestern: "6N6P", commonName: "6N6P",
    type: "Dual Power Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.75,
    book: {"source": "Katsnelson & Larionov 1981", "page": 146, "name": "6Н6П", "purpose": "LF power amplifier, pulse", "variants": ["6Н6П-И"], "limits": {"va": 300, "va_cutoff": 450, "vkh": 200, "ik": 45, "pa": 4.8, "rg": 1.0}, "nominal": {"va": 120, "vg": -2, "ia": 30, "gm": 11, "rp": 1.82}},
    heaterWarning: "HEAVY HEATER: 0.75A @ 6.3V (Pins 4-5). Pin 9 is shield.",
    hasPin9Shield: true,
    vaMax: 300, paMax: 4.8, ikMax: 45, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 20.5, kg: 459, kp: 160.8, kvb: 107.6, x: 1.43 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Shield", isShield: true }
    ]
  },
  {
    nameGost: "6Н8С", nameWestern: "6N8S", commonName: "6N8S",
    type: "Dual Octal Triode", category: "small_signal", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.6,
    book: {"source": "Katsnelson & Larionov 1981", "page": 149, "name": "6Н8С", "purpose": "LF voltage amplifier, relaxation circuits", "limits": {"va": 330, "vkh": 100, "ik": 20, "pa": 2.75, "rg": 0.5}, "nominal": {"va": 250, "vg": -8, "ia": 9, "gm": 3, "rp": 7.17}},
    heaterWarning: "Octal Pins 7 & 8: 6.3V @ 0.6A.",
    vaMax: 330, paMax: 2.75, ikMax: 20, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 22.4, kg: 1150, kp: 149.6, kvb: 1121, x: 1.32 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  {
    nameGost: "6С45П", nameWestern: "6S45P", commonName: "6S45P",
    type: "Single High-Gm Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.44,
    book: {"source": "Katsnelson & Larionov 1981", "page": 117, "name": "6С45П-Е", "purpose": "HF voltage amplifier (wideband)", "limits": {"va": 150, "vkh": 100, "ik": 52, "pa": 7.8, "rg": 0.15}, "nominal": {"va": 150, "vg": -1.2, "vg_from_rk": 30, "ia": 40, "gm": 45, "rp": 1.16}},
    heaterWarning: "Extremely high Gm (45mA/V). Requires grid stopper resistor to prevent VHF oscillation!",
    vaMax: 150, paMax: 7.8, ikMax: 52, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 57.11, kg: 89.47, kp: 449.1, kvb: 75.76, x: 1.64 } },
    pinout: [
      { pin: 1, sym: "A", role: "Plate", isPlate: true }, { pin: 2, sym: "G", role: "Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A", role: "Plate", isPlate: true },
      { pin: 7, sym: "K", role: "Cathode", isCathode: true }, { pin: 8, sym: "G", role: "Grid", isGrid: true },
      { pin: 9, sym: "A", role: "Plate", isPlate: true }
    ]
  },
  // ---------------- Small Signal Western ----------------
  {
    nameGost: "12AX7 / ECC83", nameWestern: "12AX7 / ECC83 / 7025", commonName: "12AX7",
    type: "Dual High-Mu Triode", category: "small_signal", origin: "Western", socket: "Noval B9A", pinCount: 9,
    vh: 12.6, ih: 0.15,
    heaterWarning: "Dual Heater: Pins 4-5 = 12.6V @ 0.15A. Pin 9 = Center Tap (Connect 4+5 to 6.3V, Pin 9 to 0V for 6.3V @ 0.3A).",
    hasPin9CenterTap: true,
    vaMax: 300, paMax: 1.0, ikMax: 8, vg2Max: 0,
    isFavorite: false,
    koren: { Triode: { mu: 121.4, kg: 694.4, kp: 511.6, kvb: 10140, x: 1.1 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H1", role: "Heater 1", isHeater: true },
      { pin: 5, sym: "H2", role: "Heater 2", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "CT", role: "Heater Center Tap (12.6V / 6.3V)", isHeater: true }
    ]
  },
  {
    nameGost: "12AU7 / ECC82", nameWestern: "12AU7 / ECC82 / 5814A", commonName: "12AU7",
    type: "Dual Medium-Mu Triode", category: "small_signal", origin: "Western", socket: "Noval B9A", pinCount: 9,
    vh: 12.6, ih: 0.15,
    heaterWarning: "Dual Heater: 12.6V (4-5) or 6.3V (4+5 and 9).",
    hasPin9CenterTap: true,
    vaMax: 330, paMax: 2.75, ikMax: 20, vg2Max: 0,
    isFavorite: false,
    koren: { Triode: { mu: 22.02, kg: 1259, kp: 68.9, kvb: 493, x: 1.31 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H1", role: "Heater 1", isHeater: true },
      { pin: 5, sym: "H2", role: "Heater 2", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "CT", role: "Heater Center Tap", isHeater: true }
    ]
  },
  {
    nameGost: "6SN7-GT", nameWestern: "6SN7-GT / 5692", commonName: "6SN7GT",
    type: "Dual Octal Triode", category: "small_signal", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.60,
    heaterWarning: "Octal Pins 7 & 8: 6.3V @ 0.6A.",
    vaMax: 300, paMax: 2.5, ikMax: 20, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 22.01, kg: 1294, kp: 119.8, kvb: 1041, x: 1.32 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  // ---------------- Power Output Soviet (GOST) ----------------
  {
    nameGost: "6П14П", nameWestern: "6P14P / EL84", commonName: "6P14P",
    type: "Power Output Pentode", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.76,
    book: {"source": "Katsnelson & Larionov 1981", "page": 299, "name": "6П14П", "purpose": "LF output stages", "variants": ["6П14П-В", "6П14П-ЕВ", "6П14П-ЕР"], "analogs": ["EL84"], "limits": {"va": 300, "va_note": "400 V below 8 W", "vg2": 300, "vkh": 100, "ik": 65, "pa": 14, "pg2": 2.2, "rg": 1.0, "note": "EL84 column: Pa 12 W, Pg2 2 W"}, "nominal": {"va": 250, "vg2": 250, "vg": -6.36, "vg_from_rk": 120, "ia": 48, "gm": 11.3, "rp": 30, "ig2": 5}},
    heaterWarning: "Noval B9A. Pins 4 & 5: 6.3V @ 0.76A. Cathode–heater max 100 V. Envelope runs hot (>180°C) in Class A!",
    // 6П14П handbook limits: Pa 14 W, Pg2 2.2 W, Va 300 V above 8 W (400 V below), Ik 65 mA, Uk-h 100 V
    // (the Philips EL84 is rated 12 W)
    vaMax: 300, paMax: 14, ikMax: 65, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 20.7, kg: 530.9, kp: 255.6, lam: 1191, x: 1.35, kg2: 2105 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 20.7, kg: 530.9, kp: 255.6, lam: 1191, x: 1.35, kg2: 2105 },
      Triode: { mu: 19.81, kg: 568.1, kp: 5825, kvb: 18.77, x: 1.47 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "Internal Connection" }, { pin: 2, sym: "G1", role: "Control Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode & Grid 3", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "NC", role: "Internal Connection" },
      { pin: 7, sym: "A", role: "Plate / Anode", isPlate: true }, { pin: 8, sym: "NC", role: "Internal Connection" },
      { pin: 9, sym: "G2", role: "Screen Grid 2", isScreen: true }
    ]
  },
  {
    nameGost: "6П14П-ЕВ", nameWestern: "6P14P-EV (military, EL84 / 7189 Heavy Duty)", commonName: "6P14P-EV",
    type: "Power Output Pentode", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.76,
    heaterWarning: "Noval B9A. Pins 4 & 5: 6.3V @ 0.76A. Envelope runs hot (>180°C) in Class A!",
    // 6П14П-ЕВ handbook limits: Pa 14 W, Pg2 2 W, Va 300 V above 8 W (400 V below, 500 V cut off), Ik 65 mA, Uk-h 200 V
    vaMax: 400, paMax: 14.0, ikMax: 65, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 20.7, kg: 530.9, kp: 255.6, lam: 1191, x: 1.35, kg2: 2105 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 20.7, kg: 530.9, kp: 255.6, lam: 1191, x: 1.35, kg2: 2105 },
      Triode: { mu: 19.81, kg: 568.1, kp: 5825, kvb: 18.77, x: 1.47 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "Internal Connection" }, { pin: 2, sym: "G1", role: "Control Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode & Grid 3", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "NC", role: "Internal Connection" },
      { pin: 7, sym: "A", role: "Plate / Anode", isPlate: true }, { pin: 8, sym: "NC", role: "Internal Connection" },
      { pin: 9, sym: "G2", role: "Screen Grid 2", isScreen: true }
    ]
  },
  // 6Ф3П = ECL82 / 6BM8: a triode and an output pentode in one bulb. The two sections
  // are separate entries, drawn as VL1.1 and VL1.2. Limits: Philips ECL82 (1960).
  {
    nameGost: "6Ф3П (пентод)", nameWestern: "6F3P-P pentode section / ECL82", commonName: "6F3P-P",
    type: "Triode-Pentode, Pentode Section", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.81,
    book: {"source": "Katsnelson & Larionov 1981", "page": 355, "name": "6Ф3П", "purpose": "LF amplifiers and TV vertical sweep: triode = LF preamp, pentode = LF output", "analogs": ["ECL82"], "limits": {"va": 275, "va_on": 300, "vg2": 250, "vkh": 100, "ik": 60, "pa": 8, "pg2": 2.5, "rg": 1.0, "rg_fixed": 0.5, "note": "ECL82: Ua 300 V, Pa 7 W, Pg2 1.8 W, Ik 50 mA"}, "nominal": {"va": 170, "vg2": 170, "vg": -11.5, "ia": 41, "gm": 7, "rp": 15}},
    heaterWarning: "Noval B9A. Pins 4 & 5: 6.3V @ 0.78A (whole bulb). Pentode: Pa 7 W, Pg2 2 W, Ik 50 mA, cathode–heater 150 V.",
    vaMax: 275, paMax: 8, ikMax: 60, vg2Max: 250,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 8.801, kg: 1119, kp: 85.81, lam: 448.2, x: 1.36, kg2: 3160 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 8.801, kg: 1119, kp: 85.81, lam: 448.2, x: 1.36, kg2: 3160 },
      Triode: { mu: 8.046, kg: 1713, kp: 1783, kvb: 0.00001735, x: 1.62 }
    },
    pinout: [
      { pin: 1, sym: "GT", role: "Triode Grid", isGrid: true }, { pin: 2, sym: "G1", role: "Pentode Control Grid", isGrid: true },
      { pin: 3, sym: "KP", role: "Pentode Cathode, G3 & Shield", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "AP", role: "Pentode Plate", isPlate: true },
      { pin: 7, sym: "G2", role: "Pentode Screen Grid", isScreen: true }, { pin: 8, sym: "KT", role: "Triode Cathode", isCathode: true },
      { pin: 9, sym: "AT", role: "Triode Plate", isPlate: true }
    ]
  },
  {
    nameGost: "6Ф3П (триод)", nameWestern: "6F3P-T triode section / ECL82", commonName: "6F3P-T",
    type: "Triode-Pentode, Triode Section", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.81,
    book: {"source": "Katsnelson & Larionov 1981", "page": 355, "name": "6Ф3П", "purpose": "LF amplifiers and TV vertical sweep: triode = LF preamp, pentode = LF output", "analogs": ["ECL82"], "limits": {"va": 250, "vkh": 100, "ik": 15, "pa": 1.0, "rg": 3.0, "rg_fixed": 1.0, "note": "ECL82: Ua 300 V, Pa 0.5 W"}, "nominal": {"va": 170, "vg": -1.5, "ia": 2.5, "gm": 2.5, "rp": 30.0}},
    heaterWarning: "Noval B9A. Pins 4 & 5: 6.3V @ 0.78A (whole bulb). Triode: Pa 1 W, Ik 15 mA, cathode–heater 100 V.",
    vaMax: 250, paMax: 1, ikMax: 15, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 65.72, kg: 900.7, kp: 796.3, kvb: 526, x: 1.1 } },
    pinout: [
      { pin: 1, sym: "GT", role: "Triode Grid", isGrid: true }, { pin: 2, sym: "G1", role: "Pentode Control Grid", isGrid: true },
      { pin: 3, sym: "KP", role: "Pentode Cathode, G3 & Shield", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "AP", role: "Pentode Plate", isPlate: true },
      { pin: 7, sym: "G2", role: "Pentode Screen Grid", isScreen: true }, { pin: 8, sym: "KT", role: "Triode Cathode", isCathode: true },
      { pin: 9, sym: "AT", role: "Triode Plate", isPlate: true }
    ]
  },
  {
    nameGost: "6П3С / 6П3С-Е", nameWestern: "6P3S-E", commonName: "6P3S-E",
    type: "Beam Power Tetrode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.9,
    book: {"source": "Katsnelson & Larionov 1981", "page": 295, "name": "6П3С", "purpose": "LF output stages (beam tetrode)", "variants": ["6П3С-Е"], "limits": {"va": 250, "vg2": 250, "vkh": 90, "vkh_neg": 200, "ik": 90, "pa": 20.5, "pg2": 2.0, "rg": 0.15}, "nominal": {"va": 250, "vg2": 250, "vg": -14, "ia": 72, "gm": 6, "rp": 25}},
    heaterWarning: "Octal Pins 2 & 7: 6.3V @ 0.88A. Pin 3 is High-Voltage Plate!",
    vaMax: 250, paMax: 20.5, ikMax: 90, vg2Max: 250,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 8.362, kg: 1551, kp: 49.43, lam: 1553, x: 1.39, kg2: 5757 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 8.362, kg: 1551, kp: 49.43, lam: 1553, x: 1.39, kg2: 5757 },
      Triode: { mu: 7.906, kg: 1824, kp: 57.81, kvb: 4.306e-16, x: 1.49 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate (HV!)", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "6П27С", nameWestern: "6P27S / EL34", commonName: "6P27S",
    type: "Power Output Pentode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 1.5,
    book: {"source": "Katsnelson & Larionov 1981", "page": 310, "name": "6П27С", "purpose": "LF output stages (beam tetrode)", "analogs": ["EL34"], "limits": {"va": 800, "va_on": 2000, "vg2": 425, "ik": 150, "pa": 27.5, "pg2": 8, "rg": 0.25, "rg_fixed": 0.05}, "nominal": {"va": 250, "vg2": 265, "vg": -13.5, "ia": 100, "gm": 11, "rp": 15}},
    heaterWarning: "Heavy Heater: 1.5A @ 6.3V. Pin 1 is Grid 3 (must tie to cathode).",
    vaMax: 800, paMax: 27.5, ikMax: 150, vg2Max: 425,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 10.4, kg: 763, kp: 70.34, lam: 1252, x: 1.39, kg2: 2634 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 10.4, kg: 763, kp: 70.34, lam: 1252, x: 1.39, kg2: 2634 },
      Triode: { mu: 9.796, kg: 903.9, kp: 85.8, kvb: 0.0000236, x: 1.51 }
    },
    pinout: [
      { pin: 1, sym: "G3", role: "Suppressor Grid 3" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate (HV!)", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "ГУ-50", nameWestern: "GU-50 (Transmitter Pentode)", commonName: "GU-50",
    type: "Power Beam Pentode", category: "power", origin: "Soviet", socket: "Septar 8-pin Spec", pinCount: 8,
    vh: 12.6, ih: 0.70,
    heaterWarning: "HEATER IS 12.6V @ 0.7A (Pins 1 & 7)! Do NOT use 6.3V.",
    vaMax: 1000, paMax: 40.0, ikMax: 230, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 5.875, kg: 674.3, kp: 24.08, lam: 4241, x: 1.23, kg2: 674.3 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 5.875, kg: 674.3, kp: 24.08, lam: 4241, x: 1.23, kg2: 674.3 },
      Triode: { mu: 5.741, kg: 506, kp: 31.42, kvb: 6.897e-112, x: 1.27 }
    },
    pinout: [
      { pin: 1, sym: "H", role: "Heater 12.6V", isHeater: true }, { pin: 2, sym: "G1", role: "Control Grid", isGrid: true },
      { pin: 3, sym: "G2", role: "Screen Grid", isScreen: true }, { pin: 4, sym: "G3", role: "Suppressor Grid" },
      { pin: 5, sym: "A", role: "Plate", isPlate: true }, { pin: 6, sym: "K", role: "Cathode", isCathode: true },
      { pin: 7, sym: "H", role: "Heater 12.6V", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "6С4С", nameWestern: "6S4S (2A3 Octal DHT)", commonName: "6S4S",
    type: "Directly Heated Power Triode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 1.0,
    heaterWarning: "DIRECTLY HEATED: Filament IS Cathode! Requires isolated hum-balanced supply.",
    isDHT: true,
    vaMax: 360, paMax: 15.0, ikMax: 65, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 4.176, kg: 1243, kp: 66.96, kvb: 186.5, x: 1.34 } },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "F+", role: "Filament / Cathode (+)", isHeater: true, isCathode: true },
      { pin: 3, sym: "A", role: "Plate", isPlate: true }, { pin: 4, sym: "NC", role: "No Connection" },
      { pin: 5, sym: "G", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "F-", role: "Filament / Cathode (-)", isHeater: true, isCathode: true }, { pin: 8, sym: "NC", role: "No Connection" }
    ]
  },
  // ---------------- Power Output Western ----------------
  {
    nameGost: "EL84 / 6BQ5", nameWestern: "EL84 / 6BQ5 / 7189", commonName: "EL84",
    type: "Power Output Pentode", category: "power", origin: "Western", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.76,
    heaterWarning: "Pins 4 & 5: 6.3V @ 0.76A.",
    vaMax: 300, paMax: 12.0, ikMax: 65, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { vk: 31.41, ks: 1.077, mu: 19.1, kg: 531.3, kp: 255.8, lam: 1575, x: 1.37, kg2: 2001 },
      Ultralinear: { vk: 31.41, ks: 1.077, mu: 19.1, kg: 531.3, kp: 255.8, lam: 1575, x: 1.37, kg2: 2001 },
      Triode: { mu: 18.43, kg: 550.6, kp: 1260, kvb: 47.44, x: 1.47 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "G1", role: "Control Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode & G3", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "A", role: "Plate", isPlate: true }, { pin: 8, sym: "NC", role: "No Connection" },
      { pin: 9, sym: "G2", role: "Screen Grid", isScreen: true }
    ]
  },
  {
    nameGost: "EL34 / 6CA7", nameWestern: "EL34 / 6CA7", commonName: "EL34",
    type: "Power Output Pentode", category: "power", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 1.50,
    heaterWarning: "Heater draws 1.5A @ 6.3V (Pins 2 & 7).",
    vaMax: 800, paMax: 25.0, ikMax: 150, vg2Max: 425,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 11, kg: 555.5, kp: 43.98, lam: 1250, x: 1.35, kg2: 1348 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 11, kg: 555.5, kp: 43.98, lam: 1250, x: 1.35, kg2: 1348 },
      Triode: { mu: 10.34, kg: 618.3, kp: 47.78, kvb: 0.000008026, x: 1.47 }
    },
    pinout: [
      { pin: 1, sym: "G3", role: "Suppressor Grid 3" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "KT88 / 6550", nameWestern: "KT88 / 6550A", commonName: "KT88",
    type: "Kinkless Power Tetrode", category: "power", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 1.60,
    heaterWarning: "High current: 1.6A @ 6.3V. Plate voltage up to 800V.",
    vaMax: 800, paMax: 42.0, ikMax: 230, vg2Max: 600,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 8.024, kg: 780.2, kp: 67.6, lam: 1851, x: 1.36, kg2: 4000 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 8.024, kg: 780.2, kp: 67.6, lam: 1851, x: 1.36, kg2: 4000 },
      Triode: { mu: 7.71, kg: 900.5, kp: 80.05, kvb: 0.00001537, x: 1.45 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "Metal Base" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate (HV!)", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "300B", nameWestern: "300B (Western Electric Legend)", commonName: "300B",
    type: "Directly Heated Power Triode", category: "power", origin: "Western", socket: "UX4 4-pin", pinCount: 4,
    vh: 5.0, ih: 1.20,
    heaterWarning: "FILAMENT IS 5.0V @ 1.2A! Directly heated cathode. NEVER apply 6.3V!",
    isDHT: true,
    vaMax: 450, paMax: 40.0, ikMax: 100, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 3.988, kg: 1321, kp: 70.4, kvb: 160.1, x: 1.38 } },
    pinout: [
      { pin: 1, sym: "F+", role: "Filament / Cathode (+)", isHeater: true, isCathode: true },
      { pin: 2, sym: "A", role: "Plate (HV!)", isPlate: true },
      { pin: 3, sym: "G", role: "Control Grid", isGrid: true },
      { pin: 4, sym: "F-", role: "Filament / Cathode (-)", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Rectifiers ----------------
  {
    nameGost: "5Ц4С", nameWestern: "5Ts4S", commonName: "5Ts4S",
    type: "Full-Wave Vacuum Rectifier", category: "rectifier", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 5, ih: 2,
    book: {"source": "Katsnelson & Larionov 1981", "page": 73, "name": "5Ц4С", "purpose": "", "limits": {"v_inverse": 1350, "i_rect_ma": 62, "i_peak_ma": 375}, "test": {"ia_min": 300, "va": 50}, "rectified": {"ma_min": 122, "conditions": "Ua 500 V, Rn 4.7 kΩ, C 4 µF"}},
    heaterWarning: "Heater is 5.0V @ 2.0A (Pins 2 & 8). Cathode tied to Pin 8 (B+ output at HIGH VOLTAGE!).",
    vaMax: 500, paMax: 0, ikMax: 62, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 100, kp: 40, kvb: 10, x: 1.5 } },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater 5V", isHeater: true },
      { pin: 3, sym: "NC", role: "No Connection" }, { pin: 4, sym: "A1", role: "Anode 1 (AC IN)", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "A2", role: "Anode 2 (AC IN)", isPlate: true },
      { pin: 7, sym: "NC", role: "No Connection" }, { pin: 8, sym: "K_H", role: "Cathode / B+ OUT", isHeater: true, isCathode: true }
    ]
  },
  {
    nameGost: "5Ц3С", nameWestern: "5Ts3S", commonName: "5Ts3S",
    type: "Heavy Full-Wave Rectifier", category: "rectifier", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 5, ih: 3,
    book: {"source": "Katsnelson & Larionov 1981", "page": 72, "name": "5Ц3С", "purpose": "", "limits": {"v_inverse": 1700, "i_rect_ma": 250, "i_peak_ma": 750}, "test": {"ia_min": 225, "va": 75}, "rectified": {"ma_min": 230, "conditions": "Ua 500 V, Rn 2 kΩ, C 4 µF"}},
    heaterWarning: "Heavy 3.0A Filament @ 5.0V! Directly heated. B+ appears on Pins 2 & 8.",
    vaMax: 500, paMax: 0, ikMax: 250, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 80, kp: 30, kvb: 8, x: 1.5 } },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "F+", role: "Filament / B+ OUT", isHeater: true, isCathode: true },
      { pin: 3, sym: "NC", role: "No Connection" }, { pin: 4, sym: "A1", role: "Anode 1 (AC IN)", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "A2", role: "Anode 2 (AC IN)", isPlate: true },
      { pin: 7, sym: "NC", role: "No Connection" }, { pin: 8, sym: "F-", role: "Filament / B+ OUT", isHeater: true, isCathode: true }
    ]
  },
  {
    nameGost: "5AR4 / GZ34", nameWestern: "5AR4 / GZ34 (High Efficiency)", commonName: "GZ34",
    type: "Full-Wave Indirectly Heated Rectifier", category: "rectifier", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 5.0, ih: 1.9,
    heaterWarning: "5.0V @ 1.9A. Slow soft-start B+ ramp.",
    vaMax: 550, paMax: 0, ikMax: 250, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 65, kp: 25, kvb: 6, x: 1.5 } },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater 5V", isHeater: true },
      { pin: 3, sym: "NC", role: "No Connection" }, { pin: 4, sym: "A1", role: "Anode 1", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "A2", role: "Anode 2", isPlate: true },
      { pin: 7, sym: "NC", role: "No Connection" }, { pin: 8, sym: "K_H", role: "Cathode / B+ OUT", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Additional Small-Signal Soviet (GOST) ----------------
  {
    nameGost: "6Н9С", nameWestern: "6N9S", commonName: "6N9S",
    type: "Dual High-Mu Octal Triode", category: "small_signal", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.3, heaterWarning: "Octal Pins 7 & 8: 6.3V @ 0.3A.",
    book: {"source": "Katsnelson & Larionov 1981", "page": 150, "name": "6Н9С", "purpose": "LF voltage amplifier", "limits": {"va": 275, "vkh": 100, "pa": 1.1, "rg": 0.5}, "nominal": {"va": 250, "vg": -2, "ia": 2.3, "gm": 1.7, "rp": 41.2}},
    vaMax: 275, paMax: 1.1, ikMax: 0, vg2Max: 0,
    koren: { Triode: { mu: 70.03, kg: 1594, kp: 442.7, kvb: 509.3, x: 1.26 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  {
    nameGost: "6Н7С", nameWestern: "6N7S", commonName: "6N7S",
    type: "Dual Common-Cathode Triode", category: "small_signal", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.81, heaterWarning: "Heater 0.8A @ 6.3V (Pins 7 & 8). Common Cathode on Pin 8!",
    book: {"source": "Katsnelson & Larionov 1981", "page": 148, "name": "6Н7С", "purpose": "LF voltage amplifier", "limits": {"va": 300, "vkh": 100, "pa": 2.75, "pa_note": "5.5 W for the bulb"}, "nominal": {"va": 300, "vg": -6, "ia": 3.375, "gm": 1.7, "rp": 20.6}},
    vaMax: 300, paMax: 2.75, ikMax: 0, vg2Max: 0,
    koren: { Triode: { mu: 34.73, kg: 2184, kp: 806.2, kvb: 401, x: 1.34 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "G2", role: "Grid 2", isGrid: true }, { pin: 4, sym: "A2", role: "Plate 2", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K_H", role: "Cathode & Heater", isHeater: true, isCathode: true }
    ]
  },
  {
    nameGost: "6С3П / 6С4П", nameWestern: "6S3P", commonName: "6S3P",
    type: "Single High-Gm Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.3, heaterWarning: "Pins 4 & 5: 6.3V. Gm = 19.5 mA/V. Excellent phono input tube.",
    book: {"source": "Katsnelson & Larionov 1981", "page": 87, "name": "6С3П", "purpose": "HF voltage amplifier (grounded cathode)", "variants": ["6С3П-ЕВ", "6С3П-ДР"], "limits": {"va": 160, "va_cutoff": 330, "vg_neg": 100, "vkh": 100, "ik": 35, "pa": 3, "rg": 1.0}, "nominal": {"va": 150, "vg": -1.6, "vg_from_rk": 100, "ia": 16, "gm": 19.5, "rp": 2.56}},
    vaMax: 160, paMax: 3, ikMax: 35, vg2Max: 0,
    koren: { Triode: { mu: 53.7, kg: 164.5, kp: 476.6, kvb: 85.32, x: 1.51 } },
    pinout: [
      { pin: 1, sym: "A", role: "Plate", isPlate: true }, { pin: 2, sym: "G", role: "Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A", role: "Plate", isPlate: true },
      { pin: 7, sym: "K", role: "Cathode", isCathode: true }, { pin: 8, sym: "G", role: "Grid", isGrid: true },
      { pin: 9, sym: "NC", role: "Shield / NC" }
    ]
  },
  {
    nameGost: "6С19П", nameWestern: "6S19P", commonName: "6S19P",
    type: "Single Power Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 1, heaterWarning: "HEATER: 1.0A @ 6.3V (Pins 4 & 5). Internal Rp ~ 300 Ohms!",
    book: {"source": "Katsnelson & Larionov 1981", "page": 97, "name": "6С19П", "purpose": "series regulator in voltage stabilisers", "variants": ["6С19П-В", "6С19П-ВР"], "limits": {"va": 350, "va_on": 500, "vkh": 250, "ia": 140, "pa": 11, "pa_note": "11 W at Ua ≤ 200 V, 7 W above", "rg": 0.5}, "nominal": {"va": 110, "vg": -7, "ia": 95, "gm": 7.5, "rp": 0.4}},
    vaMax: 350, paMax: 11, ikMax: 140, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 3.649, kg: 5814, kp: 89.92, kvb: 79.57, x: 1.8 } },
    pinout: [
      { pin: 1, sym: "A", role: "Plate", isPlate: true }, { pin: 2, sym: "G", role: "Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A", role: "Plate", isPlate: true },
      { pin: 7, sym: "K", role: "Cathode", isCathode: true }, { pin: 8, sym: "G", role: "Grid", isGrid: true },
      { pin: 9, sym: "NC", role: "No Connection" }
    ]
  },
  // ---------------- Additional Small-Signal Western ----------------
  {
    nameGost: "12AT7 / ECC81", nameWestern: "12AT7 / ECC81 / 6201", commonName: "12AT7",
    type: "Dual High-Gm Triode", category: "small_signal", origin: "Western", socket: "Noval B9A", pinCount: 9,
    vh: 12.6, ih: 0.15, heaterWarning: "Pins 4-5: 12.6V, Pin 9: Center tap for 6.3V.",
    hasPin9CenterTap: true,
    vaMax: 300, paMax: 2.5, ikMax: 15, vg2Max: 0,
    koren: { Triode: { mu: 65.76, kg: 407.2, kp: 568.4, kvb: 7675, x: 1.13 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H1", role: "Heater 1", isHeater: true },
      { pin: 5, sym: "H2", role: "Heater 2", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "CT", role: "Heater Center Tap", isHeater: true }
    ]
  },
  {
    nameGost: "12AY7", nameWestern: "12AY7 / 6072", commonName: "12AY7",
    type: "Dual Audio Triode", category: "small_signal", origin: "Western", socket: "Noval B9A", pinCount: 9,
    vh: 12.6, ih: 0.15, heaterWarning: "Dual 12.6V / 6.3V heater system.",
    hasPin9CenterTap: true,
    vaMax: 300, paMax: 1.5, ikMax: 12, vg2Max: 0,
    koren: { Triode: { mu: 44.04, kg: 1411, kp: 266, kvb: 291.6, x: 1.23 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H1", role: "Heater 1", isHeater: true },
      { pin: 5, sym: "H2", role: "Heater 2", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "CT", role: "Center Tap", isHeater: true }
    ]
  },
  {
    nameGost: "6SL7-GT", nameWestern: "6SL7-GT (High-Mu Octal)", commonName: "6SL7GT",
    type: "Dual High-Mu Octal Triode", category: "small_signal", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.30, heaterWarning: "Octal pins 7 & 8: 6.3V @ 0.3A.",
    vaMax: 300, paMax: 1.0, ikMax: 8, vg2Max: 0,
    koren: { Triode: { mu: 68.98, kg: 1624, kp: 442.1, kvb: 478.8, x: 1.22 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  {
    nameGost: "WE417A / 5842", nameWestern: "WE417A / 5842 (Planar Triode)", commonName: "WE417A",
    type: "Single High-Gm Triode", category: "small_signal", origin: "Western", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.30, heaterWarning: "Pins 4 & 5: 6.3V. Western Electric gold grid planar triode.",
    vaMax: 200, paMax: 4.5, ikMax: 35, vg2Max: 0,
    koren: { Triode: { mu: 44.04, kg: 111.7, kp: 349.2, kvb: 100, x: 1.35 } },
    pinout: [
      { pin: 1, sym: "A", role: "Plate", isPlate: true }, { pin: 2, sym: "G", role: "Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A", role: "Plate", isPlate: true },
      { pin: 7, sym: "G", role: "Grid", isGrid: true }, { pin: 8, sym: "G", role: "Grid", isGrid: true },
      { pin: 9, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  // ---------------- Additional Power Soviet (GOST) ----------------
  {
    nameGost: "6П1П", nameWestern: "6P1P", commonName: "6P1P",
    type: "Beam Power Tetrode", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.5, heaterWarning: "Noval 9-pin equivalent of 6V6 / 6AQ5.",
    book: {"source": "Katsnelson & Larionov 1981", "page": 293, "name": "6П1П", "purpose": "LF output stages", "variants": ["6П1П-ЕВ"], "limits": {"va": 250, "vg2": 250, "vkh": 100, "ik": 70, "pa": 12, "pg2": 2.5, "rg": 0.5}, "nominal": {"va": 250, "vg2": 250, "vg": -12.5, "ia": 45, "gm": 4.9, "rp": 42.5}},
    vaMax: 250, paMax: 12, ikMax: 70, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 10.02, kg: 1565, kp: 133.8, lam: 1664, x: 1.36, kg2: 6014 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 10.02, kg: 1565, kp: 133.8, lam: 1664, x: 1.36, kg2: 6014 },
      Triode: { mu: 9.685, kg: 1713, kp: 8257, kvb: 13.95, x: 1.45 }
    },
    pinout: [
      { pin: 1, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 2, sym: "K", role: "Cathode", isCathode: true },
      { pin: 3, sym: "H", role: "Heater", isHeater: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "A", role: "Plate", isPlate: true }, { pin: 6, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 7, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 8, sym: "NC", role: "No Connection" },
      { pin: 9, sym: "NC", role: "No Connection" }
    ]
  },
  {
    nameGost: "6П6С", nameWestern: "6P6S", commonName: "6P6S",
    type: "Beam Power Tetrode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.475, heaterWarning: "Octal Pins 2 & 7: 6.3V @ 0.45A.",
    book: {"source": "Katsnelson & Larionov 1981", "page": 296, "name": "6П6С", "purpose": "LF output stages (beam tetrode)", "limits": {"va": 350, "vg2": 310, "vkh": 180, "pa": 13.2, "pg2": 2.2, "rg": 0.5, "rg_fixed": 0.1}, "nominal": {"va": 250, "vg2": 250, "vg": -12.5, "ia": 46, "gm": 4.1}},
    vaMax: 350, paMax: 13.2, ikMax: 0, vg2Max: 310,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 9.131, kg: 2137, kp: 52.56, lam: 2192, x: 1.4, kg2: 8535 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 9.131, kg: 2137, kp: 52.56, lam: 2192, x: 1.4, kg2: 8535 },
      Triode: { mu: 8.733, kg: 2362, kp: 60.27, kvb: 30.97, x: 1.48 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "6П45С", nameWestern: "6P45S (EL509 Heavy Beam Tetrode)", commonName: "6P45S",
    type: "Heavy Beam Tetrode", category: "power", origin: "Soviet", socket: "Magnoval B9D", pinCount: 9,
    vh: 6.3, ih: 2.50, heaterWarning: "HEAVY HEATER: 2.5A @ 6.3V. Anode top cap with up to 600V!",
    vaMax: 400, paMax: 35.0, ikMax: 500, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 5.5, kg: 149.3, kp: 30, lam: 1454, x: 1.35, kg2: 596.8 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 5.5, kg: 149.3, kp: 30, lam: 1454, x: 1.35, kg2: 596.8 },
      Triode: { mu: 5.187, kg: 188.9, kp: 33.45, kvb: 19.2, x: 1.46 }
    },
    pinout: [
      { pin: 1, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 2, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 3, sym: "K", role: "Cathode", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "K", role: "Cathode", isCathode: true },
      { pin: 7, sym: "G2", role: "Screen Grid", isScreen: true }, { pin: 8, sym: "G1", role: "Control Grid", isGrid: true },
      { pin: 9, sym: "NC", role: "Top Cap is Plate", isPlate: true }
    ]
  },
  {
    nameGost: "6С33С-В", nameWestern: "6S33S-V", commonName: "6S33S-V",
    type: "Giant Low-Rp Triode", category: "power", origin: "Soviet", socket: "Septar 7-pin Giant", pinCount: 7,
    vh: 12.6, ih: 3.2, heaterWarning: "EXTREME CURRENT: Dual heaters draw 6.6A @ 6.3V! Internal Rp ~ 80 Ohms.",
    book: {"source": "Katsnelson & Larionov 1981", "page": 106, "name": "6С33С", "purpose": "series regulator in voltage stabilisers", "variants": ["6С33С-В", "6С33С-ВР"], "limits": {"va": 250, "va_note": "250 V above 30 W, 450 V up to 30 W, 600 V at switch-on", "vg_neg": 150, "vkh": 300, "ia": 600, "ia_note": "350 mA one cathode, 600 mA both", "pa": 60, "pa_note": "45 W one cathode, 60 W both", "rg": 0.2}, "nominal": {"va": 120, "vg": -18.9, "vg_from_rk": 35, "ia": 540, "gm": 39, "rp": 0.1}},
    vaMax: 250, paMax: 60, ikMax: 600, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 3.509, kg: 75.59, kp: 43.45, kvb: 52.33, x: 1.1 } },
    pinout: [
      { pin: 1, sym: "H1", role: "Heater 1", isHeater: true }, { pin: 2, sym: "A", role: "Plate", isPlate: true },
      { pin: 3, sym: "G", role: "Grid", isGrid: true }, { pin: 4, sym: "K", role: "Cathode", isCathode: true },
      { pin: 5, sym: "G", role: "Grid", isGrid: true }, { pin: 6, sym: "A", role: "Plate", isPlate: true },
      { pin: 7, sym: "H2", role: "Heater 2", isHeater: true }
    ]
  },
  {
    nameGost: "ГМ-70", nameWestern: "GM-70 (Directly Heated Carbon Triode)", commonName: "GM-70",
    type: "Directly Heated Transmitter Triode", category: "power", origin: "Soviet", socket: "Special 4-pin", pinCount: 4,
    vh: 20.0, ih: 3.0, heaterWarning: "DANGER: High Voltage Plate up to 1000V! Filament is 20V @ 3.0A. Carbon graphite anode.",
    isDHT: true,
    vaMax: 1200, paMax: 125.0, ikMax: 200, vg2Max: 0,
    koren: { Triode: { mu: 6.171, kg: 1064, kp: 88.86, kvb: 220, x: 1.35 } },
    pinout: [
      { pin: 1, sym: "F+", role: "Filament (+)", isHeater: true, isCathode: true },
      { pin: 2, sym: "A", role: "Plate (1000V+)", isPlate: true },
      { pin: 3, sym: "G", role: "Control Grid", isGrid: true },
      { pin: 4, sym: "F-", role: "Filament (-)", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Additional Power Western ----------------
  {
    nameGost: "6V6-GT", nameWestern: "6V6-GT (Beam Power Tetrode)", commonName: "6V6GT",
    type: "Beam Power Tetrode", category: "power", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.45, heaterWarning: "Octal Pins 2 & 7: 6.3V @ 0.45A.",
    vaMax: 350, paMax: 14.0, ikMax: 60, vg2Max: 310,
    koren: {
      Pentode: { vk: 37.51, ks: 0.5649, mu: 10.64, kg: 2783, kp: 28.12, lam: 2192, x: 1.57, kg2: 10780 },
      Ultralinear: { vk: 37.51, ks: 0.5649, mu: 10.64, kg: 2783, kp: 28.12, lam: 2192, x: 1.57, kg2: 10780 },
      Triode: { mu: 10.42, kg: 3086, kp: 28.16, kvb: 28.28, x: 1.66 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "6L6-GC / 5881", nameWestern: "6L6-GC / 5881", commonName: "6L6GC",
    type: "Beam Power Tetrode", category: "power", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.90, heaterWarning: "Octal pins 2 & 7: 6.3V @ 0.9A.",
    vaMax: 500, paMax: 30.0, ikMax: 110, vg2Max: 450,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 8.798, kg: 3006, kp: 27.43, lam: 1398, x: 1.63, kg2: 16720 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 8.798, kg: 3006, kp: 27.43, lam: 1398, x: 1.63, kg2: 16720 },
      Triode: { mu: 8.127, kg: 4486, kp: 27.81, kvb: 1.513e-21, x: 1.78 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate (HV!)", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "2A3", nameWestern: "2A3 (Directly Heated Triode)", commonName: "2A3",
    type: "Directly Heated Power Triode", category: "power", origin: "Western", socket: "UX4 4-pin", pinCount: 4,
    vh: 2.5, ih: 2.5, heaterWarning: "FILAMENT IS 2.5V @ 2.5A! Directly heated cathode. Requires high-current low-voltage supply.",
    isDHT: true,
    vaMax: 300, paMax: 15.0, ikMax: 70, vg2Max: 0,
    koren: { Triode: { mu: 4.181, kg: 1237, kp: 64.06, kvb: 181.2, x: 1.34 } },
    pinout: [
      { pin: 1, sym: "F+", role: "Filament / Cathode (+)", isHeater: true, isCathode: true },
      { pin: 2, sym: "A", role: "Plate", isPlate: true },
      { pin: 3, sym: "G", role: "Control Grid", isGrid: true },
      { pin: 4, sym: "F-", role: "Filament / Cathode (-)", isHeater: true, isCathode: true }
    ]
  },
  {
    nameGost: "845", nameWestern: "845 (High-Voltage Power Triode)", commonName: "845",
    type: "Directly Heated Transmitter Triode", category: "power", origin: "Western", socket: "Special 4-pin", pinCount: 4,
    vh: 10.0, ih: 3.25, heaterWarning: "DANGER: Plate voltage up to 1000V-1200V! Filament is 10.0V @ 3.25A.",
    isDHT: true,
    vaMax: 1250, paMax: 100.0, ikMax: 150, vg2Max: 0,
    koren: { Triode: { mu: 5.633, kg: 2715, kp: 62.12, kvb: 239.6, x: 1.36 } },
    pinout: [
      { pin: 1, sym: "F+", role: "Filament (+)", isHeater: true, isCathode: true },
      { pin: 2, sym: "A", role: "Plate (1000V+)", isPlate: true },
      { pin: 3, sym: "G", role: "Control Grid", isGrid: true },
      { pin: 4, sym: "F-", role: "Filament (-)", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Additional Rectifiers ----------------
  {
    nameGost: "6Ц4П", nameWestern: "6Ts4P", commonName: "6Ts4P",
    type: "Full-Wave Miniature Rectifier", category: "rectifier", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.6, heaterWarning: "Noval 9-pin rectifier. 6.3V @ 0.6A.",
    book: {"source": "Katsnelson & Larionov 1981", "page": 75, "name": "6Ц4П", "purpose": "", "variants": ["6Ц4П-ЕВ"], "limits": {"v_inverse": 1000, "vkh": 100, "vkh_neg": 400, "i_rect_ma": 75, "i_peak_ma": 300}, "test": {"ia_min": 150, "va": 50}, "rectified": {"ma_min": 75, "conditions": "Ua 350 V, Rn 5.2 kΩ, C 8 µF"}},
    vaMax: 500, paMax: 0, ikMax: 75, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 120, kp: 45, kvb: 12, x: 1.5 } },
    pinout: [
      { pin: 1, sym: "A1", role: "Anode 1", isPlate: true }, { pin: 2, sym: "NC", role: "No Connection" },
      { pin: 3, sym: "K", role: "Cathode / B+ OUT", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A2", role: "Anode 2", isPlate: true },
      { pin: 7, sym: "NC", role: "No Connection" }, { pin: 8, sym: "NC", role: "No Connection" },
      { pin: 9, sym: "NC", role: "No Connection" }
    ]
  },
  {
    nameGost: "5U4-G", nameWestern: "5U4-G (Heavy Rectifier)", commonName: "5U4G",
    type: "Full-Wave Heavy Rectifier", category: "rectifier", origin: "Western", socket: "Octal K8A", pinCount: 8,
    vh: 5.0, ih: 3.0, heaterWarning: "Directly heated: 5.0V @ 3.0A. B+ appears on filament pins 2 & 8.",
    vaMax: 500, paMax: 0, ikMax: 225, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 80, kp: 30, kvb: 8, x: 1.5 } },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "F+", role: "Filament / B+ OUT", isHeater: true, isCathode: true },
      { pin: 3, sym: "NC", role: "No Connection" }, { pin: 4, sym: "A1", role: "Anode 1", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "A2", role: "Anode 2", isPlate: true },
      { pin: 7, sym: "NC", role: "No Connection" }, { pin: 8, sym: "F-", role: "Filament / B+ OUT", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Katsnelson & Larionov 1981: further receiving tubes ----------------
  {
    nameGost: "5Ц8С", nameWestern: "5Ts8S", commonName: "5Ts8S",
    type: "Rectifier — ", category: "rectifier", origin: "Soviet", socket: "None (fig. 9с)", pinCount: 9,
    vh: 5, ih: 5,
    book: {"source": "Katsnelson & Larionov 1981", "page": 74, "name": "5Ц8С", "purpose": "", "limits": {"v_inverse": 1700, "i_rect_ma": 420, "i_peak_ma": 1200, "pa_w": 30, "note": "peak current printed as 1.2 мА, evidently 1.2 A"}, "test": {"ia_min": 300, "va": 75}, "rectified": {"ma_min": 400, "conditions": "Ua 500 V, Rn 1 kΩ, C 4 µF"}},
    heaterWarning: "Heater 5.0 V @ 5 A. Ratings: K&L 1981 p. 74.",
    vaMax: 500, paMax: 0, ikMax: 420, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 100, kp: 40, kvb: 10, x: 1.5 } },
    pinout: []
  },
  {
    nameGost: "5Ц9С", nameWestern: "5Ts9S", commonName: "5Ts9S",
    type: "Rectifier — ", category: "rectifier", origin: "Soviet", socket: "None (fig. 8с)", pinCount: 0,
    vh: 5, ih: 3,
    book: {"source": "Katsnelson & Larionov 1981", "page": 74, "name": "5Ц9С", "purpose": "", "limits": {"v_inverse": 1700, "i_rect_ma": 205, "i_peak_ma": 600, "pa_w": 12}, "test": {"ia_min": 180, "va": 75}, "rectified": {"ma_min": 190, "conditions": "Ua 500 V, Rn 22 kΩ (as printed), C 4 µF"}},
    heaterWarning: "Heater 5.0 V @ 3 A. Ratings: K&L 1981 p. 74.",
    vaMax: 500, paMax: 0, ikMax: 205, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 100, kp: 40, kvb: 10, x: 1.5 } },
    pinout: []
  },
  {
    nameGost: "6Ц5С", nameWestern: "6Ts5S / EZ35", commonName: "6Ts5S",
    type: "Rectifier — ", category: "rectifier", origin: "Soviet", socket: "Octal", pinCount: 8,
    vh: 6.3, ih: 0.6,
    book: {"source": "Katsnelson & Larionov 1981", "page": 76, "name": "6Ц5С", "purpose": "", "analogs": ["EZ35"], "limits": {"v_inverse": 1100, "vkh_neg": 450, "i_rect_ma": 75}, "test": null, "rectified": {"ma_min": 70, "conditions": "Ua 400 V, Rn 5.7 kΩ, C 8 µF"}},
    heaterWarning: "Heater 6.3 V @ 0.6 A. Ratings: K&L 1981 p. 76.",
    vaMax: 500, paMax: 0, ikMax: 75, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 100, kp: 40, kvb: 10, x: 1.5 } },
    pinout: []
  },
  {
    nameGost: "6Ц13П", nameWestern: "6Ts13P", commonName: "6Ts13P",
    type: "Rectifier — ", category: "rectifier", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.95,
    book: {"source": "Katsnelson & Larionov 1981", "page": 77, "name": "6Ц13П", "purpose": "", "limits": {"v_inverse": 1600, "i_rect_ma": 120, "i_peak_ma": 900, "pa_w": 8}, "test": {"ia_min": 70, "va": 20}, "rectified": {"ma_min": 120, "conditions": "Utr 650 V, Rn 5 kΩ, C 4 µF"}},
    heaterWarning: "Heater 6.3 V @ 0.95 A. Ratings: K&L 1981 p. 77.",
    vaMax: 500, paMax: 0, ikMax: 120, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 100, kp: 40, kvb: 10, x: 1.5 } },
    pinout: []
  },
  {
    nameGost: "6С1П", nameWestern: "6S1P", commonName: "6S1P",
    type: "Triode — HF voltage amplifier", category: "small_signal", origin: "Soviet", socket: "Miniature B7G", pinCount: 7,
    vh: 6.3, ih: 0.15,
    book: {"source": "Katsnelson & Larionov 1981", "page": 81, "name": "6С1П", "purpose": "HF voltage amplifier", "limits": {"va": 275, "vkh": 90, "pa": 1.8}, "nominal": {"va": 250, "vg": -7, "ia": 6.1, "gm": 2.35, "rp": 11.6}},
    heaterWarning: "Heater 6.3 V @ 0.15 A. Cathode–heater max 90 V. Ratings: K&L 1981 p. 81.",
    vaMax: 275, paMax: 1.8, ikMax: 0, vg2Max: 0,
    koren: { Triode: { mu: 25.02, kg: 1245, kp: 277.9, kvb: 347.3, x: 1.19 } },
    pinout: []
  },
  {
    nameGost: "6С2С", nameWestern: "6S2S", commonName: "6S2S",
    type: "Triode — LF voltage amplifier", category: "small_signal", origin: "Soviet", socket: "Octal", pinCount: 8,
    vh: 6.3, ih: 0.3,
    book: {"source": "Katsnelson & Larionov 1981", "page": 85, "name": "6С2С", "purpose": "LF voltage amplifier", "limits": {"va": 330, "vg_max": 0, "vkh": 100, "ik": 20, "pa": 2.75}, "nominal": {"va": 250, "vg": -8, "ia": 9, "gm": 2.6, "rp": 7.88}},
    heaterWarning: "Heater 6.3 V @ 0.3 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 85.",
    vaMax: 330, paMax: 2.75, ikMax: 20, vg2Max: 0,
    koren: { Triode: { mu: 20.07, kg: 1576, kp: 270.4, kvb: 309, x: 1.3 } },
    pinout: []
  },
  {
    nameGost: "6С3Б", nameWestern: "6S3B", commonName: "6S3B",
    type: "Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.15,
    book: {"source": "Katsnelson & Larionov 1981", "page": 86, "name": "6С3Б", "purpose": "LF voltage amplifier (subminiature)", "limits": {"va": 300, "vkh": 100, "ik": 12, "pa": 2.5}, "nominal": {"va": 270, "vg": -12.8, "vg_from_rk": 1500, "ia": 8.5, "gm": 2.2, "rp": 6.36}},
    heaterWarning: "Heater 6.3 V @ 0.15 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 86.",
    vaMax: 300, paMax: 2.5, ikMax: 12, vg2Max: 0,
    koren: { Triode: { mu: 14.81, kg: 2715, kp: 239, kvb: 283, x: 1.44 } },
    pinout: []
  },
  {
    nameGost: "6С6Б", nameWestern: "6S6B", commonName: "6S6B",
    type: "Triode — LF voltage amplifier, HF oscillator (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.2,
    book: {"source": "Katsnelson & Larionov 1981", "page": 91, "name": "6С6Б", "purpose": "LF voltage amplifier, HF oscillator (subminiature)", "limits": {"va": 250, "vkh": 150, "ik": 14, "pa": 1.4}, "nominal": {"va": 120, "vg": -1.98, "vg_from_rk": 220, "ia": 9, "gm": 5, "rp": 5.0}},
    heaterWarning: "Heater 6.3 V @ 0.2 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 91.",
    vaMax: 250, paMax: 1.4, ikMax: 14, vg2Max: 0,
    koren: { Triode: { mu: 26.02, kg: 943.4, kp: 301.7, kvb: 263.6, x: 1.49 } },
    pinout: []
  },
  {
    nameGost: "6С7Б", nameWestern: "6S7B", commonName: "6S7B",
    type: "Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.2,
    book: {"source": "Katsnelson & Larionov 1981", "page": 93, "name": "6С7Б", "purpose": "LF voltage amplifier (subminiature)", "limits": {"va": 300, "vkh": 150, "ik": 7, "pa": 1.45, "rg": 1.0}, "nominal": {"va": 250, "vg": -1.8, "vg_from_rk": 400, "ia": 4.5, "gm": 4.0, "rp": 16.2}},
    heaterWarning: "Heater 6.3 V @ 0.2 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 93.",
    vaMax: 300, paMax: 1.45, ikMax: 7, vg2Max: 0,
    koren: { Triode: { mu: 70.64, kg: 1075, kp: 593.4, kvb: 278.6, x: 1.59 } },
    pinout: []
  },
  {
    nameGost: "6С15П", nameWestern: "6S15P", commonName: "6S15P",
    type: "Triode — HF voltage amplifier", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.44,
    book: {"source": "Katsnelson & Larionov 1981", "page": 95, "name": "6С15П", "purpose": "HF voltage amplifier", "variants": ["6С15П-Е"], "limits": {"va": 150, "vkh": 100, "ik": 52, "pa": 7.8, "rg": 0.15}, "nominal": {"va": 150, "vg": -1.2, "vg_from_rk": 30, "ia": 40, "gm": 45, "rp": 1.16}},
    heaterWarning: "Heater 6.3 V @ 0.44 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 95.",
    vaMax: 150, paMax: 7.8, ikMax: 52, vg2Max: 0,
    koren: { Triode: { mu: 57.01, kg: 90.38, kp: 494.6, kvb: 250.4, x: 1.65 } },
    pinout: []
  },
  {
    nameGost: "6С31Б", nameWestern: "6S31B", commonName: "6S31B",
    type: "Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.22,
    book: {"source": "Katsnelson & Larionov 1981", "page": 103, "name": "6С31Б", "purpose": "LF voltage amplifier (subminiature)", "variants": ["6С31Б-Р", "6С31Б-ЕР"], "limits": {"va": 100, "va_note": "180 V at Pa < 1.25 W", "vkh": 200, "ik": 60, "pa": 2.5, "rg": 1.0}, "nominal": {"va": 50, "vg": 0, "ia": 40, "gm": 18, "rp": 0.944}},
    heaterWarning: "Heater 6.3 V @ 0.22 A. Cathode–heater max 200 V. Ratings: K&L 1981 p. 103.",
    vaMax: 100, paMax: 2.5, ikMax: 60, vg2Max: 0,
    koren: { Triode: { mu: 17.82, kg: 197.8, kp: 252, kvb: 282.7, x: 1.33 } },
    pinout: []
  },
  {
    nameGost: "6С32Б", nameWestern: "6S32B", commonName: "6S32B",
    type: "Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.165,
    book: {"source": "Katsnelson & Larionov 1981", "page": 105, "name": "6С32Б", "purpose": "LF voltage amplifier (subminiature)", "limits": {"va": 250, "vkh": 160, "ik": 10, "pa": 1.5, "rg": 2.0}, "nominal": {"va": 200, "vg": -0.998, "vg_from_rk": 285, "ia": 3.5, "gm": 3.5, "rp": 28.6}},
    heaterWarning: "Heater 6.3 V @ 0.165 A. Cathode–heater max 160 V. Ratings: K&L 1981 p. 105.",
    vaMax: 250, paMax: 1.5, ikMax: 10, vg2Max: 0,
    koren: { Triode: { mu: 94.71, kg: 658.8, kp: 688.6, kvb: 337.1, x: 1.15 } },
    pinout: []
  },
  {
    nameGost: "6С34А", nameWestern: "6S34A", commonName: "6S34A",
    type: "Triode — LF voltage amplifier, HF oscillator (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.127,
    book: {"source": "Katsnelson & Larionov 1981", "page": 108, "name": "6С34А", "purpose": "LF voltage amplifier, HF oscillator (subminiature)", "variants": ["6С34А-В"], "limits": {"va": 200, "vkh": 150, "ik": 15, "pa": 1.1, "rg": 1.0}, "nominal": {"va": 100, "vg": -1.02, "vg_from_rk": 120, "ia": 8.5, "gm": 4.6, "rp": 5.43}},
    heaterWarning: "Heater 6.3 V @ 0.127 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 108.",
    vaMax: 200, paMax: 1.1, ikMax: 15, vg2Max: 0,
    koren: { Triode: { mu: 26.1, kg: 1161, kp: 300.5, kvb: 264.3, x: 1.54 } },
    pinout: []
  },
  {
    nameGost: "6С35А", nameWestern: "6S35A", commonName: "6S35A",
    type: "Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.127,
    book: {"source": "Katsnelson & Larionov 1981", "page": 110, "name": "6С35А", "purpose": "LF voltage amplifier (subminiature)", "variants": ["6С35А-В"], "limits": {"va": 300, "vkh": 150, "ik": 7, "pa": 0.9, "rg": 1.0}, "nominal": {"va": 200, "vg": -1.14, "vg_from_rk": 380, "ia": 3, "gm": 4, "rp": 17.5}},
    heaterWarning: "Heater 6.3 V @ 0.127 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 110.",
    vaMax: 300, paMax: 0.9, ikMax: 7, vg2Max: 0,
    koren: { Triode: { mu: 81.61, kg: 1077, kp: 662.6, kvb: 250, x: 1.8 } },
    pinout: []
  },
  {
    nameGost: "6С41С", nameWestern: "6S41S", commonName: "6S41S",
    type: "Triode — series regulator in voltage stabilisers", category: "power", origin: "Soviet", socket: "None (fig. 7с)", pinCount: 7,
    vh: 6.3, ih: 2.8,
    book: {"source": "Katsnelson & Larionov 1981", "page": 115, "name": "6С41С", "purpose": "series regulator in voltage stabilisers", "limits": {"va": 450, "va_on": 600, "vg_neg": 250, "vkh": 300, "ia": 310, "pa": 25, "rg": 0.2}, "nominal": {"va": 90, "vg": -9.6, "vg_from_rk": 40, "ia": 240, "gm": 19, "rp": 0.15}},
    heaterWarning: "Heater 6.3 V @ 2.8 A. Cathode–heater max 300 V. Ratings: K&L 1981 p. 115.",
    vaMax: 450, paMax: 25, ikMax: 310, vg2Max: 0,
    koren: { Triode: { mu: 3.032, kg: 1076, kp: 167.1, kvb: 235.4, x: 1.62 } },
    pinout: []
  },
  {
    nameGost: "6С46Г-В", nameWestern: "6S46G-V", commonName: "6S46G-V",
    type: "Triode — series regulator (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.5,
    book: {"source": "Katsnelson & Larionov 1981", "page": 119, "name": "6С46Г-В", "purpose": "series regulator (subminiature)", "limits": {"va": 250, "vkh": 150, "ik": 100, "pa": 4.5, "rg": 0.25}, "nominal": {"va": 42, "vg": -1, "ia": 60, "gm": 20, "rp": 0.35}},
    heaterWarning: "Heater 6.3 V @ 0.5 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 119.",
    vaMax: 250, paMax: 4.5, ikMax: 100, vg2Max: 0,
    koren: { Triode: { mu: 7.552, kg: 388.1, kp: 192, kvb: 200.9, x: 1.61 } },
    pinout: []
  },
  {
    nameGost: "6С51Н", nameWestern: "6S51N", commonName: "6S51N",
    type: "Triode — voltage amplifier, oscillator (nuvistor)", category: "small_signal", origin: "Soviet", socket: "Nuvistor", pinCount: 0,
    vh: 6.3, ih: 0.13,
    book: {"source": "Katsnelson & Larionov 1981", "page": 122, "name": "6С51Н", "purpose": "voltage amplifier, oscillator (nuvistor)", "variants": ["6С51Н-В"], "limits": {"va": 120, "vkh": 100, "ik": 15, "pa": 1.2, "rg": 1.0}, "nominal": {"va": 80, "vg": -1.3, "vg_from_rk": 130, "ia": 10, "gm": 11, "rp": 2.73}},
    heaterWarning: "Heater 6.3 V @ 0.13 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 122.",
    vaMax: 120, paMax: 1.2, ikMax: 15, vg2Max: 0,
    koren: { Triode: { mu: 31.16, kg: 289.2, kp: 334.8, kvb: 232.8, x: 1.46 } },
    pinout: []
  },
  {
    nameGost: "6С52Н", nameWestern: "6S52N", commonName: "6S52N",
    type: "Triode — voltage amplifier, oscillator (nuvistor)", category: "small_signal", origin: "Soviet", socket: "Nuvistor", pinCount: 0,
    vh: 6.3, ih: 0.13,
    book: {"source": "Katsnelson & Larionov 1981", "page": 124, "name": "6С52Н", "purpose": "voltage amplifier, oscillator (nuvistor)", "variants": ["6С52Н-В"], "limits": {"va": 120, "vkh": 100, "ik": 15, "pa": 1.2, "rg": 1.0}, "nominal": {"va": 120, "vg": -1.04, "vg_from_rk": 130, "ia": 8, "gm": 10, "rp": 6.0}},
    heaterWarning: "Heater 6.3 V @ 0.13 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 124.",
    vaMax: 120, paMax: 1.2, ikMax: 15, vg2Max: 0,
    koren: { Triode: { mu: 59.17, kg: 251.7, kp: 502.4, kvb: 334.8, x: 1.29 } },
    pinout: []
  },
  {
    nameGost: "6С56П", nameWestern: "6S56P", commonName: "6S56P",
    type: "Triode — series regulator in voltage stabilisers", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 1,
    book: {"source": "Katsnelson & Larionov 1981", "page": 127, "name": "6С56П", "purpose": "series regulator in voltage stabilisers", "limits": {"va": 350, "va_note": "350 V up to 7 W, 200 V above 7 W, 700 V at switch-on", "vg_neg": 250, "vkh": 250, "ia": 140, "pa": 11, "rg": 0.5}, "nominal": {"va": 110, "vg": -7, "ia": 95, "gm": 8.5, "rp": 0.35}},
    heaterWarning: "Heater 6.3 V @ 1 A. Cathode–heater max 250 V. Ratings: K&L 1981 p. 127.",
    vaMax: 350, paMax: 11, ikMax: 140, vg2Max: 0,
    koren: { Triode: { mu: 4.003, kg: 4595, kp: 167.8, kvb: 120.9, x: 1.8 } },
    pinout: []
  },
  {
    nameGost: "6С66П", nameWestern: "6S66P", commonName: "6S66P",
    type: "Triode — output stages, 0-20 MHz", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.9,
    book: {"source": "Katsnelson & Larionov 1981", "page": 136, "name": "6С66П", "purpose": "output stages, 0-20 MHz", "limits": {"va": 260, "va_cutoff": 500, "vg_neg": 100, "vkh": 500, "ik": 300, "pa": 16, "pa_note": "22 W for under 2 h, 16 W continuous", "rg": 0.1}, "nominal": {"va": 150, "vg": -9.0, "vg_from_rk": 120, "ia": 75, "gm": 24.5, "rp": 0.449}},
    heaterWarning: "Heater 6.3 V @ 0.9 A. Cathode–heater max 500 V. Ratings: K&L 1981 p. 136.",
    vaMax: 260, paMax: 16, ikMax: 300, vg2Max: 0,
    koren: { Triode: { mu: 11.36, kg: 205.3, kp: 216.9, kvb: 269.8, x: 1.41 } },
    pinout: []
  },
  {
    nameGost: "6Н3П", nameWestern: "6N3P / 6CC42", commonName: "6N3P",
    type: "Double Triode — voltage amplifier, HF oscillator", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.35,
    book: {"source": "Katsnelson & Larionov 1981", "page": 142, "name": "6Н3П", "purpose": "voltage amplifier, HF oscillator", "variants": ["6Н3П-И", "6Н3П-Е", "6Н3П-ДР"], "analogs": ["6CC42"], "limits": {"va": 300, "vkh": 100, "ik": 18, "pa": 1.5, "rg": 1.0}, "nominal": {"va": 150, "vg": -2, "ia": 8.75, "gm": 5.9, "rp": 5.76}},
    heaterWarning: "Heater 6.3 V @ 0.35 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 142.",
    vaMax: 300, paMax: 1.5, ikMax: 18, vg2Max: 0,
    koren: { Triode: { mu: 35.77, kg: 750.4, kp: 361.8, kvb: 267.1, x: 1.51 } },
    pinout: []
  },
  {
    nameGost: "6Н13С", nameWestern: "6N13S", commonName: "6N13S",
    type: "Double Triode — series regulator in voltage stabilisers", category: "power", origin: "Soviet", socket: "Octal", pinCount: 8,
    vh: 6.3, ih: 2.5,
    book: {"source": "Katsnelson & Larionov 1981", "page": 151, "name": "6Н13С", "purpose": "series regulator in voltage stabilisers", "limits": {"va": 250, "va_on": 500, "vkh": 300, "ia": 130, "pa": 13, "rg": 1.0}, "nominal": {"va": 90, "vg": -30, "ia": 80, "gm": 5.5, "rp": 0.46}},
    heaterWarning: "Heater 6.3 V @ 2.5 A. Cathode–heater max 300 V. Ratings: K&L 1981 p. 151.",
    vaMax: 250, paMax: 13, ikMax: 130, vg2Max: 0,
    koren: { Triode: { mu: 2.378, kg: 714.9, kp: 165.2, kvb: 5104, x: 1.26 } },
    pinout: []
  },
  {
    nameGost: "6Н15П", nameWestern: "6N15P / ECC91 / 6CC31", commonName: "6N15P",
    type: "Double Triode — LF voltage amplifier, HF oscillator (common cathode)", category: "small_signal", origin: "Soviet", socket: "Miniature B7G", pinCount: 7,
    vh: 6.3, ih: 0.45,
    book: {"source": "Katsnelson & Larionov 1981", "page": 154, "name": "6Н15П", "purpose": "LF voltage amplifier, HF oscillator (common cathode)", "analogs": ["ECC91", "6CC31"], "limits": {"va": 330, "vkh": 100, "pa": 1.6, "rg": 0.1}, "nominal": {"va": 100, "vg": -0.45, "vg_from_rk": 50, "ia": 9, "gm": 5.6, "rp": 6.79}},
    heaterWarning: "Heater 6.3 V @ 0.45 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 154.",
    vaMax: 330, paMax: 1.6, ikMax: 0, vg2Max: 0,
    koren: { Triode: { mu: 38.46, kg: 632.6, kp: 378.2, kvb: 297.7, x: 1.36 } },
    pinout: []
  },
  {
    nameGost: "6Н16Б", nameWestern: "6N16B", commonName: "6N16B",
    type: "Double Triode — LF voltage amplifier, HF oscillator (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.4,
    book: {"source": "Katsnelson & Larionov 1981", "page": 156, "name": "6Н16Б", "purpose": "LF voltage amplifier, HF oscillator (subminiature)", "variants": ["6Н16Б-В", "6Н16Б-ВИ", "6Н16Б-ВР", "6Н16Б-И", "6Н16Г-ВИР"], "limits": {"va": 200, "vkh": 150, "ik": 14, "pa": 0.9, "rg": 1.0}, "nominal": {"va": 100, "vg": -2.05, "vg_from_rk": 325, "ia": 6.3, "gm": 5, "rp": 5.0}},
    heaterWarning: "Heater 6.3 V @ 0.4 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 156.",
    vaMax: 200, paMax: 0.9, ikMax: 14, vg2Max: 0,
    koren: { Triode: { mu: 26.07, kg: 755.4, kp: 304.2, kvb: 242.6, x: 1.47 } },
    pinout: []
  },
  {
    nameGost: "6Н17Б", nameWestern: "6N17B", commonName: "6N17B",
    type: "Double Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.4,
    book: {"source": "Katsnelson & Larionov 1981", "page": 158, "name": "6Н17Б", "purpose": "LF voltage amplifier (subminiature)", "variants": ["6Н17Б-В", "6Н17Б-ВР"], "limits": {"va": 250, "vkh": 150, "ik": 10, "pa": 0.9, "rg": 1.0}, "nominal": {"va": 200, "vg": -1.07, "vg_from_rk": 325, "ia": 3.3, "gm": 3.8, "rp": 19.7}},
    heaterWarning: "Heater 6.3 V @ 0.4 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 158.",
    vaMax: 250, paMax: 0.9, ikMax: 10, vg2Max: 0,
    koren: { Triode: { mu: 81.34, kg: 1035, kp: 647.6, kvb: 272, x: 1.63 } },
    pinout: []
  },
  {
    nameGost: "6Н18Б", nameWestern: "6N18B", commonName: "6N18B",
    type: "Double Triode — LF voltage amplifier, HF oscillator (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.33,
    book: {"source": "Katsnelson & Larionov 1981", "page": 160, "name": "6Н18Б", "purpose": "LF voltage amplifier, HF oscillator (subminiature)", "variants": ["6Н18Б-В"], "limits": {"va": 200, "vkh": 150, "ik": 12, "pa": 0.9, "rg": 1.0}, "nominal": {"va": 100, "vg": -2.05, "vg_from_rk": 325, "ia": 6.3, "gm": 5, "rp": 4.6}},
    heaterWarning: "Heater 6.3 V @ 0.33 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 160.",
    vaMax: 200, paMax: 0.9, ikMax: 12, vg2Max: 0,
    koren: { Triode: { mu: 24.95, kg: 940.9, kp: 294.2, kvb: 210.5, x: 1.6 } },
    pinout: []
  },
  {
    nameGost: "6Н21Б", nameWestern: "6N21B", commonName: "6N21B",
    type: "Double Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.395,
    book: {"source": "Katsnelson & Larionov 1981", "page": 162, "name": "6Н21Б", "purpose": "LF voltage amplifier (subminiature)", "limits": {"va": 250, "vkh": 200, "ik": 10, "pa": 1.0, "rg": 2.0}, "nominal": {"va": 200, "vg": -1.16, "vg_from_rk": 330, "ia": 3.5, "gm": 3.8, "rp": 21.6}},
    heaterWarning: "Heater 6.3 V @ 0.395 A. Cathode–heater max 200 V. Ratings: K&L 1981 p. 162.",
    vaMax: 250, paMax: 1, ikMax: 10, vg2Max: 0,
    koren: { Triode: { mu: 83.62, kg: 768.5, kp: 658.1, kvb: 296.2, x: 1.38 } },
    pinout: []
  },
  {
    nameGost: "6Н28Б-В", nameWestern: "6N28B-V", commonName: "6N28B-V",
    type: "Double Triode — LF voltage amplifier, oscillator (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.247,
    book: {"source": "Katsnelson & Larionov 1981", "page": 172, "name": "6Н28Б-В", "purpose": "LF voltage amplifier, oscillator (subminiature)", "limits": {"va": 150, "vkh": 150, "ik": 10, "pa": 0.9, "rg": 2.0}, "nominal": {"va": 50, "vg": -1, "ia": 7, "gm": 6.75, "rp": 3.26}},
    heaterWarning: "Heater 6.3 V @ 0.247 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 172.",
    vaMax: 150, paMax: 0.9, ikMax: 10, vg2Max: 0,
    koren: { Triode: { mu: 22.19, kg: 410.7, kp: 282.2, kvb: 313.6, x: 1.34 } },
    pinout: []
  },
  {
    nameGost: "6Н30П-ДР", nameWestern: "6N30P-DR", commonName: "6N30P-DR",
    type: "Double Triode — pulse circuits", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.825,
    book: {"source": "Katsnelson & Larionov 1981", "page": 174, "name": "6Н30П-ДР", "purpose": "pulse circuits", "limits": {"va": 250, "va_cutoff": 1050, "vkh": 400, "ik": 100, "pa": 4.0, "rg": 0.3}, "nominal": {"va": 80, "vg": -2.24, "vg_from_rk": 56, "ia": 40, "gm": 18, "rp": 0.833}},
    heaterWarning: "Heater 6.3 V @ 0.825 A. Cathode–heater max 400 V. Ratings: K&L 1981 p. 174.",
    vaMax: 250, paMax: 4, ikMax: 100, vg2Max: 0,
    koren: { Triode: { mu: 15.26, kg: 237.9, kp: 240.1, kvb: 269.9, x: 1.4 } },
    pinout: []
  },
  {
    nameGost: "6Н33Б", nameWestern: "6N33B", commonName: "6N33B",
    type: "Double Triode — LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.395,
    book: {"source": "Katsnelson & Larionov 1981", "page": 178, "name": "6Н33Б", "purpose": "LF voltage amplifier (subminiature)", "limits": {"va": 200, "vkh": 200, "ik": 6, "pa": 1.0, "rg": 2.0}, "nominal": {"va": 100, "vg": -1.35, "vg_from_rk": 1500, "ia": 0.9, "gm": 2, "rp": 35.0}},
    heaterWarning: "Heater 6.3 V @ 0.395 A. Cathode–heater max 200 V. Ratings: K&L 1981 p. 178.",
    vaMax: 200, paMax: 1, ikMax: 6, vg2Max: 0,
    koren: { Triode: { mu: 67.88, kg: 698.9, kp: 479.5, kvb: 5006, x: 1.28 } },
    pinout: []
  },
  {
    nameGost: "6Э5П", nameWestern: "6E5P", commonName: "6E5P",
    type: "Pentode / Beam Tetrode — wideband HF output stages, pulse (6Э5П-И)", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.6,
    book: {"source": "Katsnelson & Larionov 1981", "page": 180, "name": "6Э5П", "purpose": "wideband HF output stages, pulse (6Э5П-И)", "variants": ["6Э5П-И"], "limits": {"va": 250, "va_cutoff": 470, "vg2": 250, "vkh": 100, "ik": 100, "pa": 8.3, "pg2": 2.3, "rg": 0.5}, "nominal": {"va": 150, "vg2": 150, "vg": -1.44, "vg_from_rk": 30, "ia": 43, "gm": 30.5, "rp": 8}},
    heaterWarning: "Heater 6.3 V @ 0.6 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 180.",
    vaMax: 250, paMax: 8.3, ikMax: 100, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 45.4, kg: 199.1, kp: 236.5, lam: 200.3, x: 1.41, kg2: 388.9 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 45.4, kg: 199.1, kp: 236.5, lam: 200.3, x: 1.41, kg2: 388.9 },
      Triode: { mu: 40.96, kg: 188.1, kp: 139.1, kvb: 1.714e-30, x: 1.8 }
    },
    pinout: []
  },
  {
    nameGost: "6Э6П-Е", nameWestern: "6E6P-E", commonName: "6E6P-E",
    type: "Pentode / Beam Tetrode — wideband HF output stages", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.61,
    book: {"source": "Katsnelson & Larionov 1981", "page": 182, "name": "6Э6П-Е", "purpose": "wideband HF output stages", "variants": ["6Э6П-ДР"], "limits": {"va": 150, "va_cutoff": 285, "vg2": 150, "vkh": 100, "ik": 70, "pa": 8.25, "pg2": 2.1}, "nominal": {"va": 150, "vg2": 150, "vg": -1.62, "vg_from_rk": 30, "ia": 44, "gm": 29.5, "rp": 15, "ig2": 10}},
    heaterWarning: "Heater 6.3 V @ 0.61 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 182.",
    vaMax: 150, paMax: 8.25, ikMax: 70, vg2Max: 150,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 41.77, kg: 154.8, kp: 226.1, lam: 523, x: 1.4, kg2: 259.5 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 41.77, kg: 154.8, kp: 226.1, lam: 523, x: 1.4, kg2: 259.5 },
      Triode: { mu: 50.04, kg: 97.82, kp: 104.7, kvb: 56.55, x: 1.56 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж1П", nameWestern: "6Zh1P / EF95 / 6F32", commonName: "6Zh1P",
    type: "Pentode / Beam Tetrode — HF voltage amplifier", category: "small_signal", origin: "Soviet", socket: "Miniature B7G", pinCount: 7,
    vh: 6.3, ih: 0.17,
    book: {"source": "Katsnelson & Larionov 1981", "page": 203, "name": "6Ж1П", "purpose": "HF voltage amplifier", "variants": ["6Ж1П-ЕВ", "6Ж1П-ЕР"], "analogs": ["EF95", "6F32"], "limits": {"va": 200, "va_cutoff": 225, "vg2": 150, "vkh": 120, "ik": 20, "pa": 1.8, "pg2": 0.55, "rg": 1.0}, "nominal": {"va": 120, "vg2": 120, "vg": -1.65, "vg_from_rk": 200, "ia": 7.35, "gm": 5.15, "rp": 300}},
    heaterWarning: "Heater 6.3 V @ 0.17 A. Cathode–heater max 120 V. Ratings: K&L 1981 p. 203.",
    vaMax: 200, paMax: 1.8, ikMax: 20, vg2Max: 150,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 33.95, kg: 699.4, kp: 194.9, lam: 2859, x: 1.4, kg2: 3160 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 33.95, kg: 699.4, kp: 194.9, lam: 2859, x: 1.4, kg2: 3160 },
      Triode: { mu: 32.92, kg: 673.5, kp: 218.4, kvb: 0.00001659, x: 1.45 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж3П", nameWestern: "6Zh3P / EF96", commonName: "6Zh3P",
    type: "Pentode / Beam Tetrode — HF voltage amplifier (beam tetrode)", category: "small_signal", origin: "Soviet", socket: "Miniature B7G", pinCount: 7,
    vh: 6.3, ih: 0.3,
    book: {"source": "Katsnelson & Larionov 1981", "page": 210, "name": "6Ж3П", "purpose": "HF voltage amplifier (beam tetrode)", "variants": ["6Ж3П-Е"], "analogs": ["EF96"], "limits": {"va": 330, "vg2": 165, "vkh": 100, "pa": 2.5, "pg2": 0.55, "rg": 0.1}, "nominal": {"va": 250, "vg2": 150, "vg": -1.8, "vg_from_rk": 200, "ia": 7, "gm": 5, "rp": 800, "ig2": 2}},
    heaterWarning: "Heater 6.3 V @ 0.3 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 210.",
    vaMax: 330, paMax: 2.5, ikMax: 0, vg2Max: 165,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 41.2, kg: 721.8, kp: 237.2, lam: 5345, x: 1.4, kg2: 1178 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 41.2, kg: 721.8, kp: 237.2, lam: 5345, x: 1.4, kg2: 1178 },
      Triode: { mu: 40.09, kg: 580, kp: 27250000, kvb: 0.00002583, x: 1.42 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж4", nameWestern: "6Zh4 / 6F10", commonName: "6Zh4",
    type: "Pentode / Beam Tetrode — HF and IF voltage amplifier (metal)", category: "small_signal", origin: "Soviet", socket: "Octal", pinCount: 8,
    vh: 6.3, ih: 0.45,
    book: {"source": "Katsnelson & Larionov 1981", "page": 212, "name": "6Ж4", "purpose": "HF and IF voltage amplifier (metal)", "variants": ["6Ж4-В"], "analogs": ["6F10"], "limits": {"va": 330, "vg2": 165, "vkh": 100, "pa": 3.3, "pg2": 0.45, "rg": 0.5}, "nominal": {"va": 300, "vg2": 150, "vg": -1.99, "vg_from_rk": 160, "ia": 10.25, "gm": 9, "ig2": 2.2}},
    heaterWarning: "Heater 6.3 V @ 0.45 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 212.",
    vaMax: 330, paMax: 3.3, ikMax: 0, vg2Max: 165,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 43.14, kg: 421.1, kp: 279.6, lam: 1500, x: 1.41, kg2: 794.6 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 43.14, kg: 421.1, kp: 279.6, lam: 1500, x: 1.41, kg2: 794.6 },
      Triode: { mu: 41.36, kg: 358, kp: 393.7, kvb: 19.62, x: 1.48 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж4П", nameWestern: "6Zh4P / EF94", commonName: "6Zh4P",
    type: "Pentode / Beam Tetrode — HF voltage amplifier", category: "small_signal", origin: "Soviet", socket: "Miniature B7G", pinCount: 7,
    vh: 6.3, ih: 0.3,
    book: {"source": "Katsnelson & Larionov 1981", "page": 213, "name": "6Ж4П", "purpose": "HF voltage amplifier", "analogs": ["EF94"], "limits": {"va": 300, "vg2": 150, "vkh": 90, "ik": 20, "pa": 3.5, "pg2": 0.9, "rg": 0.5}, "nominal": {"va": 250, "vg2": 150, "vg": -1.05, "vg_from_rk": 68, "ia": 11, "gm": 5.2, "rp": 1000, "ig2": 4.5}},
    heaterWarning: "Heater 6.3 V @ 0.3 A. Cathode–heater max 90 V. Ratings: K&L 1981 p. 213.",
    vaMax: 300, paMax: 3.5, ikMax: 20, vg2Max: 150,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 38.7, kg: 805.5, kp: 174.3, lam: 10720, x: 1.4, kg2: 947.8 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 38.7, kg: 805.5, kp: 174.3, lam: 10720, x: 1.4, kg2: 947.8 },
      Triode: { mu: 37.67, kg: 594.6, kp: 241.5, kvb: 0.000002731, x: 1.42 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж5П", nameWestern: "6Zh5P / 6F36", commonName: "6Zh5P",
    type: "Pentode / Beam Tetrode — HF voltage amplifier", category: "small_signal", origin: "Soviet", socket: "Miniature B7G", pinCount: 7,
    vh: 6.3, ih: 0.45,
    book: {"source": "Katsnelson & Larionov 1981", "page": 216, "name": "6Ж5П", "purpose": "HF voltage amplifier", "analogs": ["6F36"], "limits": {"va": 300, "vg2": 150, "vkh": 100, "ik": 20, "pa": 3.6, "pg2": 0.5, "rg": 1.0}, "nominal": {"va": 300, "vg2": 120, "vg": -1.79, "vg_from_rk": 160, "ia": 10, "gm": 9}},
    heaterWarning: "Heater 6.3 V @ 0.45 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 216.",
    vaMax: 300, paMax: 3.6, ikMax: 20, vg2Max: 150,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 36.98, kg: 416.2, kp: 236.5, lam: 1500, x: 1.4, kg2: 1688 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 36.98, kg: 416.2, kp: 236.5, lam: 1500, x: 1.4, kg2: 1688 },
      Triode: { mu: 35.33, kg: 404.9, kp: 278.6, kvb: 0.000006537, x: 1.48 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж9П", nameWestern: "6Zh9P / E180F", commonName: "6Zh9P",
    type: "Pentode / Beam Tetrode — wideband HF input stages (high gm)", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.3,
    book: {"source": "Katsnelson & Larionov 1981", "page": 220, "name": "6Ж9П", "purpose": "wideband HF input stages (high gm)", "variants": ["6Ж9П-Е"], "analogs": ["E180F"], "limits": {"va": 250, "va_cutoff": 285, "vg2": 160, "vkh": 100, "ik": 35, "pa": 3.0, "pg2": 0.75, "rg": 1.0}, "nominal": {"va": 150, "vg2": 150, "vg": -1.39, "vg_from_rk": 80, "ia": 15, "gm": 17.5, "rp": 150, "ig2": 2.4}},
    heaterWarning: "Heater 6.3 V @ 0.3 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 220.",
    vaMax: 250, paMax: 3, ikMax: 35, vg2Max: 160,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 59.07, kg: 172.6, kp: 579.2, lam: 2213, x: 1.36, kg2: 504.4 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 59.07, kg: 172.6, kp: 579.2, lam: 2213, x: 1.36, kg2: 504.4 },
      Triode: { mu: 57.69, kg: 150.7, kp: 699.5, kvb: 0.0000213, x: 1.41 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж32Б", nameWestern: "6Zh32B", commonName: "6Zh32B",
    type: "Pentode / Beam Tetrode — HF and LF voltage amplifier (subminiature)", category: "small_signal", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.165,
    book: {"source": "Katsnelson & Larionov 1981", "page": 235, "name": "6Ж32Б", "purpose": "HF and LF voltage amplifier (subminiature)", "limits": {"va": 250, "va_cutoff": 300, "vg2": 150, "vkh": 150, "ik": 10, "pa": 1.2, "pg2": 0.5, "rg": 1.0}, "nominal": {"va": 120, "vg2": 120, "vg": -1.48, "vg_from_rk": 200, "ia": 6, "gm": 6, "ig2": 1.4}},
    heaterWarning: "Heater 6.3 V @ 0.165 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 235.",
    vaMax: 250, paMax: 1.2, ikMax: 10, vg2Max: 150,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 42.98, kg: 540.1, kp: 260, lam: 1500, x: 1.41, kg2: 1053 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 42.98, kg: 540.1, kp: 260, lam: 1500, x: 1.41, kg2: 1053 },
      Triode: { mu: 41.74, kg: 452.6, kp: 250.3, kvb: 7.686, x: 1.48 }
    },
    pinout: []
  },
  {
    nameGost: "6Ж32П", nameWestern: "6Zh32P / EF86", commonName: "6Zh32P",
    type: "Pentode / Beam Tetrode — low-noise first stages of sound recording and reproduction", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.2,
    book: {"source": "Katsnelson & Larionov 1981", "page": 236, "name": "6Ж32П", "purpose": "low-noise first stages of sound recording and reproduction", "analogs": ["EF86"], "limits": {"va": 300, "vg2": 200, "vkh": 50, "ik": 6, "pa": 1.0, "pg2": 0.2, "rg": 3.0}, "nominal": {"va": 250, "vg2": 140, "vg": -2, "ia": 3, "gm": 1.8, "ig2": 0.6}},
    heaterWarning: "Heater 6.3 V @ 0.2 A. Cathode–heater max 50 V. Ratings: K&L 1981 p. 236.",
    vaMax: 300, paMax: 1, ikMax: 6, vg2Max: 200,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 33.26, kg: 2400, kp: 196, lam: 1500, x: 1.4, kg2: 5050 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 33.26, kg: 2400, kp: 196, lam: 1500, x: 1.4, kg2: 5050 },
      Triode: { mu: 31.59, kg: 2184, kp: 250.2, kvb: 8.243, x: 1.48 }
    },
    pinout: []
  },
  {
    nameGost: "6П9", nameWestern: "6P9 / 6L10", commonName: "6P9",
    type: "Pentode / Beam Tetrode — wideband video output (metal)", category: "power", origin: "Soviet", socket: "Octal", pinCount: 8,
    vh: 6.3, ih: 0.65,
    book: {"source": "Katsnelson & Larionov 1981", "page": 297, "name": "6П9", "purpose": "wideband video output (metal)", "analogs": ["6L10"], "limits": {"va": 330, "vg2": 330, "vkh": 100, "pa": 9, "pg2": 1.5, "rg": 0.75, "rg_fixed": 0.5}, "nominal": {"va": 300, "vg2": 150, "vg": -3, "ia": 30, "gm": 11.7, "ig2": 6.5}},
    heaterWarning: "Heater 6.3 V @ 0.65 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 297.",
    vaMax: 330, paMax: 9, ikMax: 0, vg2Max: 330,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 23.39, kg: 443.5, kp: 148.4, lam: 1500, x: 1.38, kg2: 842.4 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 23.39, kg: 443.5, kp: 148.4, lam: 1500, x: 1.38, kg2: 842.4 },
      Triode: { mu: 21.98, kg: 440.5, kp: 198.5, kvb: 24.62, x: 1.49 }
    },
    pinout: []
  },
  {
    nameGost: "6П15П", nameWestern: "6P15P", commonName: "6P15P",
    type: "Pentode / Beam Tetrode — video output (TV)", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.76,
    book: {"source": "Katsnelson & Larionov 1981", "page": 302, "name": "6П15П", "purpose": "video output (TV)", "variants": ["6П15П-В", "6П15П-ЕВ", "6П15П-ЕР"], "limits": {"va": 330, "vg2": 330, "vkh": 100, "ik": 90, "pa": 12, "pg2": 1.5, "rg": 1.0}, "nominal": {"va": 300, "vg2": 150, "vg": -2.42, "vg_from_rk": 70, "ia": 30, "gm": 15, "rp": 100, "ig2": 4.5}},
    heaterWarning: "Heater 6.3 V @ 0.76 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 302.",
    vaMax: 330, paMax: 12, ikMax: 90, vg2Max: 330,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 29.59, kg: 292.9, kp: 178.4, lam: 2700, x: 1.39, kg2: 863.6 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 29.59, kg: 292.9, kp: 178.4, lam: 2700, x: 1.39, kg2: 863.6 },
      Triode: { mu: 28.28, kg: 287.5, kp: 222, kvb: 74.27, x: 1.46 }
    },
    pinout: []
  },
  {
    nameGost: "6П18П", nameWestern: "6P18P / EL82", commonName: "6P18P",
    type: "Pentode / Beam Tetrode — LF output (TV vertical)", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.76,
    book: {"source": "Katsnelson & Larionov 1981", "page": 304, "name": "6П18П", "purpose": "LF output (TV vertical)", "analogs": ["EL82"], "limits": {"va": 250, "vg2": 250, "vkh": 100, "ik": 75, "pa": 12, "pg2": 2.5, "rg": 1.0, "rg_fixed": 0.3}, "nominal": {"va": 180, "vg2": 180, "vg": -6.71, "vg_from_rk": 110, "ia": 53, "gm": 11, "ig2": 8}},
    heaterWarning: "Heater 6.3 V @ 0.76 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 304.",
    vaMax: 250, paMax: 12, ikMax: 75, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 13.67, kg: 545.2, kp: 112.6, lam: 1500, x: 1.37, kg2: 1605 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 13.67, kg: 545.2, kp: 112.6, lam: 1500, x: 1.37, kg2: 1605 },
      Triode: { mu: 13.03, kg: 585.4, kp: 150.8, kvb: 36.97, x: 1.47 }
    },
    pinout: []
  },
  {
    nameGost: "6П25Б", nameWestern: "6P25B", commonName: "6P25B",
    type: "Pentode / Beam Tetrode — LF output (subminiature)", category: "power", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.45,
    book: {"source": "Katsnelson & Larionov 1981", "page": 309, "name": "6П25Б", "purpose": "LF output (subminiature)", "variants": ["6П25Б-В"], "limits": {"va": 170, "vg2": 160, "vkh": 150, "ik": 50, "pa": 4.1, "pg2": 0.55, "rg": 0.5}, "nominal": {"va": 110, "vg2": 110, "vg": -8, "ia": 30, "gm": 4.5}},
    heaterWarning: "Heater 6.3 V @ 0.45 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 309.",
    vaMax: 170, paMax: 4.1, ikMax: 50, vg2Max: 160,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 6.471, kg: 1386, kp: 100, lam: 1500, x: 1.35, kg2: 6042 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 6.471, kg: 1386, kp: 100, lam: 1500, x: 1.35, kg2: 6042 },
      Triode: { mu: 6.302, kg: 1490, kp: 824200000, kvb: 0.000006523, x: 1.43 }
    },
    pinout: []
  },
  {
    nameGost: "6П30Б", nameWestern: "6P30B", commonName: "6P30B",
    type: "Pentode / Beam Tetrode — LF output (subminiature)", category: "power", origin: "Soviet", socket: "Subminiature", pinCount: 0,
    vh: 6.3, ih: 0.395,
    book: {"source": "Katsnelson & Larionov 1981", "page": 311, "name": "6П30Б", "purpose": "LF output (subminiature)", "variants": ["6П30Б-Р", "6П30Б-ЕР"], "limits": {"va": 250, "vg2": 250, "vkh": 200, "ik": 60, "pa": 5.5, "pg2": 2, "rg": 1.0}, "nominal": {"va": 120, "vg2": 120, "vg": -12.0, "vg_from_rk": 330, "ia": 35, "gm": 4.45, "ig2": 1.3}},
    heaterWarning: "Heater 6.3 V @ 0.395 A. Cathode–heater max 200 V. Ratings: K&L 1981 p. 311.",
    vaMax: 250, paMax: 5.5, ikMax: 60, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 5.308, kg: 1489, kp: 99.99, lam: 1500, x: 1.35, kg2: 19340 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 5.308, kg: 1489, kp: 99.99, lam: 1500, x: 1.35, kg2: 19340 },
      Triode: { mu: 5.156, kg: 1878, kp: 59140000000000000, kvb: 0.00001247, x: 1.45 }
    },
    pinout: []
  },
  {
    nameGost: "6П33П", nameWestern: "6P33P / EL86", commonName: "6P33P",
    type: "Pentode / Beam Tetrode — LF output stages", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.9,
    book: {"source": "Katsnelson & Larionov 1981", "page": 315, "name": "6П33П", "purpose": "LF output stages", "analogs": ["EL86"], "limits": {"va": 250, "va_on": 550, "vg2": 200, "vkh": 100, "ik": 100, "pa": 12, "pa_note": "6 W in dynamic mode (EL86 4.5)", "pg2": 1.75, "rg": 1.0}, "nominal": {"va": 170, "vg2": 170, "vg": -12.5, "ia": 70, "gm": 10, "rp": 25}},
    heaterWarning: "Heater 6.3 V @ 0.9 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 315.",
    vaMax: 250, paMax: 12, ikMax: 100, vg2Max: 200,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 7.749, kg: 660.1, kp: 100.7, lam: 1601, x: 1.35, kg2: 2720 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 7.749, kg: 660.1, kp: 100.7, lam: 1601, x: 1.35, kg2: 2720 },
      Triode: { mu: 7.514, kg: 715.8, kp: 169.9, kvb: 7.069, x: 1.43 }
    },
    pinout: []
  },
  {
    nameGost: "6П36С", nameWestern: "6P36S / EL500", commonName: "6P36S",
    type: "Pentode / Beam Tetrode — TV line output (beam tetrode, 110°)", category: "power", origin: "Soviet", socket: "Magnoval (fig. 6с)", pinCount: 0,
    vh: 6.3, ih: 2,
    book: {"source": "Katsnelson & Larionov 1981", "page": 319, "name": "6П36С", "purpose": "TV line output (beam tetrode, 110°)", "variants": ["6П36С-В"], "analogs": ["EL500"], "limits": {"va": 250, "va_on": 500, "vg2": 250, "vkh": 100, "ik": 250, "pa": 12, "pg2": 5, "rg": 0.5}, "nominal": {"va": 100, "vg2": 100, "vg": -7, "ia": 120, "gm": 14, "rp": 4.5}},
    heaterWarning: "Heater 6.3 V @ 2 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 319.",
    vaMax: 250, paMax: 12, ikMax: 250, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 5.381, kg: 530.7, kp: 100, lam: 578.5, x: 1.35, kg2: 1972 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 5.381, kg: 530.7, kp: 100, lam: 578.5, x: 1.35, kg2: 1972 },
      Triode: { mu: 5.098, kg: 784.9, kp: 4689000000000, kvb: 0.00002169, x: 1.56 }
    },
    pinout: []
  },
  {
    nameGost: "6П41С", nameWestern: "6P41S", commonName: "6P41S",
    type: "Pentode / Beam Tetrode — TV vertical and line output (beam tetrode)", category: "power", origin: "Soviet", socket: "None (fig. 15с)", pinCount: 0,
    vh: 6.3, ih: 1.1,
    book: {"source": "Katsnelson & Larionov 1981", "page": 325, "name": "6П41С", "purpose": "TV vertical and line output (beam tetrode)", "limits": {"va": 400, "vg2": 350, "vkh": 100, "ik": 100, "pa": 14, "pg2": 3}, "nominal": {"va": 190, "vg2": 190, "vg": -20.6, "vg_from_rk": 300, "ia": 66, "gm": 8.4, "rp": 12, "ig2": 2.7}},
    heaterWarning: "Heater 6.3 V @ 1.1 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 325.",
    vaMax: 400, paMax: 14, ikMax: 100, vg2Max: 350,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 6.094, kg: 965.1, kp: 100.3, lam: 605.8, x: 1.35, kg2: 8982 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 6.094, kg: 965.1, kp: 100.3, lam: 605.8, x: 1.35, kg2: 8982 },
      Triode: { mu: 5.775, kg: 1490, kp: 2096, kvb: 8.302e-7, x: 1.56 }
    },
    pinout: []
  },
  {
    nameGost: "6П43П-Е", nameWestern: "6P43P-E", commonName: "6P43P-E",
    type: "Pentode / Beam Tetrode — TV vertical output", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.625,
    book: {"source": "Katsnelson & Larionov 1981", "page": 328, "name": "6П43П-Е", "purpose": "TV vertical output", "limits": {"va": 300, "va_on": 550, "vg2": 250, "vkh": 100, "ik": 75, "pa": 12, "pg2": 2, "rg": 2.2, "rg_fixed": 1.0}, "nominal": {"va": 185, "vg2": 185, "vg": -16.5, "vg_from_rk": 340, "ia": 45, "gm": 7.5, "ig2": 3.6}},
    heaterWarning: "Heater 6.3 V @ 0.625 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 328.",
    vaMax: 300, paMax: 12, ikMax: 75, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 7.541, kg: 845.7, kp: 103.1, lam: 1500, x: 1.36, kg2: 4692 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 7.541, kg: 845.7, kp: 103.1, lam: 1500, x: 1.36, kg2: 4692 },
      Triode: { mu: 7.281, kg: 1000, kp: 3049, kvb: 5.578, x: 1.46 }
    },
    pinout: []
  },
  {
    nameGost: "6Р5П", nameWestern: "6R5P", commonName: "6R5P",
    type: "Double Pentode / Beam Tetrode — LF output stages of two-channel and stereo amplifiers", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.55,
    book: {"source": "Katsnelson & Larionov 1981", "page": 336, "name": "6Р5П", "purpose": "LF output stages of two-channel and stereo amplifiers", "limits": {"va": 300, "va_cutoff": 550, "vg2": 300, "vkh": 100, "ik": 40, "pa": 8, "pg2": 3.5, "pg2_note": "3.5 W with signal, 1.75 W without", "rg": 1.2}, "nominal": {"va": 250, "vg2": 250, "vg": -9, "ia": 24, "gm": 6, "ig2": 6}},
    heaterWarning: "Heater 6.3 V @ 0.55 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 336.",
    vaMax: 300, paMax: 8, ikMax: 40, vg2Max: 300,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 17.57, kg: 969.9, kp: 149.4, lam: 1500, x: 1.38, kg2: 1634 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 17.57, kg: 969.9, kp: 149.4, lam: 1500, x: 1.38, kg2: 1634 },
      Triode: { mu: 16.82, kg: 898.4, kp: 211.6, kvb: 13.32, x: 1.47 }
    },
    pinout: []
  },
  {
    nameGost: "6Ф1П (триод)", nameWestern: "6F1P-T triode section / ECF80", commonName: "6F1P-T",
    type: "Triode-Pentode, Triode Section — HF oscillator/mixer, TV sweep", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.42,
    book: {"source": "Katsnelson & Larionov 1981", "page": 352, "name": "6Ф1П", "purpose": "HF oscillator/mixer, TV sweep", "analogs": ["ECF80"], "limits": {"va": 250, "vkh": 100, "ik": 14, "pa": 1.5, "rg": 0.5}, "nominal": {"va": 100, "vg": -2, "ia": 13, "gm": 5, "rp": 4.0}},
    heaterWarning: "Heater 6.3 V @ 0.42 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 352.",
    vaMax: 250, paMax: 1.5, ikMax: 14, vg2Max: 0,
    koren: { Triode: { mu: 19.49, kg: 645, kp: 269.8, kvb: 359.1, x: 1.24 } },
    pinout: []
  },
  {
    nameGost: "6Ф1П (пентод)", nameWestern: "6F1P-P pentode section / ECF80", commonName: "6F1P-P",
    type: "Triode-Pentode, Pentode Section — HF oscillator/mixer, TV sweep", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.42,
    book: {"source": "Katsnelson & Larionov 1981", "page": 352, "name": "6Ф1П", "purpose": "HF oscillator/mixer, TV sweep", "analogs": ["ECF80"], "limits": {"va": 250, "vg2": 175, "pa": 2.5, "pg2": 0.7, "rg": 1.0}, "nominal": {"va": 170, "vg2": 170, "vg": -2, "ia": 10, "gm": 6.2, "rp": 400}},
    heaterWarning: "Heater 6.3 V @ 0.42 A. Ratings: K&L 1981 p. 352.",
    vaMax: 250, paMax: 2.5, ikMax: 0, vg2Max: 175,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 41.2, kg: 616.1, kp: 234.9, lam: 3938, x: 1.4, kg2: 2767 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 41.2, kg: 616.1, kp: 234.9, lam: 3938, x: 1.4, kg2: 2767 },
      Triode: { mu: 54.85, kg: 409.4, kp: 106.4, kvb: 2.193, x: 1.44 }
    },
    pinout: []
  },
  {
    nameGost: "6Ф4П (триод)", nameWestern: "6F4P-T triode section / ECL84", commonName: "6F4P-T",
    type: "Triode-Pentode, Triode Section — video output (pentode), LF preamp (triode)", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.72,
    book: {"source": "Katsnelson & Larionov 1981", "page": 358, "name": "6Ф4П", "purpose": "video output (pentode), LF preamp (triode)", "analogs": ["ECL84"], "limits": {"va": 250, "vkh": 150, "ik": 12, "pa": 1.0, "rg": 1.0}, "nominal": {"va": 200, "vg": -1.71, "vg_from_rk": 570, "ia": 3, "gm": 4, "rp": 16.2}},
    heaterWarning: "Heater 6.3 V @ 0.72 A. Cathode–heater max 150 V. Ratings: K&L 1981 p. 358.",
    vaMax: 250, paMax: 1, ikMax: 12, vg2Max: 0,
    koren: { Triode: { mu: 71.3, kg: 778.7, kp: 629.2, kvb: 263.3, x: 1.55 } },
    pinout: []
  },
  {
    nameGost: "6Ф4П (пентод)", nameWestern: "6F4P-P pentode section / ECL84", commonName: "6F4P-P",
    type: "Triode-Pentode, Pentode Section — video output (pentode), LF preamp (triode)", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.72,
    book: {"source": "Katsnelson & Larionov 1981", "page": 358, "name": "6Ф4П", "purpose": "video output (pentode), LF preamp (triode)", "analogs": ["ECL84"], "limits": {"va": 250, "vg2": 250, "ik": 40, "pa": 4, "pg2": 1.7, "rg": 1.0}, "nominal": {"va": 200, "vg2": 200, "vg": -2.97, "vg_from_rk": 140, "ia": 18, "gm": 10.4, "rp": 130, "ig2": 3.2}},
    heaterWarning: "Heater 6.3 V @ 0.72 A. Ratings: K&L 1981 p. 358.",
    vaMax: 250, paMax: 4, ikMax: 40, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 38.23, kg: 392.2, kp: 249.9, lam: 2149, x: 1.4, kg2: 982.9 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 38.23, kg: 392.2, kp: 249.9, lam: 2149, x: 1.4, kg2: 982.9 },
      Triode: { mu: 36.6, kg: 364, kp: 308.9, kvb: 0.00006657, x: 1.47 }
    },
    pinout: []
  },
  {
    nameGost: "6Ф5П (триод)", nameWestern: "6F5P-T triode section / ECL85", commonName: "6F5P-T",
    type: "Triode-Pentode, Triode Section — LF voltage amplifier (triode), TV vertical output (pentode)", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.925,
    book: {"source": "Katsnelson & Larionov 1981", "page": 360, "name": "6Ф5П", "purpose": "LF voltage amplifier (triode), TV vertical output (pentode)", "analogs": ["ECL85"], "limits": {"va": 250, "vkh": 100, "ik": 15, "pa": 0.5, "rg": 3.3, "rg_fixed": 1.0}, "nominal": {"va": 100, "vg": -0.832, "vg_from_rk": 160, "ia": 5.2, "gm": 7, "rp": 10.0}},
    heaterWarning: "Heater 6.3 V @ 0.925 A. Cathode–heater max 100 V. Ratings: K&L 1981 p. 360.",
    vaMax: 250, paMax: 0.5, ikMax: 15, vg2Max: 0,
    koren: { Triode: { mu: 67.94, kg: 276.4, kp: 550.2, kvb: 3228, x: 1.18 } },
    pinout: []
  },
  {
    nameGost: "6Ф5П (пентод)", nameWestern: "6F5P-P pentode section / ECL85", commonName: "6F5P-P",
    type: "Triode-Pentode, Pentode Section — LF voltage amplifier (triode), TV vertical output (pentode)", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.925,
    book: {"source": "Katsnelson & Larionov 1981", "page": 360, "name": "6Ф5П", "purpose": "LF voltage amplifier (triode), TV vertical output (pentode)", "analogs": ["ECL85"], "limits": {"va": 300, "vg2": 250, "ik": 75, "pa": 9, "pg2": 2, "rg": 2.2, "rg_fixed": 1.0}, "nominal": {"va": 185, "vg2": 185, "vg": -14.9, "vg_from_rk": 340, "ia": 41, "gm": 7.5, "ig2": 2.7}},
    heaterWarning: "Heater 6.3 V @ 0.925 A. Ratings: K&L 1981 p. 360.",
    vaMax: 300, paMax: 9, ikMax: 75, vg2Max: 250,
    koren: {
      Pentode: { vk: 34.89, ks: 0.7458, mu: 8.333, kg: 821.4, kp: 105.9, lam: 1500, x: 1.36, kg2: 5530 },
      Ultralinear: { vk: 34.89, ks: 0.7458, mu: 8.333, kg: 821.4, kp: 105.9, lam: 1500, x: 1.36, kg2: 5530 },
      Triode: { mu: 8.024, kg: 987.8, kp: 1777, kvb: 16.38, x: 1.47 }
    },
    pinout: []
  }
];
