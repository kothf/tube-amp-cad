/* =============================================================================
   VACUUM TUBE DATABASE — single source of truth for every window
   (curve tracer, circuit CAD). Koren model parameters per operating mode,
   ratings and socket pinouts.
   ============================================================================= */
var TUBE_DATABASE = [
  // ---------------- Small Signal Soviet (GOST) ----------------
  {
    nameGost: "6Н2П / 6Н2П-ЕВ", nameWestern: "6N2P-EV (High-Gain Triode)", commonName: "6N2P-EV",
    type: "Dual High-Mu Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.34,
    heaterWarning: "CRITICAL PINOUT HAZARD: Pin 9 is an Electrostatic Shield (GND)! Heater is 6.3V STRICTLY on Pins 4 & 5. NEVER wire to 12AX7 12.6V supply or pin 9 center-tap!",
    hasPin9Shield: true,
    vaMax: 300, paMax: 1.0, ikMax: 10, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 95.05, kg: 1057, kp: 529, kvb: 328.3, x: 1.16 } },
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
    nameGost: "6Н1П / 6Н1П-ВИ", nameWestern: "6N1P-VI (Driver Triode)", commonName: "6N1P-VI",
    type: "Dual Medium-Mu Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.60,
    heaterWarning: "Pins 4 & 5: 6.3V @ 0.6A. Pin 9 is internal shield. Ensure filament supply can deliver 600mA!",
    hasPin9Shield: true,
    vaMax: 300, paMax: 2.2, ikMax: 25, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 36.06, kg: 755.6, kp: 305.6, kvb: 180.1, x: 1.35 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Internal Shield", isShield: true }
    ]
  },
  {
    nameGost: "6Н23П / 6Н23П-ЕВ", nameWestern: "6N23P-EV / ECC88 / 6922", commonName: "6N23P-EV",
    type: "Dual Frame-Grid Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.31,
    heaterWarning: "Pins 4 & 5: 6.3V. Pin 9: Internal Shield (GND).",
    hasPin9Shield: true,
    vaMax: 300, paMax: 1.8, ikMax: 20, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 32.53, kg: 223.1, kp: 213.3, kvb: 127.6, x: 1.29 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Shield", isShield: true }
    ]
  },
  {
    nameGost: "6Н6П", nameWestern: "6N6P (High-Current Driver)", commonName: "6N6P",
    type: "Dual Power Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.75,
    heaterWarning: "HEAVY HEATER: 0.75A @ 6.3V (Pins 4-5). Pin 9 is shield.",
    hasPin9Shield: true,
    vaMax: 300, paMax: 4.8, ikMax: 45, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 19.94, kg: 381.2, kp: 159.6, kvb: 110, x: 1.35 } },
    pinout: [
      { pin: 1, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 2, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 3, sym: "K2", role: "Cathode 2", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 7, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 8, sym: "K1", role: "Cathode 1", isCathode: true },
      { pin: 9, sym: "S", role: "Shield", isShield: true }
    ]
  },
  {
    nameGost: "6Н8С", nameWestern: "6N8S (6SN7-GT Equivalent)", commonName: "6N8S",
    type: "Dual Octal Triode", category: "small_signal", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.60,
    heaterWarning: "Octal Pins 7 & 8: 6.3V @ 0.6A.",
    vaMax: 330, paMax: 2.75, ikMax: 20, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 21.64, kg: 1286, kp: 129.4, kvb: 381.5, x: 1.3 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  {
    nameGost: "6С45П", nameWestern: "6S45P (Super-Gm Triode)", commonName: "6S45P",
    type: "Single High-Gm Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.44,
    heaterWarning: "Extremely high Gm (45mA/V). Requires grid stopper resistor to prevent VHF oscillation!",
    vaMax: 200, paMax: 7.8, ikMax: 60, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 57.01, kg: 51.92, kp: 278, kvb: 79.98, x: 1.36 } },
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
    koren: { Triode: { mu: 118.9, kg: 722, kp: 522.9, kvb: 9987, x: 1.1 } },
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
    koren: { Triode: { mu: 21.88, kg: 1262, kp: 69.5, kvb: 334.8, x: 1.31 } },
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
    koren: { Triode: { mu: 21.64, kg: 1286, kp: 129.4, kvb: 380.9, x: 1.3 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  // ---------------- Power Output Soviet (GOST) ----------------
  {
    nameGost: "6П14П / 6П14П-ЕВ", nameWestern: "6P14P-EV (EL84 / 7189 Heavy Duty)", commonName: "6P14P-EV",
    type: "Power Output Pentode", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.76,
    heaterWarning: "Noval B9A. Pins 4 & 5: 6.3V @ 0.76A. Envelope runs hot (>180°C) in Class A!",
    vaMax: 400, paMax: 14.0, ikMax: 65, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { mu: 19.24, kg: 658.7, kp: 145.7, kvb: 48.85, x: 1.4, kg2: 2059 },
      Ultralinear: { mu: 19.24, kg: 658.7, kp: 145.7, kvb: 48.85, x: 1.4, kg2: 2059 },
      Triode: { mu: 17.82, kg: 759.1, kp: 190.7, kvb: 0.000005647, x: 1.58 }
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
    nameGost: "6П3С / 6П3С-Е", nameWestern: "6P3S-E (6L6-GC Equivalent)", commonName: "6P3S-E",
    type: "Beam Power Tetrode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.88,
    heaterWarning: "Octal Pins 2 & 7: 6.3V @ 0.88A. Pin 3 is High-Voltage Plate!",
    vaMax: 450, paMax: 20.5, ikMax: 90, vg2Max: 300,
    isFavorite: true,
    koren: {
      Pentode: { mu: 8.798, kg: 3329, kp: 25.99, kvb: 72.64, x: 1.63, kg2: 16620 },
      Ultralinear: { mu: 8.798, kg: 3329, kp: 25.99, kvb: 72.64, x: 1.63, kg2: 16620 },
      Triode: { mu: 8.058, kg: 5002, kp: 26.29, kvb: 4.072e-17, x: 1.8 }
    },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater", isHeater: true },
      { pin: 3, sym: "A", role: "Plate (HV!)", isPlate: true }, { pin: 4, sym: "G2", role: "Screen Grid", isScreen: true },
      { pin: 5, sym: "G1", role: "Control Grid", isGrid: true }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K", role: "Cathode", isCathode: true }
    ]
  },
  {
    nameGost: "6П27С", nameWestern: "6P27S (Soviet EL34)", commonName: "6P27S",
    type: "Power Output Pentode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 1.50,
    heaterWarning: "Heavy Heater: 1.5A @ 6.3V. Pin 1 is Grid 3 (must tie to cathode).",
    vaMax: 800, paMax: 25.0, ikMax: 150, vg2Max: 425,
    isFavorite: true,
    koren: {
      Pentode: { mu: 11, kg: 620.1, kp: 43.95, kvb: 58.81, x: 1.35, kg2: 1348 },
      Ultralinear: { mu: 11, kg: 620.1, kp: 43.95, kvb: 58.81, x: 1.35, kg2: 1348 },
      Triode: { mu: 9.891, kg: 888.2, kp: 47.87, kvb: 0.000001774, x: 1.56 }
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
      Pentode: { mu: 7.997, kg: 647.6, kp: 18.3, kvb: 30, x: 1.34, kg2: 723.4 },
      Ultralinear: { mu: 7.997, kg: 647.6, kp: 18.3, kvb: 30, x: 1.34, kg2: 723.4 },
      Triode: { mu: 9.867, kg: 355.9, kp: 17.38, kvb: 0.000006142, x: 1.42 }
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
    koren: { Triode: { mu: 4.174, kg: 1245, kp: 67.74, kvb: 181.6, x: 1.34 } },
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
      Pentode: { mu: 19.24, kg: 656.8, kp: 147.9, kvb: 48.86, x: 1.39, kg2: 2055 },
      Ultralinear: { mu: 19.24, kg: 656.8, kp: 147.9, kvb: 48.86, x: 1.39, kg2: 2055 },
      Triode: { mu: 17.82, kg: 756.1, kp: 195, kvb: 0.000003004, x: 1.57 }
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
      Pentode: { mu: 11, kg: 619.3, kp: 44, kvb: 58.81, x: 1.35, kg2: 1347 },
      Ultralinear: { mu: 11, kg: 619.3, kp: 44, kvb: 58.81, x: 1.35, kg2: 1347 },
      Triode: { mu: 9.892, kg: 887, kp: 47.93, kvb: 0.000001345, x: 1.56 }
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
      Pentode: { mu: 8.056, kg: 1010, kp: 53, kvb: 42.85, x: 1.38, kg2: 4168 },
      Ultralinear: { mu: 8.056, kg: 1010, kp: 53, kvb: 42.85, x: 1.38, kg2: 4168 },
      Triode: { mu: 7.464, kg: 1279, kp: 65.11, kvb: 0.000001082, x: 1.54 }
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
    koren: { Triode: { mu: 4.006, kg: 1292, kp: 63.13, kvb: 167.4, x: 1.38 } },
    pinout: [
      { pin: 1, sym: "F+", role: "Filament / Cathode (+)", isHeater: true, isCathode: true },
      { pin: 2, sym: "A", role: "Plate (HV!)", isPlate: true },
      { pin: 3, sym: "G", role: "Control Grid", isGrid: true },
      { pin: 4, sym: "F-", role: "Filament / Cathode (-)", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Rectifiers ----------------
  {
    nameGost: "5Ц4С", nameWestern: "5Ts4S / 5Z4-G Equivalent", commonName: "5Ts4S",
    type: "Full-Wave Vacuum Rectifier", category: "rectifier", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 5.0, ih: 2.0,
    heaterWarning: "Heater is 5.0V @ 2.0A (Pins 2 & 8). Cathode tied to Pin 8 (B+ output at HIGH VOLTAGE!).",
    vaMax: 500, paMax: 0, ikMax: 125, vg2Max: 0,
    koren: { Triode: { mu: 1.0, kg: 100, kp: 40, kvb: 10, x: 1.5 } },
    pinout: [
      { pin: 1, sym: "NC", role: "No Connection" }, { pin: 2, sym: "H", role: "Heater 5V", isHeater: true },
      { pin: 3, sym: "NC", role: "No Connection" }, { pin: 4, sym: "A1", role: "Anode 1 (AC IN)", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "A2", role: "Anode 2 (AC IN)", isPlate: true },
      { pin: 7, sym: "NC", role: "No Connection" }, { pin: 8, sym: "K_H", role: "Cathode / B+ OUT", isHeater: true, isCathode: true }
    ]
  },
  {
    nameGost: "5Ц3С", nameWestern: "5Ts3S / 5U4-G Equivalent", commonName: "5Ts3S",
    type: "Heavy Full-Wave Rectifier", category: "rectifier", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 5.0, ih: 3.0,
    heaterWarning: "Heavy 3.0A Filament @ 5.0V! Directly heated. B+ appears on Pins 2 & 8.",
    vaMax: 500, paMax: 0, ikMax: 225, vg2Max: 0,
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
    nameGost: "6Н9С", nameWestern: "6N9S (6SL7-GT Equivalent)", commonName: "6N9S",
    type: "Dual High-Mu Octal Triode", category: "small_signal", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.30, heaterWarning: "Octal Pins 7 & 8: 6.3V @ 0.3A.",
    vaMax: 275, paMax: 1.1, ikMax: 10, vg2Max: 0,
    koren: { Triode: { mu: 67.89, kg: 1670, kp: 519.8, kvb: 375.4, x: 1.22 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "K1", role: "Cathode 1", isCathode: true }, { pin: 4, sym: "G2", role: "Grid 2", isGrid: true },
      { pin: 5, sym: "A2", role: "Plate 2", isPlate: true }, { pin: 6, sym: "K2", role: "Cathode 2", isCathode: true },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "H", role: "Heater", isHeater: true }
    ]
  },
  {
    nameGost: "6Н7С", nameWestern: "6N7S (Dual Class B Triode)", commonName: "6N7S",
    type: "Dual Common-Cathode Triode", category: "small_signal", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.80, heaterWarning: "Heater 0.8A @ 6.3V (Pins 7 & 8). Common Cathode on Pin 8!",
    vaMax: 300, paMax: 5.5, ikMax: 30, vg2Max: 0,
    koren: { Triode: { mu: 34.22, kg: 620.5, kp: 197.4, kvb: 259.5, x: 1.15 } },
    pinout: [
      { pin: 1, sym: "G1", role: "Grid 1", isGrid: true }, { pin: 2, sym: "A1", role: "Plate 1", isPlate: true },
      { pin: 3, sym: "G2", role: "Grid 2", isGrid: true }, { pin: 4, sym: "A2", role: "Plate 2", isPlate: true },
      { pin: 5, sym: "NC", role: "No Connection" }, { pin: 6, sym: "NC", role: "No Connection" },
      { pin: 7, sym: "H", role: "Heater", isHeater: true }, { pin: 8, sym: "K_H", role: "Cathode & Heater", isHeater: true, isCathode: true }
    ]
  },
  {
    nameGost: "6С3П / 6С4П", nameWestern: "6S3P / 6S4P (High-Gm VHF Triode)", commonName: "6S3P",
    type: "Single High-Gm Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.30, heaterWarning: "Pins 4 & 5: 6.3V. Gm = 19.5 mA/V. Excellent phono input tube.",
    vaMax: 160, paMax: 3.0, ikMax: 20, vg2Max: 0,
    koren: { Triode: { mu: 54.53, kg: 108.8, kp: 303.1, kvb: 90.05, x: 1.36 } },
    pinout: [
      { pin: 1, sym: "A", role: "Plate", isPlate: true }, { pin: 2, sym: "G", role: "Grid", isGrid: true },
      { pin: 3, sym: "K", role: "Cathode", isCathode: true }, { pin: 4, sym: "H", role: "Heater", isHeater: true },
      { pin: 5, sym: "H", role: "Heater", isHeater: true }, { pin: 6, sym: "A", role: "Plate", isPlate: true },
      { pin: 7, sym: "K", role: "Cathode", isCathode: true }, { pin: 8, sym: "G", role: "Grid", isGrid: true },
      { pin: 9, sym: "NC", role: "Shield / NC" }
    ]
  },
  {
    nameGost: "6С19П", nameWestern: "6S19P (Low-Rp Power Triode)", commonName: "6S19P",
    type: "Single Power Triode", category: "small_signal", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 1.0, heaterWarning: "HEATER: 1.0A @ 6.3V (Pins 4 & 5). Internal Rp ~ 300 Ohms!",
    vaMax: 350, paMax: 11.0, ikMax: 140, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 2.999, kg: 966.5, kp: 90, kvb: 110, x: 1.35 } },
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
    koren: { Triode: { mu: 67.18, kg: 389.2, kp: 384.6, kvb: 6886, x: 1.12 } },
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
    koren: { Triode: { mu: 44.74, kg: 1364, kp: 250.4, kvb: 234.3, x: 1.23 } },
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
    koren: { Triode: { mu: 67.89, kg: 1670, kp: 519.8, kvb: 375.4, x: 1.22 } },
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
    koren: { Triode: { mu: 46.53, kg: 97.78, kp: 250, kvb: 100, x: 1.36 } },
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
    nameGost: "6П1П", nameWestern: "6P1P (6AQ5 / 6V6 Noval)", commonName: "6P1P",
    type: "Beam Power Tetrode", category: "power", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.50, heaterWarning: "Noval 9-pin equivalent of 6V6 / 6AQ5.",
    vaMax: 250, paMax: 12.0, ikMax: 55, vg2Max: 250,
    koren: {
      Pentode: { mu: 9.773, kg: 2801, kp: 87.19, kvb: 30, x: 1.46, kg2: 9656 },
      Ultralinear: { mu: 9.773, kg: 2801, kp: 87.19, kvb: 30, x: 1.46, kg2: 9656 },
      Triode: { mu: 9.35, kg: 2645, kp: 114.2, kvb: 0.00000297, x: 1.57 }
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
    nameGost: "6П6С", nameWestern: "6P6S (6V6-GT Equivalent)", commonName: "6P6S",
    type: "Beam Power Tetrode", category: "power", origin: "Soviet", socket: "Octal K8A", pinCount: 8,
    vh: 6.3, ih: 0.45, heaterWarning: "Octal Pins 2 & 7: 6.3V @ 0.45A.",
    vaMax: 350, paMax: 14.0, ikMax: 60, vg2Max: 310,
    isFavorite: true,
    koren: {
      Pentode: { mu: 10.71, kg: 2277, kp: 31.61, kvb: 45.92, x: 1.43, kg2: 7728 },
      Ultralinear: { mu: 10.71, kg: 2277, kp: 31.61, kvb: 45.92, x: 1.43, kg2: 7728 },
      Triode: { mu: 10.11, kg: 2503, kp: 31.49, kvb: 0.000002709, x: 1.57 }
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
      Pentode: { mu: 5.5, kg: 187.1, kp: 30, kvb: 22, x: 1.35, kg2: 802.3 },
      Ultralinear: { mu: 5.5, kg: 187.1, kp: 30, kvb: 22, x: 1.35, kg2: 802.3 },
      Triode: { mu: 5.266, kg: 168.1, kp: 32.44, kvb: 0.000003127, x: 1.43 }
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
    nameGost: "6С33С-В", nameWestern: "6S33S-V (Foxbat Power Triode)", commonName: "6S33S-V",
    type: "Giant Low-Rp Triode", category: "power", origin: "Soviet", socket: "Septar 7-pin Giant", pinCount: 7,
    vh: 6.3, ih: 6.60, heaterWarning: "EXTREME CURRENT: Dual heaters draw 6.6A @ 6.3V! Internal Rp ~ 80 Ohms.",
    vaMax: 450, paMax: 60.0, ikMax: 600, vg2Max: 0,
    isFavorite: true,
    koren: { Triode: { mu: 2.875, kg: 528.2, kp: 38.7, kvb: 56.42, x: 1.6 } },
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
    koren: { Triode: { mu: 6.422, kg: 860.9, kp: 65.63, kvb: 220, x: 1.35 } },
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
      Pentode: { mu: 10.71, kg: 2277, kp: 31.61, kvb: 45.92, x: 1.43, kg2: 7728 },
      Ultralinear: { mu: 10.71, kg: 2277, kp: 31.61, kvb: 45.92, x: 1.43, kg2: 7728 },
      Triode: { mu: 10.11, kg: 2503, kp: 31.49, kvb: 0.000004095, x: 1.57 }
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
      Pentode: { mu: 8.798, kg: 3329, kp: 25.99, kvb: 72.64, x: 1.63, kg2: 16620 },
      Ultralinear: { mu: 8.798, kg: 3329, kp: 25.99, kvb: 72.64, x: 1.63, kg2: 16620 },
      Triode: { mu: 8.045, kg: 4998, kp: 26.31, kvb: 2.067e-22, x: 1.8 }
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
    koren: { Triode: { mu: 4.179, kg: 1239, kp: 64.76, kvb: 176.5, x: 1.34 } },
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
    koren: { Triode: { mu: 5.657, kg: 2679, kp: 60.16, kvb: 239.9, x: 1.36 } },
    pinout: [
      { pin: 1, sym: "F+", role: "Filament (+)", isHeater: true, isCathode: true },
      { pin: 2, sym: "A", role: "Plate (1000V+)", isPlate: true },
      { pin: 3, sym: "G", role: "Control Grid", isGrid: true },
      { pin: 4, sym: "F-", role: "Filament (-)", isHeater: true, isCathode: true }
    ]
  },
  // ---------------- Additional Rectifiers ----------------
  {
    nameGost: "6Ц4П", nameWestern: "6Ts4P / 6X4 Equivalent", commonName: "6Ts4P",
    type: "Full-Wave Miniature Rectifier", category: "rectifier", origin: "Soviet", socket: "Noval B9A", pinCount: 9,
    vh: 6.3, ih: 0.60, heaterWarning: "Noval 9-pin rectifier. 6.3V @ 0.6A.",
    vaMax: 450, paMax: 0, ikMax: 75, vg2Max: 0,
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
  }
];
