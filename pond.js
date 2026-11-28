/*
 * ASCII Koi: a koi pond drawn in character cells.
 *
 * Each koi is a chain of spine nodes that trails its head, plus a travelling
 * body wave. Every character cell is sampled against the nearest point on the
 * spine (with sub-samples for soft edges), classified as body, fin, eye or
 * barbel, coloured by the fish's markings, and shaded by a light from the
 * upper left: light skin gets sparse glyphs, shadowed skin dense ones. Koi cast
 * a shadow on the pond floor and leave a short wake.
 *
 * Left click: a black cat paw reaches in from the nearer edge, dips, hooks the
 * water back in two tugs and flicks out with a spray of drops. The koi scatter;
 * a moment later the curious ones swim back to look.
 * Right click (or a long press): a handful of fish food. The pellets land with
 * small rings and float; the hungry koi rise and race over to eat them.
 *
 * The simulation only moves forward in fixed steps from time, so the same
 * events give the same pond. A page runs it live (start); a film seeks it to
 * any time (seek) and gets the same frame every time.
 *
 * Technique informed by stackedlol/ascii-sharks (MIT) and daoho.dev; the code
 * is written for this project. MIT licence.
 */
(function (global) {
  "use strict";

  /* ── small maths ── */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const lerp = (a, b, e) => a + (b - a) * e;
  const h2 = (a, b) => { let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); x = Math.imul(x ^ (x >>> 15), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y, seed) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = sstep(0, 1, x - xi), v = sstep(0, 1, y - yi);
    const a = h2(xi + seed * 131, yi), b = h2(xi + 1 + seed * 131, yi), c = h2(xi + seed * 131, yi + 1), d = h2(xi + 1 + seed * 131, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  const rgb = hex => { const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const pack = c => (clamp(c[0] | 0, 0, 255) << 16) | (clamp(c[1] | 0, 0, 255) << 8) | clamp(c[2] | 0, 0, 255);
  const css = n => `rgb(${n >> 16},${(n >> 8) & 255},${n & 255})`;
  const MONO = `"Geist Mono", ui-monospace, Menlo, monospace`;

  /* Deterministic randomness, so the pond looks the same on every load. */
  function seeded(str) {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }

  /* ── fish silhouettes: s runs from snout (0) to tail tip (1) ── */
  const SPECIES = {
    koi:    { wScale: 1.0,  bodyEnd: 0.76, tailSpread: 1.0,  finReach: 1.0,  finWidth: 1.0,  barbel: 0.05 },
    ryukin: { wScale: 1.48, bodyEnd: 0.65, tailSpread: 1.55, finReach: 1.45, finWidth: 1.4,  barbel: 0 },
    turtle: { wScale: 1.0,  bodyEnd: 0.74, tailSpread: 0.25, finReach: 1.35, finWidth: 1.5,  barbel: 0 },
    /* butterfly koi: the same body with long, flowing fins and a wide tail */
    butterfly: { wScale: 0.95, bodyEnd: 0.72, tailSpread: 1.7, finReach: 1.9, finWidth: 1.5, barbel: 0.07 }
  };
  const halfW = (s, sp = SPECIES.koi) => {
    if (sp === SPECIES.turtle) {
      if (s < 0.16) return 0.098 * Math.pow(Math.sin((s / 0.16) * Math.PI), 0.55);
      if (s <= 0.74) return 0.04 + 0.24 * Math.pow(Math.sin(((s - 0.16) / 0.58) * Math.PI), 0.55);
      return 0;
    }
    return (
      s < 0.1 ? 0.118 * Math.pow(Math.sin(s / 0.1 * Math.PI / 2), 0.6)
      : s < 0.3 ? 0.118 + 0.02 * sstep(0.1, 0.3, s)
      : 0.03 + 0.108 * (1 - sstep(0.3, sp.bodyEnd, s))
    ) * sp.wScale;
  };
  const tailW = (s, sp = SPECIES.koi) => (0.028 + 0.165 * Math.pow(sstep(sp.bodyEnd - 0.04, 1, s), 0.85)) * sp.tailSpread;
  const hit = { kind: 0, across: 0, rs: 1, ra: 0 };
  /* fin: an ellipse leaning back from a root on the body's edge */
  function fin(s, a, rootS, angle, reach, width, sp) {
    const ra = halfW(rootS, sp) * 0.85, ca = Math.cos(angle), sa = Math.sin(angle);
    const ds = s - rootS, da = a - ra;
    const along = ds * ca + da * sa - reach, perp = -ds * sa + da * ca;
    if ((along / reach) ** 2 + (perp / width) ** 2 > 1) return false;
    hit.kind = 2; hit.rs = ds; hit.ra = da;
    return true;
  }
  /* a limb is a fin that is solid skin, as on a turtle */
  function limb(s, a, rootS, angle, reach, width, sp) {
    if (!fin(s, a, rootS, angle, reach, width, sp)) return false;
    hit.kind = 1; hit.across = -0.5;
    return true;
  }
  /* 1 body, 2 fin, 3 eye, 4 ridge, 5 barbel */
  function classify(s, a, past, flare, ahead, lateral, sp = SPECIES.koi) {
    hit.kind = 0; hit.across = 1; hit.rs = 1; hit.ra = 0;
    if (ahead > 0) {
      if (sp.barbel > 0 && ahead < sp.barbel && Math.abs(lateral - (0.042 + ahead * 0.75)) < 0.015) { hit.kind = 5; return true; }
      return false;
    }
    const w = halfW(s, sp);
    if (sp === SPECIES.turtle) {
      if (s <= 0.74 && a <= w) {
        const ac = a / (w || 1);
        hit.across = ac;
        hit.kind = s > 0.034 && s < 0.076 && ac > 0.4 && ac < 0.8 ? 3 : s > 0.24 && s < 0.66 && ac < 0.1 ? 4 : 1;
        /* a face: a red patch behind each eye, a pale beak at the snout */
        if (hit.kind === 1 && s < 0.17) { if (s > 0.08 && s < 0.115 && ac > 0.45 && ac < 0.92) hit.kind = 6; else if (s < 0.032 && ac < 0.5) hit.kind = 7; }
        /* head and neck are skin, not shell (a negative `across` marks skin: head, legs, tail) */
        if (s < 0.17 && hit.kind !== 3) hit.across = -0.5;
        return true;
      }
      if (s > 0.72 && s <= 0.92 && past <= 0 && a <= 0.04 * (1 - (s - 0.72) / 0.2)) { hit.kind = 1; hit.across = -0.5; return true; }
      /* four legs: the front pair reach forward and out, the back pair sweep behind; they paddle with the scull */
      return limb(s, a, 0.22, 2.05 + 0.35 * (flare - 1), 0.115 * flare, 0.05, sp)
          || limb(s, a, 0.60, 1.15 - 0.3 * (flare - 1), 0.085, 0.045, sp);
    }
    if (s <= sp.bodyEnd && a <= w) {
      hit.across = a / w;
      hit.kind = s > 0.056 && s < 0.084 && hit.across > 0.5 && hit.across < 0.78 ? 3 : s > 0.3 && s < sp.bodyEnd * 0.78 && hit.across < 0.13 ? 4 : 1;
      return true;
    }
    if (s > sp.bodyEnd - 0.06 && past <= 0) {
      const tw = tailW(s, sp) * flare;
      if (a <= tw && s <= 0.88 + 0.12 * (a / tw)) { hit.kind = 2; hit.rs = 1; hit.ra = (a / tw) * 0.8; return true; }
    }
    return fin(s, a, 0.2, 0.9 + 0.45 * (flare - 1), 0.07 * flare * sp.finReach, 0.038 * sp.finWidth, sp)
        || fin(s, a, 0.47, 0.75, 0.038 * sp.finReach, 0.019 * sp.finWidth, sp);
  }

  /* ── markings: kohaku, sanke, tancho, showa, asagi, ogon, turtle ── */
  function markings(variety, seed) {
    const r = j => h2(seed, j);
    if (variety === "ogon" || variety === "asagi" || variety === "turtle") return { red: [], black: [] };
    /* bekko: a plain body with bold black spots and no red */
    if (variety === "bekko") {
      const black = [];
      for (let j = 0; j < 5 + Math.floor(r(50) * 3); j++) black.push({ s: 0.2 + r(60 + j) * 0.46, v: (r(70 + j) - 0.5) * 0.12, rs: 0.04 + r(80 + j) * 0.025, rv: 0.05 + r(90 + j) * 0.02 });
      return { red: [], black };
    }
    if (variety === "tancho") return { red: [{ s: 0.1, v: 0, rs: 0.052, rv: 0.06 }], black: [] };
    const red = [];
    if (r(1) < 0.85) red.push({ s: 0.09, v: (r(2) - 0.5) * 0.03, rs: 0.05 + r(3) * 0.03, rv: 0.1 });
    /* Saddles of uneven length step from side to side, with white between them and on the flanks, so no koi reads as one solid colour or as stripes. */
    const n = r(4) < 0.25 ? 3 : 2, GAP = 0.05, w = [];
    for (let j = 0; j < n; j++) w.push(0.5 + r(30 + j));
    const unit = (0.45 - GAP * (n - 1)) / w.reduce((a, b) => a + b);
    let at = 0.23;
    for (let j = 0; j < n; j++) {
      const rs = unit * w[j] / 2;
      red.push({ s: at + rs, v: (j % 2 ? 1 : -1) * (0.022 + r(20 + j) * 0.018), rs: rs * 0.95, rv: 0.065 + rs * 0.3 + r(40 + j) * 0.02 });
      at += rs * 2 + GAP;
    }
    const black = [];
    if (variety === "sanke" || variety === "showa" || variety === "goshiki") {
      for (let j = 0; j < 4 + Math.floor(r(50) * 3); j++) black.push({ s: 0.25 + r(60 + j) * 0.42, v: (r(70 + j) - 0.5) * 0.15, rs: variety === "showa" ? 0.045 : variety === "goshiki" ? 0.03 : 0.021, rv: variety === "showa" ? 0.055 : variety === "goshiki" ? 0.034 : 0.025 });
    }
    return { red, black };
  }
  const inPatch = (m, s, vn, wob) => ((s - m.s) / m.rs) ** 2 + ((vn - m.v) / m.rv) ** 2 < 1 + wob;
  function skin(f, s, vn, across) {
    if (f.variety === "turtle") {
      if (across < 0 || across > 0.8) return 1;
      /* carapace: a spine of five scutes, four pairs either side, offset by half a scute, tones alternating like a patchwork */
      const ss = (s - 0.16) / 0.58, zone = across < 0.36 ? 0 : 1, idx = zone ? Math.floor(ss * 4 + (vn > 0 ? 0.5 : 0)) : Math.floor(ss * 5);
      return (zone + idx) & 1 ? 2 : 0;
    }
    if (f.variety === "ogon") return 1;
    if (f.variety === "asagi") return across < 0.58 && s < f.sp.bodyEnd * 0.92 ? 2 : 1;
    if (f.variety === "utsuri" && (across > 0.9 || s > f.sp.bodyEnd - 0.02)) return 2;
    if (across > 0.9 || s > f.sp.bodyEnd - 0.02) return 0;
    const wob = (noise(s * 13 + f.seed, vn * 28, f.seed) - 0.5) * 0.65;
    if (f.variety === "bekko") {
      for (const m of f.marks.black) if (inPatch(m, s, vn, wob)) return 2;
      return f.seed % 3 === 1 ? 1 : 0;
    }
    if (f.variety === "goshiki") {
      for (const m of f.marks.black) if (inPatch(m, s, vn, wob)) return 2;
      for (const m of f.marks.red) if (inPatch(m, s, vn, wob)) return 1;
      /* the five colours: red and black, white, and a net of slate-blue over the rest */
      return noise(s * 24 + f.seed, vn * 55, f.seed + 9) > 0.5 ? 3 : 0;
    }
    if (f.variety === "utsuri") {
      for (const m of f.marks.red) if (inPatch(m, s, vn, wob)) return f.seed & 1 ? 0 : 1;
      return 2;
    }
    if (f.variety === "showa") {
      for (const m of f.marks.red) if (inPatch(m, s, vn, wob)) return 1;
      for (const m of f.marks.black) if (inPatch(m, s, vn, wob)) return 0;
      return 2;
    }
    for (const m of f.marks.black) if (inPatch(m, s, vn, wob)) return 2;
    for (const m of f.marks.red) if (inPatch(m, s, vn, wob)) return 1;
    return 0;
  }

  /*
   * Fourteen curated pond inhabitants: koi (kohaku, sanke, tancho, showa, asagi, ogon),
   * fancy goldfish (ryukin), and small pond turtles.
   */
  const ROSTER = [
    { species: "koi",       variety: "kohaku",  colour: "course" },
    { species: "ryukin",    variety: "ogon",    colour: "vermilion" },
    { species: "koi",       variety: "sanke",   colour: "vermilion" },
    { species: "turtle",    variety: "turtle",  colour: "turtle" },
    { species: "butterfly", variety: "kohaku",  colour: "sakura" },
    { species: "koi",       variety: "showa",   colour: "course" },
    { species: "koi",       variety: "goshiki", colour: "course" },
    { species: "koi",       variety: "bekko",   colour: "gold" },
    { species: "koi",       variety: "utsuri",  colour: "vermilion" },
    { species: "koi",       variety: "asagi",   colour: "asagi" },
    { species: "ryukin",    variety: "kohaku",  colour: "course" },
    { species: "koi",       variety: "tancho",  colour: "vermilion" },
    { species: "butterfly", variety: "sanke",   colour: "vermilion" },
    { species: "turtle",    variety: "turtle",  colour: "turtle" },
    { species: "koi",       variety: "sanke",   colour: "sakura" },
    { species: "koi",       variety: "ogon",    colour: "gold" },
    { species: "koi",       variety: "utsuri",  colour: "gold" },
    { species: "koi",       variety: "kohaku",  colour: "sakura" },
    { species: "koi",       variety: "sanke",   colour: "course" }
  ];
  const VARIETY = ROSTER;
  /* the most one joint of a koi turns from the one in front of it, in radians */
  const BEND = 0.42;
  /* More koi in a bigger pond, by width or by area, up to `most` (opts.most; fourteen unless a host asks for more). */
  const room = (w, h, most) => clamp(Math.max(w / 210, w * h / 85000), 3, most);
  const entryOf = i => ROSTER[i % ROSTER.length];

  /*
   * The paw's keyframes [time, value, ease into it]: o eases out, i eases in,
   * l is linear, anything else eases both ways.
   */
  const EASE = { o: u => 1 - (1 - u) ** 2.2, i: u => u ** 2.2, l: u => u };
  function track(a, keys) {
    if (a <= keys[0][0]) return keys[0][1];
    for (let j = 1; j < keys.length; j++) {
      const [t1, v1, e] = keys[j];
      if (a > t1) continue;
      const [t0, v0] = keys[j - 1], u = (a - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (EASE[e] || (x => x * x * (3 - 2 * x)))(u);
    }
    return keys[keys.length - 1][1];
  }
  const DIP = 0.24, PULL = 0.42, FLICK = 0.72, SHAKE = 0.78, END = 1.25, RING_LIFE = 2.6, DROP_LIFE = 1.2;
  /* The whole catch, channel by channel (time in seconds): in a little past the spot, dip, curl, tug, tug, flick, away. */
  const BACK = [[0, 70], [0.17, -4, "o"], [DIP, 0], [PULL, 0, "l"], [0.52, 13], [0.57, 12], [0.68, 27], [FLICK, 29], [END, 84, "i"]];
  const HIGH = [[0, 0.5], [0.17, 0.15, "o"], [DIP, 0, "i"], [FLICK - 0.02, 0, "l"], [0.86, 0.6, "o"], [END, 1.05]];
  const SWAY = [[0, 0.06], [0.17, -0.02, "o"], [0.3, 0], [0.52, 0.03], [0.68, -0.03], [FLICK, 0], [END, 0]];
  const CURL = [[0, 0], [0.27, 0.05], [0.38, 1, "o"], [0.52, 1, "l"], [0.56, 0.75], [0.6, 1], [FLICK, 1, "l"], [0.95, 0.5], [END, 0.3]];
  const SINK = [[0.2, 0], [0.3, 1, "o"], [0.68, 1, "l"], [FLICK + 0.04, 0, "o"]];
  const SQUASH = [[0, -0.12], [0.17, -0.18, "l"], [0.22, 0.2, "o"], [0.3, 0], [0.44, 0.12], [0.52, -0.1], [0.58, 0.1], [0.68, -0.12], [FLICK, -0.2], [0.86, 0.05], [END, 0]];
  const SEEN = [[0, 0], [0.06, 1, "o"], [1.1, 1, "l"], [END, 0]];
  /* the leg's radius, the round hand's radius, and where the four toes sit around its tip (radians) */
  const LEG = 8.4, HAND = 10, TOES = [-1.12, -0.38, 0.38, 1.12];
  /* Fish food: how long a pellet floats before it sinks out of sight, and how long it takes to sink. */
  const FLOAT = 16, SINKING = 2.5;
  const STEP = 1 / 60;

  /*
   * createPond({ canvas, palette, width?, height?, dpr?, dim?, reduce? })
   * palette() returns the colours: { water, ink, accent, koiLight, koiDark, dark }
   * dim() returns the title's box in canvas pixels, or null: the koi fade under it, and the letters take on their colour.
   */
  function createPond(opts) {
    const canvas = opts.canvas, ctx = canvas.getContext("2d");
    const reduce = !!opts.reduce;
    const MOST = Math.max(3, Math.round(opts.most || VARIETY.length));
    const N = 10, RAMP = " .:-=+*#%@", SUB = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
    let vw = 0, vh = 0, dpr = 1, cw = 10, ch = 13, cols = 0, rows = 0, K = 1.85;
    let t = 0, simT = 0, paused = false;
    let P = null;
    let tileRGB, tileA, glyphRGB, glyphA, glyphCode, shade, wake, wakeTmp, tintRGB, tintA;
    const touched = [];
    let fish = [];
    const paws = [], rings = [], drops = [], food = [], bubbles = [], pads = [];
    /* events for a film: { at, fn } run when the simulation passes them */
    const plan = [];
    let planAt = 0;
    /* Caustics: two drifting noise fields; where they meet, light gathers in a thin moving net, as on a pool floor. */
    /* how visible the pond is at a point: the clear space under the title (set each frame) */
    let fadeAt = () => 1;

    /* ── what the host can change: quality, style (tiles or pure glyphs), weather, time of day ── */
    const QUALITY = [
      { name: "low",  ms: 33, fish: 0.55, cell: 1.3, caus: 0, fx: 0, dither: 0 },
      { name: "med",  ms: 16, fish: 0.85, cell: 1,   caus: 1, fx: 1, dither: 1 },
      { name: "high", ms: 12, fish: 1,    cell: 1,   caus: 1, fx: 2, dither: 1 }
    ];
    const QNAMES = ["auto", "low", "med", "high"];
    let qMode = QNAMES.includes(opts.quality) ? opts.quality : "auto";
    let qLevel = qMode === "auto" ? 2 : QNAMES.indexOf(qMode) - 1;
    let styleMode = opts.style === "glyph" ? "glyph" : "tile";
    let weatherMode = opts.weather || "auto", skyOn = opts.sky !== false;
    const Qn = () => QUALITY[qLevel];
    const glyphMode = () => styleMode === "glyph";

    /* ── caustics, cached: the net of light is worked out at 12 Hz for each cell, not for every cell of every frame ── */
    let causV = null, causStamp = -1;
    const causRaw = (x, y) => 1 - Math.min(1, Math.abs(noise(x / 46 + t * 0.21, y / 46 - t * 0.13, 7) - noise(x / 39 - t * 0.17, y / 52 + t * 0.19, 11)) * 5.5);
    const causAt = (x, y) => {
      if (!causV) return 0;
      const c = clamp(Math.floor(x / cw), 0, cols - 1), r = clamp(Math.floor(y / ch), 0, rows - 1);
      return causV[r * cols + c];
    };
    const caus = causAt;

    /* ── glyph atlas: each (character, colour) is drawn once into a sheet, then stamped with drawImage ── */
    let atlas = null, actx = null, aSlotW = 0, aSlotH = 0, aCols = 1, aRows = 1, aNext = 0;
    const aMap = new Map();
    function atlasInit() {
      aSlotW = Math.ceil(cw * dpr) + 4; aSlotH = Math.ceil(ch * dpr) + 4;
      aSlotW += aSlotW & 1; aSlotH += aSlotH & 1;
      aCols = Math.max(1, Math.floor(2048 / aSlotW)); aRows = Math.max(1, Math.floor(2048 / aSlotH));
      if (!atlas) atlas = document.createElement("canvas");
      atlas.width = aCols * aSlotW; atlas.height = aRows * aSlotH;
      actx = atlas.getContext("2d");
      aMap.clear(); aNext = 0;
    }
    /* a glyph centred on (x, y), in the colour rgb (24-bit, kept to 4 bits a channel), at the context's current alpha */
    function glyphAt(code, rgb, x, y) {
      const key = code * 4096 + (((rgb >> 20) & 15) << 8) + (((rgb >> 12) & 15) << 4) + ((rgb >> 4) & 15);
      let slot = aMap.get(key);
      if (slot === undefined) {
        if (aNext >= aCols * aRows) atlasInit();
        slot = aNext++; aMap.set(key, slot);
        const sx = (slot % aCols) * aSlotW, sy = ((slot / aCols) | 0) * aSlotH;
        actx.setTransform(1, 0, 0, 1, 0, 0);
        actx.clearRect(sx, sy, aSlotW, aSlotH);
        actx.font = `${glyphMode() ? 700 : 600} ${Math.round(ch * (glyphMode() ? 0.9 : 0.74) * dpr)}px ${MONO}`;
        actx.textAlign = "center"; actx.textBaseline = "middle";
        actx.fillStyle = `rgb(${((rgb >> 20) & 15) * 17},${((rgb >> 12) & 15) * 17},${((rgb >> 4) & 15) * 17})`;
        actx.fillText(String.fromCharCode(code), sx + aSlotW / 2, sy + aSlotH / 2);
      }
      const sx = (slot % aCols) * aSlotW, sy = ((slot / aCols) | 0) * aSlotH;
      ctx.drawImage(atlas, sx, sy, aSlotW, aSlotH, Math.round((x - aSlotW / (2 * dpr)) * dpr) / dpr, Math.round((y - aSlotH / (2 * dpr)) * dpr) / dpr, aSlotW / dpr, aSlotH / dpr);
    }
    /* the web font arrives late: sheets drawn in the fallback face are thrown away when it does */
    if (typeof document !== "undefined" && document.fonts) {
      try { document.fonts.ready && document.fonts.ready.then(() => { aMap.clear(); aNext = 0; if (atlas) atlasInit(); buildShapes(); }); } catch (e) { /* no font events */ }
    }

    /* ── time of day: [hour, tint, strength, daylight, night], blended between the hours ── */
    const hourNow = () => { if (opts.hour) return opts.hour(); const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
    const SKY = [
      [0, [16, 24, 58], 0.55, 0.06, 1], [5, [26, 32, 70], 0.5, 0.12, 0.95], [6.3, [226, 150, 130], 0.2, 0.55, 0.4], [8, [150, 206, 206], 0.08, 0.95, 0],
      [12, [170, 214, 206], 0.08, 1, 0], [16.5, [160, 204, 196], 0.08, 0.95, 0], [18.3, [226, 130, 100], 0.22, 0.6, 0.25], [19.6, [104, 72, 128], 0.32, 0.3, 0.7],
      [21.5, [18, 26, 62], 0.52, 0.1, 1], [24, [16, 24, 58], 0.55, 0.06, 1]
    ];
    function skyAt(h) {
      if (!skyOn) return { tint: [0, 0, 0], k: 0, day: 1, night: 0 };
      let j = 1;
      while (j < SKY.length - 1 && SKY[j][0] < h) j++;
      const a = SKY[j - 1], b = SKY[j], u = clamp((h - a[0]) / (b[0] - a[0]), 0, 1), e = u * u * (3 - 2 * u);
      return { tint: mixC(a[1], b[1], e), k: lerp(a[2], b[2], e), day: lerp(a[3], b[3], e), night: lerp(a[4], b[4], e) };
    }
    let skyState = skyAt(hourNow());
    /* a counter-based random source, so a film of the pond is the same every time */
    let rc = 0;
    const rnd = () => h2(rc++, 977);
    const rr = (a, b) => a + (b - a) * rnd();

    function padPos(p) {
      const k = K, shake = p.bob * Math.sin(t * 28 + p.phase) * 2.6 * k;
      return { x: p.nx * vw + shake, y: p.ny * vh + shake * 0.6, R: p.rad * k * (1 + 0.045 * p.bob), rot: p.notch };
    }

    function makePads() {
      const bothLotus = Math.random() < 0.45;
      const lotusIdx = Math.random() < 0.5 ? 0 : 1;
      const pickSpot = (other) => {
        for (let k = 0; k < 40; k++) {
          const nx = 0.08 + Math.random() * 0.84, ny = 0.08 + Math.random() * 0.84;
          if (nx > 0.28 && nx < 0.72 && ny > 0.26 && ny < 0.78) continue;
          if (other && Math.hypot(nx - other[0], ny - other[1]) < 0.36) continue;
          return [nx, ny];
        }
        return other ? [0.87, 0.74] : [0.12, 0.22];
      };
      const s0 = pickSpot(null), s1 = pickSpot(s0);
      pads.length = 0;
      [s0, s1].forEach(([nx, ny], i) => {
        const ang = Math.random() * Math.PI * 2, spd = 0.004 + Math.random() * 0.004;
        pads.push({
          nx, ny, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd * 0.75,
          rad: 36 + Math.random() * 10,
          notch: Math.random() * Math.PI * 2, vrot: (Math.random() - 0.5) * 0.04,
          phase: Math.random() * 6.28,
          lotus: i === lotusIdx || bothLotus,
          /* the flower: how open it is (0 bud, 1 bloom), its own slow rhythm, a white one now and then; and how the leaf bobs when a koi passes under */
          variant: i === 1 && Math.random() < 0.5 ? 1 : 0, open: 1, per: 70 + Math.random() * 50, cyc: Math.random() * 6.28,
          bob: 0, bobV: 0, ringAt: 0, nextPetal: 6 + Math.random() * 8, spr: null
        });
      });
    }
    function stepPads(dt) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        /* the flower opens with the day and breathes between bud and bloom on its own rhythm; it closes at night */
        if (p.lotus) {
          /* lotus stays in full bloom always — no bud or partial-open phase */
          const was = p.open;
          p.open = clamp(p.open + clamp(1 - p.open, -dt * 0.18, dt * 0.18), 0, 1);
          p.nextPetal -= dt;
          if (p.open > 0.8 && p.nextPetal <= 0) { p.nextPetal = 7 + rnd() * 12; shedPetal(p); }
          if (was > 0.85 && p.open <= 0.85 && p.open < was) { shedPetal(p); shedPetal(p); }
        }
        /* a koi passing under or frog landing makes the leaf rock & shake */
        const pp = padPos(p);
        let near = 0;
        for (const f of fish) {
          if (!(f.seen > 0.5)) continue;
          const d = Math.hypot(headX(f) - pp.x, headY(f) - pp.y), n = clamp(1 - d / (pp.R * 1.15), 0, 1) * (0.4 + f.beat);
          if (n > near) { near = n; }
        }
        p.bobV += (near * 3.2 - p.bob * 12 - p.bobV * 2.8) * dt; p.bob += p.bobV * dt;
        if (near > 0.5 && t - p.ringAt > 1.6) { p.ringAt = t; rings.push({ x: pp.x + (rnd() - 0.5) * pp.R, y: pp.y + (rnd() - 0.5) * pp.R * 0.8, born: t, k: K * 0.55, small: true }); }
      }
    }
    function makeFish() {
      const offX = Math.random(), offY = Math.random();
      fish = Array.from({ length: MOST }, (_, i) => entryOf(i)).map(({ species, variety, colour }, i) => {
        const sp = SPECIES[species] || SPECIES.koi;
        const a = Math.random() * Math.PI * 2;
        const L0 = species === "ryukin" ? 90 + Math.random() * 24
          : species === "butterfly" ? 118 + Math.random() * 34
          : species === "turtle" ? 86 + Math.random() * 18
          : 128 + Math.random() * 52;
        const seg = L0 / (N - 1);
        const nodes = new Float32Array(N * 2);
        for (let j = 0; j < N; j++) { nodes[j * 2] = -Math.cos(a) * seg * j; nodes[j * 2 + 1] = -Math.sin(a) * seg * j; }
        const seed = Math.floor(Math.random() * 100000);
        const cruise = species === "ryukin" ? 18 + Math.random() * 8
          : species === "turtle" ? 13 + Math.random() * 5
          : 24 + Math.random() * 12;
        const depth = species === "turtle" ? 0.55 + Math.random() * 0.4
          : 0.35 + Math.random() * 0.65;
        return {
          species, sp, variety, colour, seen: 1, seed, marks: markings(variety, seed), a, nodes, seg, L0,
          cruise, nx: (offX + i * 0.61803398875 + Math.random() * 0.08) % 1,
          ny: 0.08 + ((offY + i * 0.38196601125 + Math.random() * 0.08) % 0.84),
          depth, phase: Math.random() * 6.28,
          beat: 0.5, turn: 0, flee: 0, fleeA: 0, seekX: 0, seekY: 0, seekFrom: 0, seekUntil: 0,
          /* feeding: how keen, how far it notices food, when it may eat again, how close to the surface */
          appetite: h2(seed, 5), fullUntil: 0, rise: 0, kick: 0, meal: null
        };
      });
    }

    function size(w, h) {
      dpr = opts.dpr ? opts.dpr() : Math.min(4, global.devicePixelRatio || 1);
      vw = w; vh = h;
      cw = clamp(Math.round(vw / 150 * Qn().cell), 7, 12); ch = cw + 3; K = 1.85 * clamp(vw / 1000, 0.62, 1);
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      cols = Math.ceil(vw / cw); rows = Math.ceil(vh / ch);
      const n = cols * rows;
      tileRGB = new Uint32Array(n); tileA = new Float32Array(n); glyphRGB = new Uint32Array(n); glyphA = new Float32Array(n);
      glyphCode = new Uint16Array(n); shade = new Float32Array(n); wake = new Float32Array(n); wakeTmp = new Float32Array(n);
      tintRGB = new Uint32Array(n); tintA = new Float32Array(n);
      touched.length = 0;
      causV = null; causStamp = -1; atlasInit(); buildShapes();
      for (const p of pads) p.spr = null;
      if (P) buildDecor();
    }
    const count = () => Math.max(2, Math.round(room(vw, vh, MOST) * Qn().fish));
    const headX = f => f.nx * vw, headY = f => f.ny * vh;

    function stamp(x, y, rad, amt) {
      const c = Math.floor(x / cw), r = Math.floor(y / ch);
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        const cc = c + dc, rr = r + dr, d = Math.hypot(dc, dr * ch / cw);
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows || d > rad) continue;
        wake[rr * cols + cc] = Math.min(1, wake[rr * cols + cc] + amt * (1 - d / (rad + 1)));
      }
    }

    /* The nearest pellet this koi can see; pellets other koi already chose count as farther, so the shoal spreads out over the food. */
    function mealFor(f, list, hx, hy) {
      if (f.appetite < 0.18 || t < f.fullUntil) return null;
      let best = null, bd = (240 + 320 * f.appetite) * K;
      for (const p of list) {
        const d = Math.hypot(p.x - hx, p.y - hy) + p.claim * 60 * K;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) best.claim++;
      return best;
    }

    function eat(p, f) {
      p.eaten = t;
      f.fullUntil = t + 0.3 + 0.5 * h2(f.seed, Math.round(t * 10));
      f.kick = 1;
      rings.push({ x: p.x, y: p.y, born: t, k: K * 0.7, small: true });
      stamp(p.x, p.y, 1, 0.6);
      for (let j = 0; j < 3; j++) bubbles.push({ x: p.x + (h2(p.seed, j) - 0.5) * 14 * K, y: p.y + (h2(p.seed, j + 9) - 0.5) * 10 * K, born: t + j * 0.09 });
    }

    function step(dt) {
      const zw = Math.max(1, vw), zh = Math.max(1, vh), k = K;
      const maxTilt = 1.0, yLo = 0.08, yHi = 1 - yLo, sepR = 115 * k;
      const menu = food.filter(p => p.eaten < 0 && t > p.land - 0.25 && t - p.land < FLOAT);
      for (const p of menu) p.claim = 0;
      const n = count();
      fish.forEach((f, i) => {
        /* A koi that comes or goes as the window is resized fades over half a second. */
        const want = i < n ? 1 : 0;
        f.seen = clamp(f.seen + Math.sign(want - f.seen) * dt * 2, Math.min(f.seen, want), Math.max(f.seen, want));
        const right = Math.cos(f.a) > 0, base = right ? 0 : Math.PI;
        f.beat = 0.5 + 0.5 * Math.sin(t * 0.45 + f.seed);
        let turn = Math.sin(t * 0.29 + f.seed) * 0.32 + Math.sin(t * 0.11 + f.seed * 1.7) * 0.22;
        if (f.ny < yLo) turn += right ? 0.7 : -0.7;
        if (f.ny > yHi) turn += right ? -0.7 : 0.7;
        const hx = headX(f), hy = headY(f);
        /* Gentle separation so a larger shoal spreads across the pond instead of clustering. */
        if (i < n) {
          let sx = 0, sy = 0;
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const o = fish[j];
            let dx = hx - headX(o), dy = hy - headY(o);
            if (dx > zw * 0.5) dx -= zw; else if (dx < -zw * 0.5) dx += zw;
            const d = Math.hypot(dx, dy);
            if (d > 1 && d < sepR) { const w = (1 - d / sepR) / d; sx += dx * w; sy += dy * w; }
          }
          if (sx || sy) {
            const away = Math.atan2(sy, sx);
            const diff = Math.atan2(Math.sin(away - f.a), Math.cos(away - f.a));
            turn += clamp(diff * 1.4, -1.2, 1.2);
          }
        }
        const tilt = Math.atan2(Math.sin(f.a - base), Math.cos(f.a - base));
        if (Math.abs(tilt) > maxTilt) turn -= Math.sign(tilt) * 1.4;
        f.turn = lerp(f.turn, turn, Math.min(1, dt * 2));
        /* A paw hit the water: dart away from it. Food: rise and race to it. Later the curious ones swim back to look. */
        let hurry = 1;
        f.meal = null;
        if (f.flee > 0.02) {
          const d = Math.atan2(Math.sin(f.fleeA - f.a), Math.cos(f.fleeA - f.a));
          f.turn = lerp(f.turn, clamp(d * 5, -4, 4), Math.min(1, dt * 8 * f.flee));
          hurry = 1 + 2.6 * f.flee;
          f.flee *= Math.exp(-1.3 * dt);
        } else if (menu.length && (f.meal = mealFor(f, menu, hx, hy))) {
          const p = f.meal, dist = Math.hypot(p.x - hx, p.y - hy);
          const d = Math.atan2(Math.sin(Math.atan2(p.y - hy, p.x - hx) - f.a), Math.cos(Math.atan2(p.y - hy, p.x - hx) - f.a));
          f.turn = lerp(f.turn, clamp(d * 3.6, -3.4, 3.4), Math.min(1, dt * 7));
          /* fast from afar, slower close in so it can turn onto the pellet */
          hurry = 1.2 + 1.3 * clamp(dist / (150 * k), 0, 1) * (Math.abs(d) < 1.1 ? 1 : 0.45);
          f.rise = Math.min(1, f.rise + dt * 1.6);
        } else if (t > f.seekFrom && t < f.seekUntil) {
          if (Math.hypot(f.seekX - hx, f.seekY - hy) < 26 * k) f.seekUntil = 0;
          else {
            const d = Math.atan2(Math.sin(Math.atan2(f.seekY - hy, f.seekX - hx) - f.a), Math.cos(Math.atan2(f.seekY - hy, f.seekX - hx) - f.a));
            f.turn = lerp(f.turn, clamp(d * 2.6, -2.4, 2.4), Math.min(1, dt * 3));
            hurry = 1.4;
          }
        }
        if (!f.meal) f.rise = Math.max(0, f.rise - dt * 0.3);
        hurry *= 1 + 0.9 * f.kick;
        f.kick *= Math.exp(-3.5 * dt);
        f.a += f.turn * dt;
        const speed = f.cruise * (0.65 + 0.7 * f.beat) * hurry;
        const dx = Math.cos(f.a) * speed * dt, dy = Math.sin(f.a) * speed * dt;
        f.nx += dx * k / zw;
        f.ny += dy * k / zh;
        /*
         * The head stays at the origin; the rest of the chain trails it. No joint
         * bends further than BEND, so a startled koi curls into a C and the tail
         * swings round after the head instead of folding the body over itself.
         */
        const nd = f.nodes;
        for (let j = 1; j < N; j++) { nd[j * 2] -= dx; nd[j * 2 + 1] -= dy; }
        let bx = -Math.cos(f.a), by = -Math.sin(f.a);
        for (let j = 1; j < N; j++) {
          const px = nd[(j - 1) * 2], py = nd[(j - 1) * 2 + 1];
          let vx = nd[j * 2] - px, vy = nd[j * 2 + 1] - py;
          const d = Math.hypot(vx, vy) || 1; vx /= d; vy /= d;
          const bend = Math.atan2(bx * vy - by * vx, bx * vx + by * vy);
          if (Math.abs(bend) > BEND) { const r = Math.sign(bend) * BEND, c = Math.cos(r), s = Math.sin(r); vx = bx * c - by * s; vy = bx * s + by * c; }
          nd[j * 2] = px + vx * f.seg; nd[j * 2 + 1] = py + vy * f.seg;
          bx = vx; by = vy;
        }
        f.phase += dt * (2.6 + 5 * f.beat) * (1 + 0.6 * f.kick);
        const m = (f.L0 * k * 1.45) / zw;
        if (f.nx > 1 + m) f.nx = -m;
        if (f.nx < -m) f.nx = 1 + m;
        /* the mouth reaches the pellet: one gulp */
        if (f.meal && Math.hypot(f.meal.x - headX(f), f.meal.y - headY(f)) < 14 * k) eat(f.meal, f);
        /* wake from the tail */
        if (f.seen > 0) {
          const tc = Math.floor((headX(f) + nd[(N - 1) * 2] * k) / cw), tr = Math.floor((headY(f) + nd[(N - 1) * 2 + 1] * k) / ch);
          if (tc >= 0 && tr >= 0 && tc < cols && tr < rows) wake[tr * cols + tc] = Math.min(1, wake[tr * cols + tc] + 0.18 * f.beat * dt * 30);
        }
      });
      /* wake: spreads a little and fades, the edge cells too: a neighbour beyond the edge counts as the cell
         itself, so a wake left by a koi passing the edge fades like any other instead of piling up there */
      const fade = Math.exp(-dt * 1.4);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, w = wake[i];
        const n = (c > 0 ? wake[i - 1] : w) + (c < cols - 1 ? wake[i + 1] : w) + (r > 0 ? wake[i - cols] : w) + (r < rows - 1 ? wake[i + cols] : w);
        wakeTmp[i] = (w * 0.84 + n * 0.04) * fade;
      }
      [wake, wakeTmp] = [wakeTmp, wake];
    }

    /* ── rasterising one koi into the cell buffers ── */
    const spine = new Float32Array(N * 2), arc = new Float32Array(N);
    let arcTotal = 1, S = 0, V = 0, D = 0, TX = 1, TY = 0, SEG = 0;
    function sample(px, py, L, flareL, flareR, sp, from = 0, to = N - 2) {
      let best = Infinity, bs = 0, sign = 1, past = 0, ahead = 0, lateral = 0;
      for (let n = from; n <= to; n++) {
        const ax = spine[n * 2], ay = spine[n * 2 + 1], sx = spine[n * 2 + 2] - ax, sy = spine[n * 2 + 3] - ay;
        const len2 = sx * sx + sy * sy || 1, raw = ((px - ax) * sx + (py - ay) * sy) / len2, u = clamp(raw, 0, 1);
        const d2 = (px - ax - sx * u) ** 2 + (py - ay - sy * u) ** 2;
        if (d2 < best) {
          const len = Math.sqrt(len2), cross = sx * (py - ay) - sy * (px - ax);
          best = d2; bs = (arc[n] + u * len) / arcTotal; sign = cross >= 0 ? 1 : -1;
          past = n === N - 2 ? Math.max(0, raw - 1) * len : 0;
          ahead = n === 0 ? Math.max(0, -raw) * len : 0;
          lateral = Math.abs(cross) / len; TX = sx / len; TY = sy / len; SEG = n;
        }
      }
      D = Math.sqrt(best); S = bs; V = D * sign;
      return classify(bs, D / L, past / L, sign > 0 ? flareL : flareR, ahead / L, lateral / L, sp);
    }
    const lineGlyph = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; return Math.abs(dy) < 0.38 * d ? "-" : Math.abs(dx) < 0.38 * d ? "|" : dx * dy > 0 ? "\\" : "/"; };

    /* ── shape-matched characters: each candidate is measured on a 2×3 grid of the cell, so an edge cell can take the glyph whose ink lies where the fish does ── */
    const CAND = ".,'`:;-_=~+*|/\\()<>^vo!i[]";
    let shapes = null;
    function buildShapes() {
      shapes = null;
      try {
        const cv = document.createElement("canvas"), W = Math.max(4, Math.round(cw)), H = Math.max(4, Math.round(ch));
        cv.width = W; cv.height = H;
        const g = cv.getContext("2d", { willReadFrequently: true });
        g.font = `${glyphMode() ? 700 : 600} ${Math.round(ch * (glyphMode() ? 0.9 : 0.74))}px ${MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
        const out = [];
        for (const chr of CAND) {
          g.clearRect(0, 0, W, H); g.fillStyle = "#000"; g.fillText(chr, W / 2, H / 2);
          const d = g.getImageData(0, 0, W, H).data, v = new Float32Array(6);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = d[(y * W + x) * 4 + 3]; if (a) v[Math.min(2, (y * 3 / H) | 0) * 2 + Math.min(1, (x * 2 / W) | 0)] += a; }
          let mx = 0;
          for (let j = 0; j < 6; j++) mx = Math.max(mx, v[j]);
          if (mx < 1) continue;
          for (let j = 0; j < 6; j++) v[j] /= mx;
          out.push({ c: chr.charCodeAt(0), v });
        }
        shapes = out.length > 6 ? out : null;
      } catch (e) { shapes = null; }
    }
    /* the glyph whose ink best fits the part of the cell that is covered (ink outside it counts for more) */
    function matchGlyph(bits) {
      let best = 46, bs = 1e9;
      for (const sh of shapes) {
        let e = 0;
        for (let j = 0; j < 6; j++) { const d = sh.v[j] - bits[j]; e += d > 0 ? d * d * 1.7 : d * d; }
        if (e < bs) { bs = e; best = sh.c; }
      }
      return String.fromCharCode(best);
    }
    const EDGE6 = [0.25, 1 / 6, 0.75, 1 / 6, 0.25, 0.5, 0.75, 0.5, 0.25, 5 / 6, 0.75, 5 / 6], edgeBits = new Float32Array(6);
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const EAR = [214, 66, 54];

    function rasterize(f, dimAt) {
      const k = K, sp = f.sp || SPECIES.koi, hx = headX(f), hy = headY(f), L = f.L0 * k;
      const swim = 0.25 + 0.9 * f.beat;
      for (let n = 0; n < N; n++) {
        const s = n / (N - 1), a = Math.max(0, n - 1), b = Math.min(N - 1, n + 1);
        let tx = f.nodes[a * 2] - f.nodes[b * 2], ty = f.nodes[a * 2 + 1] - f.nodes[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const off = L * 0.045 * (0.05 + 0.95 * Math.pow(s, 2.2)) * swim * Math.sin(f.phase - s * 4.6);
        spine[n * 2] = hx + f.nodes[n * 2] * k - ty * off;
        spine[n * 2 + 1] = hy + f.nodes[n * 2 + 1] * k + tx * off;
      }
      arc[0] = 0;
      for (let n = 1; n < N; n++) arc[n] = arc[n - 1] + Math.hypot(spine[n * 2] - spine[n * 2 - 2], spine[n * 2 + 1] - spine[n * 2 - 1]);
      arcTotal = arc[N - 1] || 1;
      const bank = clamp(f.turn * 0.5, -0.3, 0.3), scull = 0.15 * (1 - f.beat) * Math.sin(f.phase * 0.5);
      const flareL = 1 + scull - bank, flareR = 1 - scull + bank;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let n = 0; n < N; n++) { x0 = Math.min(x0, spine[n * 2]); x1 = Math.max(x1, spine[n * 2]); y0 = Math.min(y0, spine[n * 2 + 1]); y1 = Math.max(y1, spine[n * 2 + 1]); }
      const reachFactor = 0.27 * Math.max(1, sp.wScale, sp.tailSpread, sp.finReach);
      const reach = L * reachFactor;
      const c0 = Math.max(0, Math.floor(Math.max(x0 - reach, 0) / cw)), c1 = Math.min(cols - 1, Math.floor(Math.min(x1 + reach, vw) / cw));
      const r0 = Math.max(0, Math.floor(Math.max(y0 - reach, 0) / ch)), r1 = Math.min(rows - 1, Math.floor(Math.min(y1 + reach, vh) / ch));
      if (c0 > c1 || r0 > r1) return;
      const diag = Math.hypot(cw, ch);
      /* A koi rising for food comes up toward the surface: brighter, its shadow further below it. */
      const depth = lerp(f.depth, 1, f.rise * 0.85);
      const Kc = P.koi[f.colour], alphaBase = (P.dark ? 0.9 : 0.96) * (0.68 + 0.32 * depth) * f.seen;
      const sdc = 1 + Math.round(depth * 2), sdr = 1 + Math.round(depth);
      const lx = -0.6, ly = -0.8, pure = glyphMode(), dither = Qn().dither && !pure || (pure && Qn().dither);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * cw, y = r * ch;
          const got = sample(x + cw / 2, y + ch / 2, L, flareL, flareR, sp);
          if (!got && D > L * (S > 0.4 && S < 0.62 && sp !== SPECIES.turtle ? 0.15 * sp.wScale : reachFactor) + diag) { c += Math.max(0, Math.floor((D - L * reachFactor - diag) / cw)); continue; }
          let kind = hit.kind, across = hit.across, rs = hit.rs, ra = hit.ra, s = S, v = V, tx = TX, ty = TY;
          const from = Math.max(0, SEG - 2), to = Math.min(N - 2, SEG + 2);
          let hits = got ? 1 : 0;
          const deep = got && kind === 1 && s > 0.05 && s < sp.bodyEnd - 0.06 && halfW(s, sp) * L - D > diag * 0.4;
          if (deep) hits = 5;
          for (let q = 0; !deep && q < SUB.length; q += 2) {
            if (!sample(x + SUB[q] * cw, y + SUB[q + 1] * ch, L, flareL, flareR, sp, from, to)) continue;
            if (hits === 0) { kind = hit.kind; across = hit.across; rs = hit.rs; ra = hit.ra; s = S; v = V; tx = TX; ty = TY; }
            hits++;
          }
          if (!hits) continue;
          const cover = hits / 5, i = r * cols + c, dim = dimAt(x + cw / 2, y + ch / 2);
          const side = v >= 0 ? 1 : -1;
          let tile = null, tA = 0, g = " ", gC = null, gA = 0;
          if (kind === 5) {
            g = lineGlyph(tx, ty); gC = Kc.fin; gA = 0.7 * alphaBase;
          } else if (kind === 2) {
            /* Fins and tail: rays you can count, with a lighter web between them */
            const nx = -ty * side, ny = tx * side, ray = Math.floor(Math.atan2(Math.abs(ra), rs) * 11) & 1;
            g = ray ? lineGlyph(rs * tx + ra * nx, rs * ty + ra * ny) : (cover > 0.7 ? "." : " ");
            tile = Kc.fin; tA = (P.dark ? 0.46 : 0.58) * cover * alphaBase * (ray ? 1 : 0.55);
            gC = mul(Kc.fin, P.dark ? 1.18 : 0.65); gA = (ray ? 0.9 : 0.45) * alphaBase;
            if (pure) { tile = null; gC = mul(Kc.fin, P.dark ? 1.35 : 0.6); gA *= 1.05; }
          } else {
            const nz = Math.sqrt(Math.max(0, 1 - across * across));
            const nxs = -ty * side * across, nys = tx * side * across;
            /* where the caustic net crosses a koi's back, its scales glint */
            const gl = sstep(0.62, 0.96, caus(x + cw / 2, y + ch / 2)) * nz;
            let lit = clamp(0.76 + 0.26 * nz + 0.2 * (nxs * lx + nys * ly) + 0.3 * gl, 0.62, 1.34);
            /* ordered dither: neighbouring cells step between two shades, so a smooth gradient reads as a halftone */
            if (dither && kind !== 3) lit = lerp(lit, Math.floor(lit * 7 + (BAYER[(r & 3) * 4 + (c & 3)] + 0.5) / 16) / 7, 0.7);
            const sk = kind === 3 || kind >= 6 ? null : skin(f, s, v / L, across);
            const base = kind === 3 ? P.eye : kind === 6 ? EAR : kind === 7 ? mul(Kc.red, 0.55) : sk === 1 ? Kc.red : sk === 2 ? Kc.black : sk === 3 ? Kc.slate : Kc.white;
            const rim = kind < 6 && kind !== 3 && (across > 0.72 || cover < 0.7);
            /* on light water there is no darker rim: the edge is just the colour, a little softer */
            const rimMul = !P.dark ? 1 : f.species === "turtle" ? 0.62 : 0.76;
            tile = mul(base, rim ? lit * rimMul : lit);
            tA = (cover >= 0.4 ? 0.94 : cover * 1.8) * alphaBase;
            /* The koi's back as the title takes it on, before the dimming under the title: the red saddles most, then white or black by the theme. */
            if (kind !== 3) { tintRGB[i] = pack(tile); tintA[i] = tA * (sk === 1 ? 1 : sk === 2 ? (P.dark ? 0.4 : 0.6) : (P.dark ? 0.7 : 0.25)) * (1 + 0.6 * gl); }
            let ramp = null;
            if (kind === 3) { g = "o"; gC = Kc.white; gA = 0.95 * alphaBase; }
            else if (rim) {
              g = lineGlyph(-ty * side, tx * side);
              /* a cell the fish only part fills takes the character whose ink lies on the covered side */
              if (shapes && cover < 0.95) {
                let n6 = 0;
                for (let q = 0; q < 6; q++) { edgeBits[q] = sample(x + EDGE6[q * 2] * cw, y + EDGE6[q * 2 + 1] * ch, L, flareL, flareR, sp, from, to) ? 1 : 0; n6 += edgeBits[q]; }
                if (n6 > 0 && n6 < 6) g = matchGlyph(edgeBits);
              }
              gC = mul(base, P.dark ? (sk === 2 ? 1.55 : 0.48) : 0.4);
              gA = (P.dark ? 0.88 : 0) * alphaBase;
            } else if (kind === 6) { g = "="; gC = mul(base, 0.55); gA = 0.8 * alphaBase; ramp = "="; }
            else if (kind === 7) { g = "-"; gC = mul(base, 0.45); gA = 0.8 * alphaBase; ramp = "-"; }
            else {
              const idx = clamp(1 + Math.round((1.08 - lit) / 0.46 * 6) + (kind === 4 ? 2 : 0), 1, RAMP.length - 1);
              g = RAMP[idx]; gC = mul(base, P.dark ? (sk === 0 ? 0.52 : 1.35) : 0.45); gA = 0.72 * alphaBase;
              /* scale marks, staggered row by row, their arcs bulging toward the head */
              if (kind === 1 && f.species !== "turtle" && cover > 0.9 && !((c + (r & 1)) & 1) && lit > 0.7) {
                g = Math.abs(tx) > Math.abs(ty) * 0.8 ? (tx > 0 ? ")" : "(") : (ty > 0 ? "v" : "^"); ramp = g; gA = 0.62 * alphaBase;
                gC = mul(base, P.dark ? (sk === 0 ? 0.6 : 1.45) : 0.42);
              }
              if (gl > 0.5 && kind !== 4) { g = "*"; gC = mixC(base, [255, 255, 255], 0.75); gA = (0.45 + 0.4 * gl) * alphaBase; ramp = null; }
            }
            if (cover >= 0.6 && !pure) {
              const si = (r + sdr) * cols + (c + sdc);
              if (r + sdr < rows && c + sdc < cols) shade[si] = Math.max(shade[si], (P.dark ? 0.55 : 0.07) * (0.5 + 0.5 * depth) * dim * f.seen);
            }
            /* pure glyphs: no tile at all, the character carries the colour and its density the shade */
            if (pure) {
              const tc = tile; tile = null;
              if (kind === 3) { g = "O"; gC = Kc.white; }
              else {
                if (!rim && !ramp && g !== "*") g = lumRamp(tc);
                if (rim) gC = mul(tc, P.dark ? 1.3 : 0.62);
                else if (g !== "*") gC = P.dark ? mul(tc, 1.22) : mul(tc, 0.52);
              }
              gA = (rim ? 0.95 : 0.98) * alphaBase * (cover >= 0.4 ? 1 : cover * 1.8);
            }
          }
          if (!tileA[i] && !glyphA[i]) touched.push(i);
          if (tile) { tileRGB[i] = pack(tile); tileA[i] = tA * dim; }
          if (gC) { glyphRGB[i] = pack(gC); glyphA[i] = gA * dim; glyphCode[i] = g.charCodeAt(0); }
        }
      }
    }

    /* ── the cat's paw ── */
    const water = (x, y) => !paused && !reduce && x >= 0 && x <= vw && y >= 0 && y <= vh;
    /* A paw at (x, y): straight in from the nearer edge, top or bottom. */
    function poke(x, y) {
      if (paws.length >= 3 || !water(x, y)) return false;
      const k = K, fromTop = y <= vh - y;
      const ex = x, ey = fromTop ? -46 * k : vh + 46 * k;
      /* which way it sways and shakes is left to chance */
      paws.push({ x, y, k, ex, ey, leg: 30, side: h2(Math.round(x), Math.round(y)) < 0.5 ? -1 : 1, born: t, hit: false, flung: false, drips: 0 });
      return true;
    }
    /* Where a paw is in its catch: how far it is drawn back, how high, how it sways, how curled and how deep its toes are. */
    function pawState(p) {
      const a = t - p.born;
      /* two quick wet shakes as it leaves, turning the paw */
      const u = (a - SHAKE) / 0.3, shake = u > 0 && u < 1 ? 0.14 * Math.sin(u * 4 * Math.PI) * (1 - u) : 0;
      return { back: track(a, BACK), h: track(a, HIGH), swing: (track(a, SWAY) + shake) * p.side, curl: track(a, CURL), sink: track(a, SINK), squash: track(a, SQUASH), seen: track(a, SEEN) };
    }
    /* How far the tip reaches in paw units: curled toes fold under, so the paw gets shorter. */
    const tipOf = s => 5 - 4 * s.curl + HAND * 1.08;
    /* The paw on screen: the leg turns about a shoulder beyond the edge. Centre, axis u toward the toes, v across, size k; high up it looks bigger. */
    function pawPose(p) {
      const s = pawState(p), Kp = p.k * 1.9, arm = 120;
      let ux = p.x - p.ex, uy = p.y - p.ey;
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const c = Math.cos(s.swing), n = Math.sin(s.swing), dx = ux * c - uy * n, dy = ux * n + uy * c;
      const sx = p.x - ux * arm * Kp, sy = p.y - uy * arm * Kp, r = (arm - s.back) * Kp;
      return { ...s, ux: dx, uy: dy, vx: -dy, vy: dx, cx: sx + dx * r, cy: sy + dy * r, k: Kp * (1 + 0.5 * s.h) };
    }
    function splash(p) {
      p.hit = true;
      const s = pawPose(p), tip = tipOf(s) - 3, x = s.cx + s.ux * tip * s.k, y = s.cy + s.uy * tip * s.k;
      rings.push({ x, y, born: t, k: p.k, small: false });
      stamp(x, y, 4, 0.9);
      const reach = 280 * p.k;
      const near = fish.slice(0, count()).map(f => ({ f, d: Math.hypot(headX(f) - x, headY(f) - y), hx: headX(f), hy: headY(f) })).sort((a, b) => a.d - b.d);
      near.forEach(({ f, d, hx, hy }, i) => {
        if (d < reach) { f.flee = Math.max(f.flee, 1 - d / reach * 0.7); f.fleeA = Math.atan2(hy - y, hx - x); }
        /* the two curious ones come to look from either side, not at the same spot */
        if (i < 2) { const o = (i ? 1 : -1) * 34 * p.k; f.seekX = x - s.vx * o; f.seekY = y - s.vy * o; f.seekFrom = t + 1.3 + i * 0.5; f.seekUntil = f.seekFrom + 3.5; }
      });
    }
    /* The tugs stir the water in front of the curled toes. */
    function stir(p, dt) {
      const s = pawPose(p), tip = tipOf(s) + 2;
      stamp(s.cx + s.ux * tip * s.k, s.cy + s.uy * tip * s.k, 2, 4 * dt);
    }
    /* Flicking out of the water, the paw throws a few drops back toward the cat. */
    function fling(p) {
      p.flung = true;
      const s = pawPose(p), seed = Math.round(p.born * 1000);
      for (let j = 0; j < 5; j++) {
        const side = (j - 2) / 2, d = (30 + 36 * h2(j, seed)) * p.k;
        const x0 = s.cx + (s.ux * tipOf(s) + s.vx * side * 8) * s.k, y0 = s.cy + (s.uy * tipOf(s) + s.vy * side * 8) * s.k;
        drops.push({ x0, y0, x1: x0 - s.ux * d + s.vx * side * 18 * p.k, y1: y0 - s.uy * d + s.vy * side * 18 * p.k, born: t + j * 0.035, dur: 0.34 + 0.14 * h2(j + 7, seed), k: p.k });
      }
    }
    /* Each shake throws a drop off the side of the tip it swings toward. */
    function drip(p, dir) {
      const s = pawPose(p), a0 = tipOf(s) - 4, s0 = dir * 8, seed = Math.round(p.born * 1000) + p.drips;
      const x = s.cx + (s.ux * a0 + s.vx * s0) * s.k, y = s.cy + (s.uy * a0 + s.vy * s0) * s.k, d = (26 + 20 * h2(seed, 3)) * p.k;
      drops.push({ x0: x, y0: y, x1: x + s.vx * dir * d - s.ux * 8 * p.k, y1: y + s.vy * dir * d - s.uy * 8 * p.k, born: t, dur: 0.3, k: p.k });
    }
    /*
     * The paw is drawn the way the cat is: in cells half the pond's size, black
     * fur edged with ':' and a little '#%' texture. In paw units al runs toward
     * the toes and sd across: a round little hand on a round leg, its four toes
     * only drawn as four faint arcs along the tip.
     */
    function drawPaw(p) {
      const pose = pawPose(p), { ux, uy, vx, vy, cx, cy, k, h, sink, curl, squash, seen } = pose;
      /* squashed as it pushes in, stretched as it shoots and flicks: shorter and wider, or longer and narrower */
      const ka = k * (1 - 0.16 * squash), ks = k * (1 + 0.16 * squash);
      /* Curled toes fold under the tip, and their knuckles stand out a little more. */
      const cb = tipOf(pose) - HAND * 1.08, toe = 2.5 + 0.3 * curl, ring = HAND - toe - 1.1;
      const smin = (a, b, m) => { const q = Math.max(m - Math.abs(a - b), 0) / m; return Math.min(a, b) - q * q * m / 4; };
      let dist = 0;
      const part = (al, sd) => {
        /* a round little hand on a round leg, melted together */
        const leg = (al > cb ? Math.hypot(al - cb, sd) : Math.abs(sd)) - LEG, hand = Math.hypot((al - cb) / 1.08, sd) - HAND;
        dist = smin(leg, hand, 6);
        return dist > 0 ? -1 : al < -6 ? 0 : 1;
      };
      const fw = cw / 2, fh = ch / 2;
      /* the box the paw and its foreleg can cover */
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const al of [-p.leg - 1, 16]) for (const sd of [-11.5, 11.5]) {
        const x = cx + ux * al * ka + vx * sd * ks, y = cy + uy * al * ka + vy * sd * ks;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const i0 = Math.max(0, Math.floor(x0 / fw)), i1 = Math.min(Math.ceil(vw / fw), Math.ceil(x1 / fw));
      const j0 = Math.max(0, Math.floor(y0 / fh)), j1 = Math.min(Math.ceil(vh / fh), Math.ceil(y1 / fh));
      const nc = i1 - i0 + 1, nr = j1 - j0 + 1;
      if (nc <= 0 || nr <= 0) return;
      /* Each cell takes the part under its samples; a cell only partly covered is drawn fainter, so the toes stay round. */
      const g = new Int8Array(nc * nr).fill(-1), A = new Float32Array(nc * nr), C = new Float32Array(nc * nr);
      const reachCell = 0.6 * Math.hypot(fw, fh) / Math.min(ka, ks) + 0.3;
      const alOf = (x, y) => ((x - cx) * ux + (y - cy) * uy) / ka, sdOf = (x, y) => ((x - cx) * vx + (y - cy) * vy) / ks;
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const x = (i0 + i) * fw, y = (j0 + j) * fh, ac = alOf(x + fw / 2, y + fh / 2);
        A[j * nc + i] = ac;
        if (ac < -p.leg - 1 || ac > 17 || Math.abs(sdOf(x + fw / 2, y + fh / 2)) > 13) continue;
        /* a cell well inside or outside needs no more samples than its centre */
        const vc = part(ac, sdOf(x + fw / 2, y + fh / 2));
        if (Math.abs(dist) > reachCell) { g[j * nc + i] = vc; C[j * nc + i] = vc >= 0 ? 1 : 0; continue; }
        let n = 0, top = -1;
        for (let q = 1; q < 6; q += 2) for (let r = 1; r < 6; r += 2) {
          const sx = x + q / 6 * fw, sy = y + r / 6 * fh, v = part(alOf(sx, sy), sdOf(sx, sy));
          if (v >= 0) { n++; if (top < 0 || v > 1) top = v; }
        }
        g[j * nc + i] = n >= 5 ? top : n ? -2 : -1;
        C[j * nc + i] = n / 9;
      }
      const at = (i, j) => i < 0 || j < 0 || i >= nc || j >= nr ? -1 : Math.max(-1, g[j * nc + i]);
      const wl = sink > 0 ? tipOf(pose) + 2 - 8 * sink : Infinity, halfU = 0.5 * (Math.abs(ux) * fw + Math.abs(uy) * fh) / ka;
      /* the foreleg fades out toward the bank the cat sits on */
      const fade = al => al < -8 ? Math.max(0, 1 - (-8 - al) / (p.leg - 8)) ** 1.5 : 1;
      /* The shadow falls on the water, offset more while the paw is high. */
      const sx = fw * (2 + Math.round(h * 8)), sy = fh * (2 + Math.round(h * 6));
      ctx.globalAlpha = (P.dark ? 0.5 : 0.24) * (1 - 0.5 * h) * seen;
      ctx.fillStyle = P.dark ? "#000" : css(pack(mul(P.water, 0.55)));
      ctx.beginPath();
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const v = g[j * nc + i], al = A[j * nc + i];
        if (v >= 0 && fade(al) > 0.4 && al < wl) ctx.rect((i0 + i) * fw + sx, (j0 + j) * fh + sy, fw, fh);
      }
      ctx.fill();
      const fur = P.dark ? [16, 18, 21] : [16, 15, 14], tex = P.dark ? [44, 49, 54] : [54, 50, 46], rim = P.dark ? [150, 160, 166] : [85, 80, 74];
      /* On dark water the fur catches a little light along its edge, or the paw would vanish. Toes under the surface are seen through the water. */
      const lit = P.dark ? mixC(fur, rim, 0.22) : fur;
      const wet = [fur, rim, lit].map(c => css(pack(mixC(c, P.water, 0.3)))), dry = [fur, rim, lit].map(c => css(pack(c)));
      const texC = css(pack(tex)), dot = css(pack(P.dot));
      /* cell edges on whole device pixels, so faint cells do not overlap into a grid */
      const px = (n, s) => Math.round(n * s * dpr) / dpr;
      ctx.font = `600 ${(fh * 0.8).toFixed(1)}px ${MONO}`;
      /* The plain fur goes down first in one fill; the cells around it and their glyphs follow. */
      const solid = new Path2D(), marks = [];
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const v = g[j * nc + i], al = A[j * nc + i], under = al > wl, f = fade(al);
        if (v === -1 || f <= 0) continue;
        const x = px(i0 + i, fw), y = px(j0 + j, fh), w = px(i0 + i + 1, fw) - x, hh = px(j0 + j + 1, fh) - y;
        const [furC, rimC, litC] = under ? wet : dry;
        const ns = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)];
        const edge = ns.some(n => n < 0);
        if (v === -2) { ctx.globalAlpha = C[j * nc + i] * 1.3 * f * seen; ctx.fillStyle = furC; ctx.fillRect(x, y, w, hh); continue; }
        if (!under && f === 1 && !edge) solid.rect(x, y, w, hh);
        else { ctx.globalAlpha = (under ? 0.8 : 1) * f * seen; ctx.fillStyle = edge ? litC : furC; ctx.fillRect(x, y, w, hh); }
        const gx = x + fw / 2, gy = y + fh / 2;
        if (sink > 0 && Math.abs(al - wl) < halfU) marks.push(0.7, dot, "~", gx, gy);
        else if (edge) marks.push((P.dark ? 0.9 : 0.55) * f, rimC, ":", gx, gy);
        else if (!under && ((i0 + i) * 7 + (j0 + j) * 13) % 4 === 0) marks.push(0.45 * f, texC, (i0 + i + j0 + j) % 3 ? "#" : "%", gx, gy);
      }
      ctx.globalAlpha = seen; ctx.fillStyle = dry[0]; ctx.fill(solid);
      for (let m = 0; m < marks.length; m += 5) { ctx.globalAlpha = marks[m] * seen; ctx.fillStyle = marks[m + 1]; ctx.fillText(marks[m + 2], marks[m + 3], marks[m + 4]); }
      /* The four toes are only four faint arcs along the tip. */
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(0.8, 0.11 * k);
      ctx.strokeStyle = dry[1];
      for (const th of TOES) {
        const c = Math.cos(th), n = Math.sin(th), al = cb + ring * c * 1.08, sd = ring * n;
        const x = cx + ux * al * ka + vx * sd * ks, y = cy + uy * al * ka + vy * sd * ks, phi = Math.atan2(uy * c + vy * n, ux * c + vx * n);
        ctx.globalAlpha = (al + toe > wl ? 0.3 : 0.5) * seen;
        ctx.beginPath(); ctx.arc(x, y, toe * k, phi - 1.05, phi + 1.05); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    /* Drops in flight: the shadow parts from the drop and closes in again as it lands. */
    function rasterDrops() {
      for (const d of drops) {
        const u = (t - d.born) / d.dur;
        if (u < 0 || u >= 1) continue;
        const x = lerp(d.x0, d.x1, u), y = lerp(d.y0, d.y1, u), hh = 4 * u * (1 - u);
        const c = Math.floor(x / cw), r = Math.floor(y / ch), i = r * cols + c;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        if (!tileA[i] && !glyphA[i]) touched.push(i);
        glyphRGB[i] = pack(P.dot); glyphA[i] = 0.9; glyphCode[i] = (hh > 0.4 ? "o" : ".").charCodeAt(0);
        const sc = Math.round(hh * 3), sr = Math.round(hh * 2), si = (r + sr) * cols + (c + sc);
        if ((sc || sr) && r + sr < rows && c + sc < cols) shade[si] = Math.max(shade[si], P.dark ? 0.35 : 0.18);
      }
    }
    /* Rings spreading from the dip: the first drawn with glyphs along the ring, a fainter second one behind it. A landing drop or pellet makes one small ring. */
    function ringAt(px, py) {
      let best = null;
      for (const g of rings) {
        const age = t - g.born, life = 1 - age / (g.tiny ? 0.7 : g.small ? DROP_LIFE : RING_LIFE);
        if (life <= 0 || age < 0) continue;
        const dx = px - g.x, dy = py - g.y, d = Math.hypot(dx, dy);
        for (let j = 0; j < (g.small ? 1 : 2); j++) {
          const ag = age - j * 0.38;
          if (ag <= 0) continue;
          const R = (g.small ? ag * 34 + 4 : ag * 74 + 26) * g.k;
          if (Math.abs(d - R) > cw * 0.62) continue;
          const a = life ** 1.5 * (j ? 0.32 : g.tiny ? 0.28 : g.small ? 0.45 : 0.62);
          if (!best || a > best.a) best = { a, g: j || g.tiny ? "·" : lineGlyph(-dy, dx) };
        }
      }
      return best;
    }

    /* ── fish food ── */
    /* A handful tossed at (x, y): ten or so pellets spray out from the hand and land around it. */
    function feed(x, y) {
      if (!water(x, y)) return false;
      const k = K, seed = (Math.round(t * 1000) * 7919) ^ (Math.round(x) * 31 + Math.round(y) * 17);
      const n = 10 + Math.floor(h2(seed, 1) * 5);
      for (let j = 0; j < n; j++) {
        const a = h2(seed, j * 3 + 2) * Math.PI * 2, d = (12 + 46 * Math.sqrt(h2(seed, j * 3 + 3))) * k;
        const tx = clamp(x + Math.cos(a) * d, 6, vw - 6), ty = clamp(y + Math.sin(a) * d * 0.8, 6, vh - 6);
        const born = t + j * 0.012, dur = 0.28 + 0.2 * h2(seed, j * 3 + 4);
        food.push({ x0: x, y0: y, x: tx, y: ty, born, land: born + dur, seed: seed + j * 131, landed: false, eaten: -1, claim: 0 });
      }
      while (food.length > 90) food.shift();
      return true;
    }
    function stepFood(dt) {
      for (const p of food) {
        if (!p.landed && t >= p.land) { p.landed = true; rings.push({ x: p.x, y: p.y, born: t, k: K * 0.45, small: true, tiny: true }); stamp(p.x, p.y, 1, 0.25); }
        /* a floating pellet drifts a little on the surface */
        if (p.landed && p.eaten < 0) { p.x += Math.sin(t * 0.6 + p.seed) * 2.4 * K * dt; p.y += Math.cos(t * 0.45 + p.seed * 1.3) * 1.6 * K * dt; }
      }
      for (let j = food.length - 1; j >= 0; j--) {
        const p = food[j];
        if ((p.eaten >= 0 && t - p.eaten > 0.05) || (p.landed && t - p.land > FLOAT + SINKING)) food.splice(j, 1);
      }
      for (let j = bubbles.length - 1; j >= 0; j--) if (t - bubbles[j].born > 0.75) bubbles.splice(j, 1);
    }
    /* A pellet is a small warm-brown block with a lighter top edge and a shadow on the water. In the air it is bigger and its shadow lags behind. */
    function drawFood() {
      if (!food.length && !bubbles.length) return;
      const px = v => Math.round(v * dpr) / dpr;
      const body = css(pack(P.food)), top = css(pack(mixC(P.food, [255, 236, 200], 0.35))), shadow = P.dark ? "#000" : css(pack(mul(P.water, 0.5)));
      const pw = cw * 0.62, ph = ch * 0.48;
      for (const p of food) {
        if (t < p.born || p.eaten >= 0) continue;
        let x = p.x, y = p.y, hh = 0, a = 1, big = 1;
        if (!p.landed) { const u = clamp((t - p.born) / (p.land - p.born), 0, 1); x = lerp(p.x0, p.x, u); y = lerp(p.y0, p.y, u); hh = 4 * u * (1 - u); big = 1 + 0.9 * (1 - u); }
        else {
          const age = t - p.land;
          a = 1 - clamp((age - FLOAT) / SINKING, 0, 1);
          /* bobs as it lands */
          hh = age < 0.3 ? 0.25 * Math.sin(age / 0.3 * Math.PI) : 0;
        }
        const w = pw * big, h = ph * big, X = px(x - w / 2), Y = px(y - h / 2);
        ctx.globalAlpha = a * (P.dark ? 0.55 : 0.28);
        ctx.fillStyle = shadow;
        ctx.fillRect(px(X + pw * (0.7 + hh * 5)), px(Y + ph * (0.8 + hh * 4)), px(w), px(h));
        ctx.globalAlpha = a * (p.landed && t - p.land > FLOAT * 0.6 ? 0.85 : 1);
        ctx.fillStyle = body;
        ctx.fillRect(X, Y, px(w), px(h));
        ctx.fillStyle = top;
        ctx.fillRect(X, Y, px(w), px(Math.max(1, h * 0.34)));
      }
      /* a gulp leaves bubbles: o, then °, then a dot */
      if (bubbles.length) {
        ctx.font = `600 ${Math.round(ch * 0.74)}px ${MONO}`;
        ctx.fillStyle = css(pack(P.dot));
        for (const b of bubbles) {
          const u = (t - b.born) / 0.75;
          if (u < 0 || u >= 1) continue;
          ctx.globalAlpha = 0.85 * (1 - u * u);
          ctx.fillText(u < 0.35 ? "o" : u < 0.7 ? "°" : "·", b.x, b.y - u * ch * 0.8);
        }
      }
      ctx.globalAlpha = 1;
    }

    /* Moves the paws, drops, rings and food on by one step. */
    function stepPaws(dt) {
      for (const p of paws) {
        const a = t - p.born;
        if (!p.hit && a >= DIP) splash(p);
        if (a > PULL && a < FLICK - 0.02) stir(p, dt);
        if (!p.flung && a >= FLICK) fling(p);
        /* each shake throws a drop at its widest swing */
        if (p.drips < 3 && a >= SHAKE + 0.3 * (0.12 + p.drips * 0.25)) drip(p, (p.drips++ % 2 ? -1 : 1) * p.side);
      }
      for (let j = paws.length - 1; j >= 0; j--) if (t - paws[j].born >= END) paws.splice(j, 1);
      for (let j = drops.length - 1; j >= 0; j--) {
        const d = drops[j];
        if (t - d.born < d.dur) continue;
        rings.push({ x: d.x1, y: d.y1, born: t, k: d.k, small: true });
        stamp(d.x1, d.y1, 1, 0.5);
        drops.splice(j, 1);
      }
      for (let j = rings.length - 1; j >= 0; j--) if (t - rings[j].born >= (rings[j].tiny ? 0.7 : rings[j].small ? DROP_LIFE : RING_LIFE)) rings.splice(j, 1);
    }

    /* One fixed step of the whole pond. */
    function advance(dt) {
      t += dt;
      step(dt);
      stepPads(dt);
      stepPaws(dt);
      stepFood(dt);
      stepLife(dt);
    }

    /* ── colours ── */
    function colors() {
      const c = opts.palette();
      const dark = !!c.dark, water = rgb(c.water), accent = rgb(c.accent), light = rgb(c.koiLight), black = rgb(c.koiDark), ink = rgb(c.ink);
      P = {
        dark, water, ink,
        white: dark ? light : mixC(light, black, 0.14),
        red: dark ? mixC(accent, [232, 92, 52], 0.5) : mixC(accent, [178, 42, 18], 0.7),
        black: dark ? mixC(black, [0, 0, 0], 0.2) : mixC(black, [0, 0, 0], 0.35),
        eye: dark ? [16, 15, 14] : [12, 11, 10],
        /* fins read by value, as grey sharks do: lighter than dark water, darker than light water */
        fin: dark ? mixC(light, water, 0.25) : mixC(water, black, 0.52),
        dot: dark ? light : ink,
        food: dark ? [206, 142, 74] : [130, 74, 28],
        pad: dark ? [52, 92, 64] : [86, 120, 78],
        padRim: dark ? [78, 126, 90] : [58, 86, 52],
        lotusOuter: dark ? [214, 108, 134] : [192, 66, 96],
        lotusInner: dark ? [246, 186, 202] : [234, 142, 166],
        lotusCore: dark ? [242, 194, 82] : [214, 148, 28]
      };
      /* the light of the hour tints the water (and darkens it at night), and washes over everything at the end of each frame */
      skyState = skyAt(hourNow());
      {
        const ss = skyState, lum = (water[0] + water[1] + water[2]) / 3, kk = ss.k * (dark ? (lum < 25 ? 0.4 : 1) : 0.3);
        P.water = mixC(P.water, ss.tint, kk);
        if (dark) P.water = mul(P.water, 1 - 0.3 * ss.night);
        P.night = skyOn ? ss.night : 0; P.tintK = skyOn ? kk : 0;
      }
      for (const p of pads) p.spr = null;
      const scheme = (red, white, black) => ({ red, white, black, slate: dark ? [100, 130, 164] : [72, 98, 128], fin: dark ? mixC(mixC(white, red, 0.3), water, 0.2) : mixC(P.fin, red, 0.3) });
      P.koi = dark ? {
        course: scheme(P.red, P.white, P.black),
        vermilion: scheme([214, 58, 36], [246, 242, 234], [24, 22, 20]),
        gold: scheme([230, 164, 52], [222, 228, 232], [98, 74, 42]),
        sakura: scheme([238, 132, 128], [250, 240, 228], [66, 60, 70]),
        asagi: scheme([232, 102, 72], [214, 222, 230], [72, 108, 142]),
        turtle: scheme([196, 160, 88], [104, 146, 92], [62, 88, 60])
      } : {
        course: scheme(P.red, P.white, P.black),
        vermilion: scheme([176, 38, 22], [198, 188, 174], [16, 14, 13]),
        gold: scheme([178, 116, 22], [176, 180, 184], [58, 42, 24]),
        sakura: scheme([182, 76, 78], [202, 188, 176], [38, 34, 42]),
        asagi: scheme([188, 62, 34], [180, 186, 190], [44, 72, 98]),
        turtle: scheme([150, 112, 50], [70, 104, 64], [42, 64, 42])
      };
      buildDecor();
    }

    /* a ramp glyph for a colour: denser where the cell is brighter on dark water, darker on light */
    const lumRamp = c => { const l = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255, v = Math.max(P.dark ? 0.28 : 0.4, P.dark ? l : 1 - l); return RAMP[clamp(1 + Math.round(v * 8), 1, RAMP.length - 1)]; };

    /*
     * A lotus seen from above, painted rather than drawn: three whorls of broad, slightly uneven petals (9, 9 and 7),
     * each shaded from a creamy root to a deeper tip, cupped (brighter down the middle), veined, and lit from the upper
     * left. Where one petal lies over another the lower one is shaded, softly, as it would be in life, so there are no
     * outlines at all. It is sampled finer than the pond's cells (a third of a cell) and every one of those is averaged
     * from four points, so the edges are smooth. `open` runs from a closed bud to full bloom.
     */
    const petalShape = t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.75);
    const SUB4 = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
    function paintLotus(g, cxl, cyl, R, rot, ox, oy, nc, nr, p) {
      const pure = glyphMode(), div = pure ? 2 : 3, fw = cw / div, fh = ch / div, snap = v => Math.round(v * dpr) / dpr, PI2 = Math.PI * 2;
      const open = p.open, sc = (a, o) => lerp(a, 1, o);
      const oO = sstep(0, 0.7, open), oM = sstep(0.1, 0.85, open), oI = sstep(0.25, 1, open), podOpen = sstep(0.55, 0.9, open);
      const RR = R * (1 + 0.018 * Math.sin(t * 0.9 + rot * 3)), maxR = RR * (0.4 + 0.42 * oO);
      const i0 = Math.max(0, Math.floor((cxl - maxR) / fw) - 1), i1 = Math.min(Math.ceil(nc * cw / fw) - 1, Math.floor((cxl + maxR) / fw) + 1);
      const j0 = Math.max(0, Math.floor((cyl - maxR) / fh) - 1), j1 = Math.min(Math.ceil(nr * ch / fh) - 1, Math.floor((cyl + maxR) / fh) + 1);
      const white = p.variant === 1, dark = P.dark;
      const lo = white ? [240, 214, 224] : P.lotusOuter, li = white ? [250, 236, 238] : P.lotusInner, core = P.lotusCore;
      /* root, middle and tip colours of each whorl, innermost first */
      const WH = [
        { n: 7, off: 0.45,        r0: 0.05, r1: 0.05 + 0.29 * sc(0.55, oI), w: 0.125 * sc(0.55, oI), root: white ? [255, 248, 222] : [255, 238, 196], tip: white ? [250, 228, 232] : mixC(li, [255, 240, 244], 0.35) },
        { n: 9, off: Math.PI / 9, r0: 0.07, r1: 0.07 + 0.5 * sc(0.5, oM),  w: 0.17 * sc(0.6, oM),   root: white ? [255, 250, 238] : mixC(li, [255, 244, 236], 0.6), tip: white ? [246, 220, 228] : mixC(li, lo, 0.5) },
        { n: 9, off: 0,           r0: 0.12, r1: 0.12 + 0.68 * sc(0.42, oO), w: 0.2 * sc(0.62, oO), root: white ? [255, 250, 240] : mixC(lo, [255, 242, 238], 0.5), tip: white ? [240, 206, 218] : mul(lo, 0.92) }
      ];
      for (const w of WH) w.mid = mixC(w.root, w.tip, 0.42);
      const podC = mixC(core, [120, 138, 48], 0.55), podDark = mul(podC, 0.55), stamC = mixC(core, [255, 238, 150], 0.35), antherC = [206, 120, 36];
      /* a bud has its outer petals folded over the others; a bloom shows the inner ones on top */
      const order = open < 0.5 ? [2, 1, 0] : [0, 1, 2];
      const sd = Math.floor(p.phase * 1000) % 997;
      WH.forEach((w, qi) => {
        const n = w.n; w.ca = new Float32Array(n); w.sa = new Float32Array(n); w.R0 = new Float32Array(n); w.L = new Float32Array(n); w.W = new Float32Array(n); w.tone = new Float32Array(n);
        for (let k = 0; k < n; k++) {
          const j1_ = h2(qi * 31 + k, sd), j2 = h2(qi * 31 + k, sd + 11), j3 = h2(qi * 31 + k, sd + 23), j4 = h2(qi * 31 + k, sd + 37);
          const th = rot + w.off + k * PI2 / n + (j1_ - 0.5) * 0.14;
          w.ca[k] = Math.cos(th); w.sa[k] = Math.sin(th);
          w.R0[k] = w.r0 * RR; w.L[k] = (w.r1 - w.r0) * RR * (0.93 + 0.14 * j2); w.W[k] = w.w * RR * (0.92 + 0.16 * j3); w.tone[k] = 0.96 + 0.08 * j4;
        }
      });
      const rgb = new Float32Array(3), LX = -0.6, LY = -0.8;
      /* the colour (and whether anything) at one point */
      const probe = (x, y) => {
        const dx = x - cxl, dy = y - cyl, d = Math.hypot(dx, dy);
        if (d > maxR) return false;
        const ang = Math.atan2(dy, dx);
        if (podOpen > 0.02) {
          const pr = RR * 0.17 * podOpen, sr = RR * 0.34 * podOpen;
          if (d < pr) {
            /* the flat seed pod: gold-green, domed, pitted with a ring of holes */
            const e = d / pr, hole = e > 0.25 && e < 0.85 && Math.cos(ang * 6 + rot) * Math.cos(e * 9) > 0.45;
            const c = hole ? podDark : podC, l = 1.1 - 0.3 * e - (dx * LX + dy * LY < 0 ? 0 : 0.08);
            rgb[0] = c[0] * l; rgb[1] = c[1] * l; rgb[2] = c[2] * l; return true;
          }
          if (d < sr) {
            /* stamens: fine filaments from the pod, a tuft of anthers at the tip */
            const e = (d - pr) / (sr - pr), fil = 0.5 + 0.5 * Math.cos((ang - rot) * 15);
            if (fil > 0.5 - 0.15 * e) {
              const c = e > 0.78 ? antherC : mixC(stamC, [255, 250, 200], 0.3 * (1 - e)), l = 0.92 + 0.12 * fil;
              rgb[0] = c[0] * l; rgb[1] = c[1] * l; rgb[2] = c[2] * l; return true;
            }
          }
        }
        let shUp = 0;
        for (let q = 0; q < 3; q++) {
          const qi = order[q], w = WH[qi];
          let best = -1e9, bk = -1, btt = 0, bhw = 0, bv = 0, shLocal = 0, shAll = 0;
          for (let k = 0; k < w.n; k++) {
            const u = dx * w.ca[k] + dy * w.sa[k], R0 = w.R0[k], Lk = w.L[k];
            if (u < R0 - 0.14 * RR || u > R0 + Lk + 0.14 * RR) continue;
            const v = -dx * w.sa[k] + dy * w.ca[k], av = Math.abs(v), tt = clamp((u - R0) / Lk, 0, 1), hw = w.W[k] * petalShape(tt);
            if (u >= R0 && u <= R0 + Lk && av <= hw) { if (v > best) { best = v; bk = k; btt = tt; bhw = hw; bv = v; } }
            else {
              /* beside or beyond a petal: in its shadow if it lies over what is here */
              const dd = Math.max(av - hw, u - (R0 + Lk), R0 - u);
              if (dd > 0 && dd < 0.14 * RR) { const sv = Math.exp(-dd / (0.045 * RR)); if (sv > shAll) shAll = sv; if (v > 0 && sv > shLocal) shLocal = sv; }
            }
          }
          if (bk < 0) { if (shAll > shUp) shUp = shAll; continue; }
          const nv = Math.abs(bv) / bhw, ax = w.ca[bk], ay = w.sa[bk];
          const g1 = sstep(0, 0.45, btt), g2 = sstep(0.28, 1, btt);
          const rim = sstep(0.8, 1, nv), vein = 0.5 + 0.5 * Math.cos(nv * Math.PI * 5 + bk * 1.7);
          let lit = (0.9 + 0.14 * (1 - nv * nv)) * (1 + 0.1 * (-(ax * LX + ay * LY))) * (1 - 0.05 * vein * sstep(0.12, 0.4, btt) * (1 - 0.6 * nv)) * w.tone[bk];
          if (qi > 0) lit *= 0.8 + 0.2 * sstep(0, 0.4, btt);
          lit += 0.06 * rim;
          lit *= 1 - (dark ? 0.36 : 0.28) * Math.max(shLocal * 0.9, shUp);
          for (let ch3 = 0; ch3 < 3; ch3++) {
            let c = lerp(lerp(w.root[ch3], w.mid[ch3], g1), w.tip[ch3], g2);
            c = c * (1 - 0.14 * rim) + 255 * 0.14 * rim;
            rgb[ch3] = c * lit;
          }
          return true;
        }
        return false;
      };
      const shadeFill = dark ? "#000" : css(pack(mul(P.water, 0.6)));
      g.font = `${pure ? 800 : 700} ${Math.max(7, Math.round(fh * (pure ? 1.25 : 0.96)))}px ${MONO}`;
      g.textAlign = "center"; g.textBaseline = "middle";
      const ox2 = -0.05 * RR, oy2 = -0.06 * RR;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x0 = i * fw, y0 = j * fh, dm = fadeAt(x0 + fw / 2 + ox, y0 + fh / 2 + oy);
        if (dm < 0.03) continue;
        let n = 0, r_ = 0, g_ = 0, b_ = 0;
        for (let q = 0; q < 8; q += 2) if (probe(x0 + SUB4[q] * fw, y0 + SUB4[q + 1] * fh)) { n++; r_ += rgb[0]; g_ += rgb[1]; b_ += rgb[2]; }
        const sx = snap(x0), sy = snap(y0), ex = snap(x0 + fw), ey = snap(y0 + fh);
        if (!n) {
          /* the flower's soft shadow on the leaf, falling down and to the right */
          if (!pure && probe(x0 + fw / 2 + ox2, y0 + fh / 2 + oy2)) { g.globalAlpha = (dark ? 0.22 : 0.09) * dm; g.fillStyle = shadeFill; g.fillRect(sx, sy, ex - sx, ey - sy); }
          continue;
        }
        const a = n / 4, c3 = [clamp(r_ / n, 0, 255), clamp(g_ / n, 0, 255), clamp(b_ / n, 0, 255)];
        if (pure) {
          g.globalAlpha = 0.98 * a * dm; g.fillStyle = css(pack(dark ? mul(c3, 1.1) : mul(c3, 0.62))); g.fillText(lumRamp(c3), x0 + fw / 2, y0 + fh / 2);
          continue;
        }
        g.globalAlpha = Math.min(1, a * 1.25) * dm; g.fillStyle = css(pack(c3)); g.fillRect(sx, sy, ex - sx, ey - sy);
      }
    }

    /* a leaf: a ring of cells with a wavy edge and a notch, veins fanning from the middle; its shadow falls on the water (and the koi) beneath */
    function paintPad(g, p, pp, cxl, cyl, ox, oy, nc, nr) {
      const R = pp.R, rot = pp.rot, gap = Math.max(0.8, cw * 0.14), snap = v => Math.round(v * dpr) / dpr, pure = glyphMode();
      const padC = css(pack(P.pad)), rimC = css(pack(P.dark ? mul(P.padRim, 1.25) : mixC(P.pad, P.padRim, 0.25)));
      const veinC = css(pack(mixC(P.pad, P.dark ? [214, 242, 204] : [214, 236, 196], 0.5)));
      const shadeFill = P.dark ? "#000" : css(pack(mul(P.water, 0.55)));
      const kind = new Uint8Array(nc * nr), dmA = new Float32Array(nc * nr);
      for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        const x = c * cw + cw / 2, y = r * ch + ch / 2, dx = x - cxl, dy = y - cyl, d = Math.hypot(dx, dy);
        if (d > R * 1.04) continue;
        const ang = Math.atan2(dy, dx), da = Math.abs(Math.atan2(Math.sin(ang - rot), Math.cos(ang - rot)));
        const Rw = R * (1 + 0.035 * Math.sin(ang * 7 + p.phase * 2));
        if (d > Rw || (da < 0.32 && d > R * 0.15)) continue;
        const dm = fadeAt(x + ox, y + oy);
        if (dm < 0.03) continue;
        const isRim = d > Rw * 0.82 || da < 0.44;
        const vq = (ang - rot) / (Math.PI * 2 / 11), vein = !isRim && d > R * 0.22 && Math.abs(vq - Math.round(vq)) * (Math.PI * 2 / 11) * d < cw * 0.4;
        kind[r * nc + c] = isRim ? 1 : vein ? 3 : 2; dmA[r * nc + c] = dm;
      }
      g.font = `${pure ? 700 : 600} ${Math.round(ch * (pure ? 0.9 : 0.74))}px ${MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
      /* shadows first, offset down and right, so none of them lands on the leaf itself */
      if (!pure) {
        g.fillStyle = shadeFill;
        for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
          const k = kind[r * nc + c];
          if (!k) continue;
          for (let o = 1; o <= 2; o++) {
            const cc = c + o, rr_ = r + o;
            if (cc >= nc || rr_ >= nr || kind[rr_ * nc + cc]) continue;
            g.globalAlpha = (o === 1 ? (P.dark ? 0.3 : 0.08) : (P.dark ? 0.14 : 0.04)) * dmA[r * nc + c];
            g.fillRect(snap(cc * cw + gap), snap(rr_ * ch + gap), snap((cc + 1) * cw - gap) - snap(cc * cw + gap), snap((rr_ + 1) * ch - gap) - snap(rr_ * ch + gap));
          }
        }
      }
      for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        const k = kind[r * nc + c];
        if (!k) continue;
        const x = c * cw + cw / 2, y = r * ch + ch / 2, dm = dmA[r * nc + c], isRim = k === 1, vein = k === 3;
        const sx = snap(c * cw + gap), sy = snap(r * ch + gap), sw = snap((c + 1) * cw - gap) - sx, sh = snap((r + 1) * ch - gap) - sy;
        if (pure) {
          g.globalAlpha = (isRim ? 0.95 : vein ? 0.8 : 0.7) * dm;
          g.fillStyle = vein ? veinC : isRim ? rimC : padC;
          g.fillText(isRim ? "O" : vein ? lineGlyph(x - cxl, y - cyl) : "%", x, y);
          continue;
        }
        g.globalAlpha = (isRim ? (P.dark ? 0.9 : 0.92) : (P.dark ? 0.78 : 0.84)) * dm;
        g.fillStyle = isRim ? rimC : padC; g.fillRect(sx, sy, sw, sh);
        g.globalAlpha = (isRim ? (P.dark ? 0.58 : 0) : vein ? 0.6 : (P.dark ? 0.36 : 0.16)) * dm;
        g.fillStyle = vein ? veinC : rimC;
        g.fillText(isRim ? ":" : vein ? lineGlyph(x - cxl, y - cyl) : "~", x, y);
      }
      if (p.lotus) paintLotus(g, cxl, cyl, R, rot, ox, oy, nc, nr, p);
    }

    /* The pads and lotus are painted into a small sheet a few times a second and stamped from it each frame: they only drift and turn slowly. */
    const PADHZ = 5;
    function padSprite(p) {
      const pp = padPos(p), reach = Math.ceil(p.rad * K * 1.16);
      const scx = Math.floor(pp.x / cw), scy = Math.floor(pp.y / ch);
      const hc = Math.ceil(reach / cw) + 3, hr = Math.ceil(reach / ch) + 3, nc = hc * 2 + 1, nr = hr * 2 + 1;
      let s = p.spr;
      const bucket = Math.floor(t * PADHZ);
      if (s && s.scx === scx && s.scy === scy && s.bucket === bucket && s.nc === nc && s.dpr === dpr) return s;
      if (!s || s.nc !== nc || s.nr !== nr || s.dpr !== dpr) {
        s = p.spr = { cv: document.createElement("canvas"), nc, nr, dpr };
        s.cv.width = Math.round(nc * cw * dpr); s.cv.height = Math.round(nr * ch * dpr);
        s.g = s.cv.getContext("2d");
      }
      s.scx = scx; s.scy = scy; s.bucket = bucket; s.ox = (scx - hc) * cw; s.oy = (scy - hr) * ch;
      const g = s.g;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, nc * cw, nr * ch);
      paintPad(g, p, pp, hc * cw + cw / 2, hr * ch + ch / 2, s.ox, s.oy, nc, nr);
      return s;
    }
    function drawPads() {
      for (const p of pads) {
        const s = padSprite(p);
        ctx.globalAlpha = 1;
        ctx.drawImage(s.cv, Math.round(s.ox * dpr) / dpr, Math.round(s.oy * dpr) / dpr, s.nc * cw, s.nr * ch);
      }
    }

    /* ── the water's light, cached: caustics, light shafts and the faint glyphs they make, rebuilt 12 times a second ── */
    let shaftV = null, shaftList = null, shaftN = 0, ambList = null, ambN = 0, ambG = null, ambA = null, sparkList = null, sparkN = 0, mark = null, fid = 0;
    const BEAM = [0.2, 0.5, 0.8];
    function updateCaus() {
      const n = cols * rows, stamp = Math.floor(t * 12);
      if (!causV || causV.length !== n) {
        causV = new Float32Array(n); shaftV = new Float32Array(n); shaftList = new Int32Array(n); ambList = new Int32Array(n);
        ambG = new Uint16Array(n); ambA = new Float32Array(n); mark = new Uint32Array(n); sparkList = new Int32Array(n); sparkN = 0;
        for (let i = 0; i < n; i++) if (h2(i % cols, (i / cols) | 0) < 0.022) sparkList[sparkN++] = i;
        causStamp = -1;
      }
      if (stamp === causStamp) return;
      causStamp = stamp;
      const qn = Qn(), amt = qn.fx ? 0.03 + 0.97 * (skyOn ? skyState.day : 1) : 0;
      const ang = 1.08, ca = Math.cos(ang), sa = Math.sin(ang), qLo = -vh * ca, span = vw * sa - qLo, reach = vw * ca + vh * sa;
      ambN = 0; shaftN = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, x = c * cw + cw / 2, y = r * ch + ch / 2;
        let cl = qn.caus ? causRaw(x, y) : 0, sh = 0;
        if (amt > 0.02) {
          const q = x * sa - y * ca, al = x * ca + y * sa;
          for (let k = 0; k < 3; k++) {
            const u = (q - (qLo + span * (BEAM[k] + 0.04 * Math.sin(t * 0.06 + k * 2.1)))) / (span * (0.026 + 0.01 * k));
            if (u * u > 9) continue;
            sh += Math.exp(-u * u) * (0.55 + 0.45 * noise(al / 170 + t * 0.08, k * 3.7, 3));
          }
          sh *= amt * clamp(1 - al / reach * 0.75, 0.15, 1);
        }
        causV[i] = cl; shaftV[i] = sh;
        if (sh > 0.08) shaftList[shaftN++] = i;
        const cb = cl + sh * 0.22;
        if (cb > 0.8) { ambList[ambN++] = i; ambG[i] = cb > 0.94 ? 126 : cb > 0.87 ? 45 : 183; ambA[i] = Math.min(1, (cb - 0.8) * 1.3); }
      }
    }

    /* ═════════ life on the water ═════════ */
    const drift = [], flakes = [], fry = [], flies = [];
    let dragon = null, frog = null, duck = null, tufts = [], stones = [], lifeClock = 0, nextDrift = 3, fryGoal = null, rainAcc = 0, snowAcc = 0, decorSeed = 4242;
    let weatherNow = "none", lastBox = null;
    /* auto weather follows the calendar: leaves in October and November, the rains from July to September */
    const weatherKind = () => {
      if (weatherMode !== "auto") return weatherMode;
      const m = opts.month ? opts.month() : new Date().getMonth();
      return m >= 9 && m <= 10 ? "leaves" : m >= 6 && m <= 8 ? "rain" : "none";
    };
    const snapC = x => Math.floor(x / cw) * cw + cw / 2, snapR = y => Math.floor(y / ch) * ch + ch / 2;
    /* a glyph of its own colour at a point, snapped to the cell grid, faded under the title like the koi */
    function put(code, rgb, x, y, a) {
      a *= fadeAt(x, y);
      if (a < 0.02) return;
      ctx.globalAlpha = a; glyphAt(code, rgb, snapC(x), snapR(y));
    }
    function putTile(rgb, x, y, a) {
      a *= fadeAt(x, y);
      if (a < 0.02) return;
      if (glyphMode()) { ctx.globalAlpha = Math.min(1, a * 1.3); glyphAt(a > 0.7 ? 64 : a > 0.4 ? 43 : 58, rgb, snapC(x), snapR(y)); return; }
      const gap = Math.max(0.8, cw * 0.14), sn = v => Math.round(v * dpr) / dpr, c = Math.floor(x / cw), r = Math.floor(y / ch);
      const x0 = sn(c * cw + gap), y0 = sn(r * ch + gap);
      ctx.globalAlpha = a; ctx.fillStyle = css(rgb); ctx.fillRect(x0, y0, sn((c + 1) * cw - gap) - x0, sn((r + 1) * ch - gap) - y0);
    }

    /* petals and leaves riding the surface on a slow current */
    const LEAF_AUTUMN = [[214, 130, 52], [222, 172, 58], [176, 92, 44], [158, 124, 52]];
    function spawnDrift(type, x, y, life, vx, vy) {
      const col = type === "petal" ? mixC(P.lotusInner, [255, 255, 255], 0.25)
        : weatherNow === "leaves" ? LEAF_AUTUMN[(rnd() * LEAF_AUTUMN.length) | 0] : mixC(P.pad, [190, 214, 130], 0.35);
      drift.push({ type, x, y, vx: vx || 0, vy: vy || 0, age: 0, life: life || rr(50, 90), rot: rnd() * 6.28, spin: rr(-1.4, 1.4), col: pack(col) });
    }
    function spawnEdge(type) {
      const e = (rnd() * 2) | 0;
      if (e === 0) spawnDrift(type, -10, rr(0, vh), 0, 6 * K, 0); else spawnDrift(type, rr(0, vw), -10, 0, 0, 6 * K);
    }
    function shedPetal(p) {
      const pp = padPos(p), a = rnd() * 6.28, d = pp.R * rr(0.55, 0.9);
      spawnDrift("petal", pp.x + Math.cos(a) * d, pp.y + Math.sin(a) * d, rr(40, 70), Math.cos(a) * 5 * K, Math.sin(a) * 5 * K);
      rings.push({ x: pp.x + Math.cos(a) * d, y: pp.y + Math.sin(a) * d, born: t, k: K * 0.4, small: true, tiny: true });
    }

    function makeFry() {
      fry.length = 0; fryGoal = null;
      const n = Qn().fx > 1 ? 7 : Qn().fx ? 4 : 0, cx = rr(0.2, 0.8) * vw, cy = rr(0.2, 0.8) * vh;
      for (let i = 0; i < n; i++) fry.push({ x: cx + rr(-30, 30), y: cy + rr(-30, 30), vx: 0, vy: 0, ph: rnd() * 6.28 });
    }
    function stepFry(dt) {
      if (!fry.length) return;
      if (!fryGoal || t > fryGoal.until) fryGoal = { x: rr(0.1, 0.9) * vw, y: rr(0.12, 0.88) * vh, until: t + rr(6, 12) };
      let mx = 0, my = 0;
      for (const f of fry) { mx += f.x; my += f.y; }
      mx /= fry.length; my /= fry.length;
      for (const f of fry) {
        let ax = (fryGoal.x - f.x) * 0.02 + (mx - f.x) * 0.5, ay = (fryGoal.y - f.y) * 0.02 + (my - f.y) * 0.5;
        ax += Math.sin(t * 2.3 + f.ph) * 14 * K; ay += Math.cos(t * 1.9 + f.ph * 1.3) * 14 * K;
        for (const o of fry) { if (o === f) continue; const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1; if (d < 16 * K) { ax += dx / d * 60 * K; ay += dy / d * 60 * K; } }
        /* a ripple, a splash or food close by sends the shoal darting away */
        for (const g of rings) {
          if (t - g.born > 0.7) continue;
          const dx = f.x - g.x, dy = f.y - g.y, d = Math.hypot(dx, dy) || 1;
          if (d < 150 * K) { ax += dx / d * 520 * K; ay += dy / d * 520 * K; }
        }
        f.vx += ax * dt; f.vy += ay * dt;
        const sp = Math.hypot(f.vx, f.vy), mxs = 46 * K;
        if (sp > mxs) { f.vx *= mxs / sp; f.vy *= mxs / sp; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.x = clamp(f.x, 4, vw - 4); f.y = clamp(f.y, 4, vh - 4);
      }
    }
    function drawFry() {
      const col = pack(P.dark ? [208, 222, 230] : [74, 92, 104]);
      for (const f of fry) {
        const sp = Math.hypot(f.vx, f.vy) || 1, ux = f.vx / sp, uy = f.vy / sp;
        /* a head glyph that points the way it swims, and a trailing dot */
        const head = Math.abs(ux) > Math.abs(uy) * 1.3 ? (ux > 0 ? 62 : 60) : (uy > 0 ? 118 : 94);
        put(head, col, f.x, f.y, 0.8);
        put(183, col, f.x - ux * cw, f.y - uy * ch, 0.5);
      }
    }

    /* the dragonfly: arrives from the edge, lands on an open lotus, rests a while, then leaves */
    function stepDragon(dt) {
      if (!Qn().fx) { dragon = null; return; }
      const d = dragon || (dragon = { st: "away", until: t + rr(10, 20), x: 0, y: 0, a: 0, pad: null, flap: 0, gx: 0, gy: 0 });
      d.flap += dt * 36;
      const speed = 150 * K;
      if (d.st === "away") {
        if (t < d.until) return;
        const cand = pads.filter(p => p.lotus && p.open > 0.75);
        if (!cand.length) { d.until = t + 6; return; }
        d.pad = cand[(rnd() * cand.length) | 0];
        const e = (rnd() * 4) | 0;
        d.x = e === 0 ? -20 : e === 1 ? vw + 20 : rr(0, vw); d.y = e === 2 ? -20 : e === 3 ? vh + 20 : rr(0, vh);
        const pp = padPos(d.pad); d.a = Math.atan2(pp.y - d.y, pp.x - d.x); d.st = "fly";
      } else if (d.st === "fly") {
        const pp = padPos(d.pad), dx = pp.x - d.x, dy = pp.y - d.y, dist = Math.hypot(dx, dy);
        const want = Math.atan2(dy, dx) + Math.sin(t * 5 + d.flap * 0.02) * 0.35 * Math.min(1, dist / (120 * K));
        let da = want - d.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        d.a += clamp(da, -dt * 5, dt * 5);
        const v = speed * clamp(dist / (90 * K), 0.25, 1);
        d.x += Math.cos(d.a) * v * dt; d.y += Math.sin(d.a) * v * dt;
        if (dist < 9 * K) { d.st = "rest"; d.until = t + rr(5, 9); d.a = Math.atan2(dy, dx) + 0.8; d.ox = d.x - pp.x; d.oy = d.y - pp.y; rings.push({ x: d.x, y: d.y, born: t, k: K * 0.4, small: true, tiny: true }); }
      } else if (d.st === "rest") {
        const pp = padPos(d.pad); d.x = pp.x + d.ox; d.y = pp.y + d.oy;
        if (t >= d.until || d.pad.open < 0.5) { d.st = "leave"; d.a = rnd() * 6.28; }
      } else {
        d.x += Math.cos(d.a) * speed * 1.3 * dt; d.y += Math.sin(d.a) * speed * 1.3 * dt;
        if (d.x < -60 || d.x > vw + 60 || d.y < -60 || d.y > vh + 60) { d.st = "away"; d.until = t + rr(28, 55); }
      }
    }
    function drawDragon() {
      const d = dragon;
      if (!d || d.st === "away") return;
      const flying = d.st !== "rest", fl = Math.floor(d.flap) & 1;
      /* wing alpha: flapping wings are more transparent than stationary ones */
      const wA = flying ? (fl ? 0.55 : 0.28) : 0.75;
      /* iridescent body colours */
      const bodyC  = P.dark ? [32, 210, 230] : [8,  120, 148];
      const bodyDk  = P.dark ? [12,  90, 108] : [4,   56,  80]; /* darker underside / tail segments */
      const headC  = P.dark ? [20, 240, 210] : [10, 148, 128];
      const wingC  = P.dark ? [200, 240, 255] : [120, 180, 210];
      const wingVn = P.dark ? [160, 220, 240] : [ 90, 150, 180]; /* wing vein shade */
      const eyeC   = [32, 32, 32];
      /* build a paintCritter parts list oriented head-forward (u axis = forward) */
      const parts = [
        /* compound eyes — two dark bulges on either side of head */
        { u: 2.1, v: -0.55, ru: 0.35, rv: 0.35, col: eyeC,   eye: true },
        { u: 2.1, v:  0.55, ru: 0.35, rv: 0.35, col: eyeC,   eye: true },
        /* head */
        { u: 1.9, v: 0,     ru: 0.65, rv: 0.60, col: headC },
        /* thorax (widest part — where wings attach) */
        { u: 0.9, v: 0,     ru: 0.80, rv: 0.72, col: bodyC },
        /* abdomen segments — 3 progressively narrowing segments */
        { u: -0.3, v: 0,    ru: 0.65, rv: 0.52, col: bodyC  },
        { u: -1.4, v: 0,    ru: 0.52, rv: 0.38, col: bodyDk },
        { u: -2.3, v: 0,    ru: 0.38, rv: 0.26, col: bodyDk },
        { u: -3.0, v: 0,    ru: 0.24, rv: 0.18, col: bodyDk }, /* tail tip */
        /* forewing pair — angled slightly back */
        { u: 0.7, v: -1.6, ru: 1.4, rv: 0.38, col: wingC,  rot:  0.18 },
        { u: 0.7, v:  1.6, ru: 1.4, rv: 0.38, col: wingC,  rot: -0.18 },
        /* hindwing pair — slightly shorter, offset further back */
        { u: 0.1, v: -1.3, ru: 1.1, rv: 0.3,  col: wingVn, rot:  0.22 },
        { u: 0.1, v:  1.3, ru: 1.1, rv: 0.3,  col: wingVn, rot: -0.22 },
      ];
      /* flapping: when fl=1, narrow the wings on the upstroke */
      if (flying && fl) {
        parts[8].rv  = 0.14; parts[9].rv  = 0.14;
        parts[10].rv = 0.11; parts[11].rv = 0.11;
      }
      const a = 6.5 * K;
      /* shadow a little offset below-right */
      paintCritter(parts, d.x + 4, d.y + 5, d.a, a, 0.9, true);
      /* the dragonfly itself */
      paintCritter(parts, d.x, d.y, d.a, a, 1, false);
    }

    /* night: the moon's reflection broken by the water, and fireflies over it */
    function drawMoon() {
      const night = P.night;
      if (!P.dark || !skyOn || night < 0.05) return;
      /* it rises over the left bank and sets over the right, keeping clear of the title; around midnight it slips out of sight */
      const h = hourNow(), u = clamp(((h + 24 - 19) % 24) / 11, 0, 1), left = u < 0.5, v = left ? u * 2 : (u - 0.5) * 2;
      const gone = sstep(0, 0.14, Math.abs(u - 0.5)) * night;
      if (gone < 0.03) return;
      const mx = vw * (left ? lerp(0.07, 0.2, v) : lerp(0.8, 0.93, v)), my = vh * (0.17 - 0.07 * Math.sin(Math.PI * v));
      const mc = Math.floor(mx / cw), mr = Math.floor(my / ch), pale = pack([252, 252, 238]), halo = pack([170, 186, 214]);
      for (let r = -5; r <= 5; r++) for (let c = -7; c <= 7; c++) {
        const e = Math.hypot(c, r * ch / cw), x = (mc + c) * cw + cw / 2, y = (mr + r) * ch + ch / 2;
        const n = noise(c * 0.8 + t * 0.7, r * 0.8 - t * 0.4, 9);
        if (e < 3.1) { if (n > 0.84) continue; putTile(pale, x, y, gone * (n > 0.7 ? 0.6 : 1)); put(111, pack([176, 182, 164]), x, y, gone * 0.45); }
        else if (e < 5.6) { if (n > 0.5) put(183, halo, x, y, gone * 0.5 * (1 - (e - 3.1) / 2.5)); }
      }
      /* the glitter path trailing away from it across the water */
      const dir = left ? 1 : -1;
      for (let k = 1; k <= 12; k++) {
        const y = my + (5 + k) * ch * 0.95, x = mx + dir * k * cw * 0.55 + Math.sin(t * 1.1 + k * 1.7) * cw * 1.2, wd = Math.max(0, 3.4 - k * 0.25);
        for (let j = -Math.floor(wd); j <= Math.floor(wd); j++) {
          if (noise(j * 1.3 + t * 0.9, k * 0.9, 5) < 0.38) continue;
          put(k % 2 ? 45 : 61, pale, x + j * cw, y, gone * 0.75 * (1 - k / 13));
        }
      }
    }
    function stepFlies(dt) {
      const want = P.dark && skyOn && P.night > 0.3 && Qn().fx ? (Qn().fx > 1 ? 14 : 7) : 0;
      while (flies.length < want) flies.push({ x: rnd() * vw, y: rnd() * vh, ph: rnd() * 6.28, sp: rr(0.6, 1.4) });
      if (flies.length > want) flies.length = want;
      for (const f of flies) {
        f.x += (noise(f.x / 140 + t * 0.12, f.y / 140, 41) - 0.5) * 34 * K * dt * 2 + Math.cos(t * 0.5 * f.sp + f.ph) * 4 * dt;
        f.y += (noise(f.x / 140, f.y / 140 + t * 0.12, 57) - 0.5) * 34 * K * dt * 2 + Math.sin(t * 0.6 * f.sp + f.ph) * 4 * dt;
        f.x = (f.x + vw) % vw; f.y = (f.y + vh) % vh;
      }
    }
    function drawFlies() {
      const glow = pack([224, 255, 130]);
      for (const f of flies) {
        const b = Math.pow(Math.max(0, Math.sin(t * 1.3 * f.sp + f.ph * 3)), 3) * P.night;
        if (b < 0.05) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) putTile(glow, f.x + dx * cw, f.y + dy * ch, b * 0.09);
        put(42, glow, f.x, f.y, b);
      }
    }

    /* weather: rain rings the water, snow falls and melts on it, leaves land and drift */
    function stepWeather(dt) {
      const wk = weatherKind(), qn = Qn();
      if (wk !== weatherNow) { weatherNow = wk; flakes.length = 0; }
      if (wk === "rain") {
        rainAcc += dt * (qn.fx > 1 ? 18 : qn.fx ? 10 : 5);
        while (rainAcc >= 1) {
          rainAcc -= 1;
          const x = rnd() * vw, y = rnd() * vh;
          rings.push({ x, y, born: t, k: K * rr(0.28, 0.6), small: true, tiny: rnd() < 0.6 });
          flakes.push({ type: "rain", x, y, u: 0, ttl: 0.22 });
        }
        while (rings.length > 80) rings.shift();
      } else if (wk === "snow") {
        snowAcc += dt * (qn.fx > 1 ? 34 : qn.fx ? 20 : 9);
        while (snowAcc >= 1 && flakes.length < 160) { snowAcc -= 1; flakes.push({ type: "snow", x: rnd() * vw, y: rnd() * vh, u: 0, ttl: rr(1.4, 3.2), big: rnd() }); }
        snowAcc = Math.min(snowAcc, 1);
      } else if (wk === "leaves" && drift.length < 30 && rnd() < dt * 1.4) spawnEdge("leaf");
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i]; f.u += dt / f.ttl;
        if (f.type === "snow") { f.x += 7 * K * dt; f.y += 3 * K * dt; }
        if (f.u >= 1) { if (f.type === "snow" && f.big > 0.7) rings.push({ x: f.x, y: f.y, born: t, k: K * 0.3, small: true, tiny: true }); flakes.splice(i, 1); }
      }
    }
    function drawWeather() {
      const wk = weatherNow;
      if (wk === "rain") {
        const c = pack(P.dark ? [210, 228, 240] : [60, 84, 104]);
        for (const f of flakes) put(39, c, f.x, f.y, 0.8 * (1 - f.u));
      } else if (wk === "snow") {
        const c = pack(P.dark ? [246, 250, 255] : [150, 170, 190]);
        for (const f of flakes) { const a = Math.pow(Math.sin(Math.PI * f.u), 0.8) * (P.dark ? 0.85 : 0.9); put(f.big > 0.7 ? 42 : f.big > 0.35 ? 43 : 183, c, f.x, f.y, a); }
      }
    }

    function stepLife(dt) {
      lifeClock += dt;
      const qn = Qn(), cap = qn.fx > 1 ? 12 : qn.fx ? 7 : 3;
      if (lifeClock >= nextDrift && drift.length < cap) { nextDrift = lifeClock + rr(4, 9); spawnEdge(rnd() < 0.5 ? "petal" : "leaf"); }
      stepWeather(dt);
      for (let i = drift.length - 1; i >= 0; i--) {
        const d = drift[i]; d.age += dt;
        const wx = K * (4 + 9 * (noise(d.x / 200 + t * 0.02, d.y / 200, 21) - 0.5)), wy = K * 10 * (noise(d.x / 200, d.y / 200 - t * 0.02, 33) - 0.5);
        d.vx += (wx - d.vx) * dt * 0.5; d.vy += (wy - d.vy) * dt * 0.5; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.spin * dt;
        if (d.age > d.life || d.x < -30 || d.x > vw + 30 || d.y < -30 || d.y > vh + 30) drift.splice(i, 1);
      }
      if (fry.length !== (qn.fx > 1 ? 7 : qn.fx ? 4 : 0)) makeFry();
      stepFry(dt); stepDragon(dt); stepFlies(dt); stepFrog(dt); stepDuck(dt);
    }
    function drawDrift() {
      for (const d of drift) {
        const a = Math.min(1, d.age * 0.6, (d.life - d.age) * 0.3), k = Math.floor(d.rot) & 3;
        if (d.type === "petal") put([44, 126, 39, 45][k], d.col, d.x, d.y, 0.95 * a);
        else put([38, 37, 43, 42][k], d.col, d.x, d.y, 0.95 * a);
      }
    }

    /* ── critters drawn from ellipses: top-most first; u runs forward, v to the right, in units of a ── */
    function paintCritter(parts, cx, cy, ang, a, alpha, shadowOnly) {
      const ca = Math.cos(ang), sa = Math.sin(ang), R = a * 4.4, pure = glyphMode();
      const gap = Math.max(0.8, cw * 0.14), sn = v => Math.round(v * dpr) / dpr;
      const c0 = Math.max(0, Math.floor((cx - R) / cw)), c1 = Math.min(cols - 1, Math.floor((cx + R) / cw));
      const r0 = Math.max(0, Math.floor((cy - R) / ch)), r1 = Math.min(rows - 1, Math.floor((cy + R) / ch));
      const shadeFill = P.dark ? "#000" : css(pack(mul(P.water, 0.55)));
      const probe = (px, py) => {
        const ux = (px - cx) * ca + (py - cy) * sa, vy = -(px - cx) * sa + (py - cy) * ca;
        for (let q = 0; q < parts.length; q++) {
          const m = parts[q];
          let du = ux - m.u * a, dv = vy - m.v * a;
          if (m.rot) { const cr = Math.cos(m.rot), sr = Math.sin(m.rot), tu = du * cr + dv * sr; dv = -du * sr + dv * cr; du = tu; }
          const nu = du / (m.ru * a), nv = dv / (m.rv * a);
          if (nu * nu + nv * nv <= 1) { probeN.nu = nu; probeN.nv = nv; probeN.q = q; return true; }
        }
        return false;
      };
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = c * cw, y = r * ch, dm = fadeAt(x + cw / 2, y + ch / 2) * alpha;
        if (dm < 0.03) continue;
        let n = 0, first = -1, fnu = 0, fnv = 0;
        for (let q = 0; q < 10; q += 2) {
          if (!probe(x + (q === 0 ? 0.5 : SUB[q - 2]) * cw, y + (q === 0 ? 0.5 : SUB[q - 1]) * ch)) continue;
          n++;
          if (first < 0 || q === 0) { first = probeN.q; fnu = probeN.nu; fnv = probeN.nv; }
        }
        if (!n) continue;
        const m = parts[first], cover = n / 5;
        if (shadowOnly) {
          if (!pure) { ctx.globalAlpha = (P.dark ? 0.38 : 0.12) * dm * Math.min(1, cover * 1.5); ctx.fillStyle = shadeFill; ctx.fillRect(sn(x + gap + cw * 0.35), sn(y + gap + ch * 0.35), cw - 2 * gap, ch - 2 * gap); }
          continue;
        }
        /* a pseudo-normal for light from the upper left */
        const wx = ca * fnu - sa * fnv, wy = sa * fnu + ca * fnv;
        const lit = clamp(0.9 + 0.22 * (-0.6 * wx - 0.8 * wy) - 0.12 * (fnu * fnu + fnv * fnv), 0.62, 1.18);
        const tile = mul(m.col, lit), edge = fnu * fnu + fnv * fnv > 0.72;
        if (pure) {
          ctx.globalAlpha = 0.97 * dm * Math.min(1, cover * 1.6);
          glyphAt((m.eye ? 111 : lumRamp(tile).charCodeAt(0)), pack(P.dark ? mul(tile, 1.12) : mul(tile, 0.85)), x + cw / 2, y + ch / 2);
          continue;
        }
        /* rim cells get a noticeably darker shade so each creature has a visible silhouette boundary */
        const drawCol = edge ? mul(m.col, P.dark ? 0.55 : 0.42) : tile;
        ctx.globalAlpha = 0.97 * dm * (cover >= 0.4 ? 1 : cover * 1.8); ctx.fillStyle = css(pack(drawCol));
        const x0 = sn(x + gap), y0 = sn(y + gap); ctx.fillRect(x0, y0, sn(x + cw - gap) - x0, sn(y + ch - gap) - y0);
        ctx.globalAlpha = (m.eye ? 0.95 : (edge ? (P.dark ? 0.65 : 0.55) : (P.dark ? 0.4 : 0.22))) * dm;
        glyphAt(m.eye ? 111 : lumRamp(tile).charCodeAt(0), pack(m.eye ? [30, 26, 20] : mul(m.col, P.dark ? 0.42 : 0.32)), x + cw / 2, y + ch / 2);
      }
    }
    const probeN = { nu: 0, nv: 0, q: 0 };

    /* the frog: sits on a leaf (the one without a flower when there is one), hops about it, blinks and croaks */
    const FROG_G = [[56, 108, 50], [76, 130, 60]];
    function frogParts(croak, hop, tongue = 0) {
      /* vibrant, high-contrast colours — darker underside/legs vs bright body, to stand out against the pad */
      const body  = P.dark ? [82, 190, 58]  : [52, 158, 32];   /* vivid lime-green body */
      const head  = P.dark ? [112, 220, 78] : [72, 188, 48];   /* slightly lighter head */
      const leg   = P.dark ? [44, 128, 36]  : [28, 98, 20];    /* dark olive legs for depth */
      const belly = P.dark ? [168, 220, 100]: [128, 180, 70];  /* pale lime belly highlight */
      const spot  = P.dark ? [26, 86, 22]   : [18, 66, 14];    /* very dark spots for contrast */
      const eye = [252, 220, 60], pupil = [10, 12, 8], throat = [210, 230, 140];
      const fl = hop ? 1.5 : 0.9;
      const sac = croak > 0.08 ? [{ u: 1.0 + 0.2 * croak, v: 0, ru: 0.55 + 0.3 * croak, rv: 0.5 + 0.3 * croak, col: throat }] : [];
      const flick = tongue > 0.05 ? [
        { u: 2.0 + tongue * 1.15, v: 0, ru: 0.28, rv: 0.28, col: [246, 134, 152] },
        { u: 1.9 + tongue * 0.6, v: 0, ru: 0.65 * tongue, rv: 0.16, col: [228, 86, 114] }
      ] : [];
      return [
        { u: 1.48, v: -0.66, ru: 0.18, rv: 0.18, col: pupil, eye: true }, { u: 1.48, v: 0.66, ru: 0.18, rv: 0.18, col: pupil, eye: true },
        { u: 1.4, v: -0.66, ru: 0.44, rv: 0.44, col: eye, eye: true }, { u: 1.4, v: 0.66, ru: 0.44, rv: 0.44, col: eye, eye: true },
        { u: 1.88, v: -0.22, ru: 0.14, rv: 0.14, col: pupil }, { u: 1.88, v: 0.22, ru: 0.14, rv: 0.14, col: pupil },
        ...flick,
        ...sac,
        { u: -0.2, v: -0.42, ru: 0.3, rv: 0.24, col: spot }, { u: -0.45, v: 0.38, ru: 0.28, rv: 0.22, col: spot },
        /* belly stripe — lighter patch down the centre for a 3-D look */
        { u: 0.4, v: 0, ru: 0.6, rv: 0.42, col: belly },
        { u: 1.15, v: 0, ru: 0.98, rv: 0.92, col: head },
        { u: -0.1, v: 0, ru: 1.52, rv: 1.12, col: body },
        { u: 0.7, v: -1.3, ru: 0.82, rv: 0.3, col: leg, rot: 0.5 }, { u: 0.7, v: 1.3, ru: 0.82, rv: 0.3, col: leg, rot: -0.5 },
        { u: -1.0, v: -1.25 * fl, ru: 1.32, rv: 0.52, col: leg, rot: -0.55 }, { u: -1.0, v: 1.25 * fl, ru: 1.32, rv: 0.52, col: leg, rot: 0.55 }
      ];
    }
    function frogPad() { return pads.find(p => !p.lotus) || null; }
    function stepFrog(dt) {
      const p = Qn().fx && pads.length ? frogPad() : null;
      if (!p) { frog = null; return; }
      if (!frog || frog.pad !== p) {
        const a = rnd() * 6.28;
        frog = {
          pad: p, state: "sit",
          ox: Math.cos(a) * 0.3, oy: Math.sin(a) * 0.3,
          ang: a + Math.PI, hop: -1, hx: 0, hy: 0, fx: 0, fy: 0,
          wx: 0, wy: 0, sx: 0, sy: 0, swimUntil: 0,
          nextHop: t + rr(3.5, 7), nextCroak: t + rr(3, 8), croak: 0, croakT: -9,
          nextTongue: t + rr(4, 9), tongueT: -9, tongue: 0
        };
      }
      const f = frog, pp = padPos(p);
      if (f.state === "sit" && t >= f.nextHop) {
        if (rnd() < 0.65) {
          /* leap off the lily pad into the nearby water */
          const a = rnd() * 6.28, dist = pp.R * rr(1.35, 1.9);
          f.sx = pp.x + f.ox * pp.R; f.sy = pp.y + f.oy * pp.R;
          f.wx = clamp(pp.x + Math.cos(a) * dist, vw * 0.08, vw * 0.92);
          f.wy = clamp(pp.y + Math.sin(a) * dist, vh * 0.08, vh * 0.92);
          f.ang = Math.atan2(f.wy - f.sy, f.wx - f.sx);
          f.state = "hopOut"; f.hop = 0;
        } else {
          /* small hop to another spot on the leaf */
          const a = rnd() * 6.28, r = rr(0.05, 0.55);
          f.hx = Math.cos(a) * r; f.hy = Math.sin(a) * r; f.fx = f.ox; f.fy = f.oy;
          f.ang = Math.atan2(f.hy - f.oy, f.hx - f.ox);
          f.state = "hopOn"; f.hop = 0;
        }
      } else if (f.state === "hopOn") {
        f.hop += dt / 0.5;
        const u = Math.min(1, f.hop), e = u * u * (3 - 2 * u);
        f.ox = lerp(f.fx, f.hx, e); f.oy = lerp(f.fy, f.hy, e);
        if (f.hop >= 1) {
          f.hop = -1; f.state = "sit"; f.nextHop = t + rr(4, 9);
          p.bobV += 6.5; p.bob = Math.max(p.bob, 0.35);
          rings.push({ x: pp.x + f.ox * pp.R, y: pp.y + f.oy * pp.R, born: t, k: K * 0.5, small: true });
        }
      } else if (f.state === "hopOut") {
        f.hop += dt / 0.58;
        if (f.hop >= 1) {
          f.hop = -1; f.state = "swim"; f.swimUntil = t + rr(2.5, 4.5);
          rings.push({ x: f.wx, y: f.wy, born: t, k: K * 0.9, small: false });
          stamp(f.wx, f.wy, 2, 0.55);
        }
      } else if (f.state === "swim") {
        const swimA = f.ang + Math.sin(t * 2.2) * 0.4;
        f.wx = clamp(f.wx + Math.cos(swimA) * 16 * K * dt, vw * 0.06, vw * 0.94);
        f.wy = clamp(f.wy + Math.sin(swimA) * 16 * K * dt, vh * 0.06, vh * 0.94);
        if (Math.random() < dt * 2.2) stamp(f.wx, f.wy, 1, 0.16);
        if (t >= f.swimUntil) {
          const a = rnd() * 6.28, r = rr(0.1, 0.5);
          f.hx = Math.cos(a) * r; f.hy = Math.sin(a) * r;
          f.sx = f.wx; f.sy = f.wy;
          f.ang = Math.atan2(pp.y + f.hy * pp.R - f.sy, pp.x + f.hx * pp.R - f.sx);
          f.state = "hopIn"; f.hop = 0;
        }
      } else if (f.state === "hopIn") {
        f.hop += dt / 0.58;
        if (f.hop >= 1) {
          f.ox = f.hx; f.oy = f.hy; f.hop = -1; f.state = "sit"; f.nextHop = t + rr(5, 11);
          p.bobV += 9.5; p.bob = Math.max(p.bob, 0.55);
          rings.push({ x: pp.x + f.ox * pp.R, y: pp.y + f.oy * pp.R, born: t, k: K * 0.65, small: true });
        }
      }
      if (f.state === "sit" && t >= f.nextCroak) { f.nextCroak = t + rr(7, 15); f.croakT = t; }
      f.croak = f.state === "sit" && t - f.croakT < 0.7 ? Math.sin((t - f.croakT) / 0.7 * Math.PI * 3) * 0.5 + 0.5 : 0;
      if (f.state === "sit" && t >= f.nextTongue) { f.nextTongue = t + rr(5, 11); f.tongueT = t; }
      f.tongue = f.state === "sit" && t - f.tongueT < 0.45 ? Math.sin((t - f.tongueT) / 0.45 * Math.PI) : 0;
    }
    function drawFrog() {
      const f = frog;
      if (!f) return;
      const pp = padPos(f.pad), a = pp.R * 0.28;  /* slightly larger than before for more coverage */
      let x, y, lift = 0, jumping = false;
      if (f.state === "hopOut") {
        const u = Math.min(1, f.hop), e = u * u * (3 - 2 * u);
        x = lerp(f.sx, f.wx, e); y = lerp(f.sy, f.wy, e);
        lift = Math.sin(u * Math.PI) * 18 * K; jumping = true;
      } else if (f.state === "swim") {
        x = f.wx; y = f.wy; jumping = Math.sin(t * 7) > 0;
      } else if (f.state === "hopIn") {
        const u = Math.min(1, f.hop), e = u * u * (3 - 2 * u);
        x = lerp(f.sx, pp.x + f.hx * pp.R, e); y = lerp(f.sy, pp.y + f.hy * pp.R, e);
        lift = Math.sin(u * Math.PI) * 18 * K; jumping = true;
      } else {
        x = pp.x + f.ox * pp.R; y = pp.y + f.oy * pp.R;
        if (f.hop >= 0) { lift = Math.sin(Math.min(1, f.hop) * Math.PI) * 14 * K; jumping = true; }
      }
      const parts = frogParts(f.croak, jumping, f.tongue);
      /* shadow offset a full cell down-right so it clears the pad surface and is visible */
      if (f.state !== "swim") paintCritter(parts, x + cw * 0.6, y + ch * 0.6, f.ang, a, 0.85, true);
      paintCritter(parts, x, y - lift, f.ang, a, 1, false);
    }

    /* a duck on the water: slow circuits, a wake behind it */
    function duckParts() {
      const body = [158, 120, 82], wing = [128, 104, 84];
      return [
        { u: 2.4, v: -0.42, ru: 0.16, rv: 0.16, col: [16, 16, 14], eye: true }, { u: 2.4, v: 0.42, ru: 0.16, rv: 0.16, col: [16, 16, 14], eye: true },
        { u: 3.0, v: 0, ru: 0.6, rv: 0.44, col: [236, 178, 52] },
        { u: 2.2, v: 0, ru: 0.85, rv: 0.74, col: [32, 118, 88] },
        { u: 1.55, v: 0, ru: 0.22, rv: 0.72, col: [238, 234, 224] },
        { u: -0.5, v: -0.62, ru: 0.28, rv: 0.2, col: [58, 86, 168] }, { u: -0.5, v: 0.62, ru: 0.28, rv: 0.2, col: [58, 86, 168] },
        { u: -0.1, v: -0.55, ru: 1.15, rv: 0.45, col: wing }, { u: -0.1, v: 0.55, ru: 1.15, rv: 0.45, col: wing },
        { u: 0, v: 0, ru: 2.0, rv: 1.25, col: body },
        { u: -2.1, v: 0, ru: 0.6, rv: 0.45, col: [60, 50, 44] }
      ];
    }
    function stepDuck(dt) {
      if (Qn().fx < 2) { duck = null; return; }
      if (!duck) duck = { x: vw * rr(0.15, 0.85), y: vh * rr(0.2, 0.8), a: rnd() * 6.28, wake: 0 };
      const d = duck, sp = 12 * K;
      let steer = Math.sin(t * 0.17 + 1.3) * 0.5 + Math.sin(t * 0.07) * 0.35;
      const m = 0.14, nx = d.x / vw, ny = d.y / vh;
      if (nx < m || nx > 1 - m || ny < m || ny > 1 - m) {
        let da = Math.atan2(vh / 2 - d.y, vw / 2 - d.x) - d.a; da = Math.atan2(Math.sin(da), Math.cos(da)); steer = da * 1.6;
      }
      if (lastBox) {
        const b = lastBox, m2 = 70 * K, dx = Math.max(b.left - m2 - d.x, 0, d.x - b.right - m2), dy = Math.max(b.top - m2 - d.y, 0, d.y - b.bottom - m2);
        if (dx === 0 && dy === 0) { let da = Math.atan2(d.y - (b.top + b.bottom) / 2, d.x - (b.left + b.right) / 2) - d.a; da = Math.atan2(Math.sin(da), Math.cos(da)); steer = da * 2.2; }
      }
      d.a += steer * dt; d.x += Math.cos(d.a) * sp * dt; d.y += Math.sin(d.a) * sp * dt;
      d.wake -= dt;
      if (d.wake <= 0) { d.wake = 0.18; stamp(d.x - Math.cos(d.a) * 22 * K, d.y - Math.sin(d.a) * 22 * K, 2, 0.35); }
    }
    function drawDuck() {
      const d = duck;
      if (!d) return;
      const a = 8.5 * K, parts = duckParts(), bob = Math.sin(t * 1.4) * 0.8;
      paintCritter(parts, d.x + 3, d.y + 4, d.a, a, 1, true);
      paintCritter(parts, d.x, d.y + bob, d.a, a, 1, false);
    }

    /* ── the banks: stones under the water at the edges, tufts of reed growing in from the corners ── */
    function buildDecor() {
      stones = []; tufts = [];
      const qn = Qn();
      if (!qn.fx || !cols) return;
      const hh = (k, j) => h2(decorSeed + k * 17, j * 31 + 7);
      const spots = [[0.035, 0.9], [0.11, 0.975], [0.965, 0.1], [0.9, 0.03], [0.03, 0.08], [0.97, 0.9]].slice(0, qn.fx > 1 ? 6 : 3);
      spots.forEach(([fx, fy], si) => {
        for (let sj = 0; sj < 2; sj++) {
          const cx = fx * vw + (hh(si, sj * 5 + 1) - 0.5) * 70 * K, cy = fy * vh + (hh(si, sj * 5 + 2) - 0.5) * 50 * K;
          const rx = (10 + hh(si, sj * 5 + 3) * 14) * K, ry = rx * (0.6 + hh(si, sj * 5 + 4) * 0.25);
          const c0 = Math.max(0, Math.floor((cx - rx * 1.4) / cw)), c1 = Math.min(cols - 1, Math.floor((cx + rx * 1.4) / cw));
          const r0 = Math.max(0, Math.floor((cy - ry * 1.4) / ch)), r1 = Math.min(rows - 1, Math.floor((cy + ry * 1.4) / ch));
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const nx = (c * cw + cw / 2 - cx) / rx, ny = (r * ch + ch / 2 - cy) / ry, e = Math.hypot(nx, ny);
            if (e > 1.35) continue;
            if (e > 1) { if (P.dark) stones.push({ c, r, rgb: pack([0, 0, 0]), a: 0.16, g: 0, grgb: 0, ga: 0 }); continue; }
            const lit = 0.85 + 0.3 * (-0.6 * nx - 0.8 * ny) * 0.8, moss = noise(c * 0.6 + si * 3, r * 0.6 + sj * 5, 61) > 0.62;
            let col = P.dark ? [92, 98, 96] : [140, 132, 120];
            if (moss) col = mixC(col, [66, 106, 64], 0.55);
            col = mul(col, lit * (e > 0.8 && P.dark ? 0.72 : 1));
            const gl = [0, 0, 58, 183][(hh(c, r) * 4) | 0];
            stones.push({ c, r, rgb: pack(col), a: 0.8, g: gl, grgb: pack(mul(col, P.dark ? 1.6 : 0.6)), ga: 0.55 });
          }
        }
      });
      /* tufts: each blade is a line of glyphs fanning from a corner into the pond */
      const corners = [[0, 1], [1, 0], [1, 1], [0, 0]].slice(0, qn.fx > 1 ? 4 : 2);
      corners.forEach(([ex, ey], ci) => {
        const ox = ex * vw + (ex ? 8 : -8), oy = ey * vh + (ey ? 8 : -8), base = Math.atan2(vh / 2 - oy, vw / 2 - ox);
        const n = qn.fx > 1 ? 9 : 6;
        for (let b = 0; b < n; b++) {
          const th = base + (b / (n - 1) - 0.5) * 1.5 + (hh(ci, b * 3 + 1) - 0.5) * 0.18;
          tufts.push({ ox, oy, th, len: 6 + Math.floor(hh(ci, b * 3 + 2) * 8) + (b % 3 === 1 ? 3 : 0), ph: hh(ci, b * 3 + 3) * 6.28, cat: hh(ci, b * 3 + 4) < 0.32 });
        }
      });
    }
    function drawTufts() {
      const dark = P.dark, base = dark ? [74, 124, 66] : [52, 90, 46], tipc = dark ? [156, 196, 112] : [96, 140, 76], cat = pack(dark ? [150, 98, 54] : [104, 64, 34]);
      const sx = clamp(vw / 1280, 0.8, 1.25);
      for (const b of tufts) {
        const step = ch * 0.8 * sx;
        for (let k = 2; k <= b.len; k++) {
          const ang = b.th + Math.sin(t * 0.7 + b.ph + k * 0.35) * 0.03 * k;
          const x = b.ox + Math.cos(ang) * step * k, y = b.oy + Math.sin(ang) * step * k;
          if (x < -cw || x > vw + cw || y < -ch || y > vh + ch) continue;
          const u = k / b.len;
          if (k === b.len && b.cat) { put(35, cat, x, y, 1); continue; }
          put(lineGlyph(Math.cos(ang), Math.sin(ang)).charCodeAt(0), pack(mixC(base, tipc, u * 0.7)), x, y, 0.92);
        }
      }
    }
    function drawStones() {
      let fill = -1;
      const gap = Math.max(0.8, cw * 0.14), sn = v => Math.round(v * dpr) / dpr;
      for (const s of stones) {
        const x = s.c * cw, y = s.r * ch, dm = fadeAt(x + cw / 2, y + ch / 2);
        if (dm < 0.03) continue;
        if (glyphMode()) { if (s.a > 0.5) { ctx.globalAlpha = 0.8 * dm; glyphAt(s.g || 58, s.grgb, x + cw / 2, y + ch / 2); } continue; }
        if (s.rgb !== fill) { fill = s.rgb; ctx.fillStyle = css(fill); }
        ctx.globalAlpha = s.a * dm; const x0 = sn(x + gap), y0 = sn(y + gap);
        ctx.fillRect(x0, y0, sn(x + cw - gap) - x0, sn(y + ch - gap) - y0);
        if (s.g) { ctx.globalAlpha = s.ga * dm; glyphAt(s.g, s.grgb, x + cw / 2, y + ch / 2); }
      }
    }
    /* a shaft of light: a faint tile where it falls, warm by day */
    function drawShafts() {
      if (!shaftN) return;
      if (glyphMode()) {
        const lc = pack(P.dark ? [255, 244, 210] : [255, 252, 238]);
        for (let q = 0; q < shaftN; q++) { const i = shaftList[q], x = (i % cols) * cw + cw / 2, y = ((i / cols) | 0) * ch + ch / 2; ctx.globalAlpha = Math.min(0.5, shaftV[i] * 0.55); glyphAt(46, lc, x, y); }
        return;
      }
      const col = css(pack(P.dark ? [255, 244, 210] : [255, 252, 238])), k = P.dark ? 0.05 : 0.12, gap = Math.max(0.8, cw * 0.14), sn = v => Math.round(v * dpr) / dpr;
      ctx.fillStyle = col;
      for (let q = 0; q < shaftN; q++) {
        const i = shaftList[q], x = (i % cols) * cw, y = ((i / cols) | 0) * ch;
        ctx.globalAlpha = shaftV[i] * k;
        const x0 = sn(x + gap), y0 = sn(y + gap); ctx.fillRect(x0, y0, sn(x + cw - gap) - x0, sn(y + ch - gap) - y0);
      }
    }

    function drawBed() { drawShafts(); drawMoon(); drawStones(); }
    function drawSurface() { drawDrift(); drawFry(); }
    function drawAbove() { drawFrog(); drawDuck(); drawDragon(); drawFlies(); drawWeather(); drawTufts(); }

    /* the end of the frame: the light of the hour over everything, and the vignette at the edges */
    let vig = null, vigKey = "";
    function drawFinish() {
      const qn = Qn();
      if (skyOn && P.tintK > 0.01) {
        const ss = skyState, wa = P.dark ? Math.min(0.2, ss.night * 0.18 + ss.k * 0.05) : ss.k * 0.08;
        if (wa > 0.02) { ctx.globalAlpha = wa; ctx.fillStyle = css(pack(P.dark && ss.night > 0.5 ? [8, 14, 44] : ss.tint)); ctx.fillRect(0, 0, vw, vh); }
      }
      if (weatherNow === "rain") { ctx.globalAlpha = 0.1; ctx.fillStyle = P.dark ? "#142238" : "#6a7a8a"; ctx.fillRect(0, 0, vw, vh); }
      if (qn.fx) {
        /* the vignette is worked out once, at a quarter of the size, and stretched over the frame: a smooth shade needs no more */
        const key = vw + "x" + vh + P.dark;
        if (!vig || vigKey !== key) {
          vigKey = key;
          const vc = vig && vig.canvas ? vig.canvas : document.createElement("canvas"), sw = Math.max(8, Math.ceil(vw / 4)), shh = Math.max(8, Math.ceil(vh / 4));
          vc.width = sw; vc.height = shh;
          const g = vc.getContext("2d"), gr = g.createRadialGradient(sw / 2, shh / 2, Math.hypot(sw, shh) * 0.245, sw / 2, shh / 2, Math.hypot(sw, shh) / 2);
          gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, P.dark ? "rgba(0,0,0,0.5)" : "rgba(70,50,30,0.22)");
          g.clearRect(0, 0, sw, shh); g.fillStyle = gr; g.fillRect(0, 0, sw, shh);
          vig = { canvas: vc };
        }
        /* the shade is clear inside the middle rectangle (its gradient starts beyond the rectangle's corners), so only the four border bands are blended, with no seam */
        ctx.globalAlpha = 1;
        const vc = vig.canvas, sw = vc.width, sh2 = vc.height, bx = Math.ceil(vw * 0.26), by = Math.ceil(vh * 0.26), sbx = Math.ceil(sw * 0.26), sby = Math.ceil(sh2 * 0.26);
        ctx.drawImage(vc, 0, 0, sbx, sh2, 0, 0, bx, vh);
        ctx.drawImage(vc, sw - sbx, 0, sbx, sh2, vw - bx, 0, bx, vh);
        ctx.drawImage(vc, sbx, 0, sw - 2 * sbx, sby, bx, 0, vw - 2 * bx, by);
        ctx.drawImage(vc, sbx, sh2 - sby, sw - 2 * sbx, sby, bx, vh - by, vw - 2 * bx, by);
      }
    }

    function render() {
      for (const i of touched) { tileA[i] = 0; glyphA[i] = 0; tintA[i] = 0; }
      touched.length = 0;
      shade.fill(0);
      /* Koi fade under the title and ease back in around it: a clear space for the clock, and the letters take on their colour. */
      const box = opts.dim ? opts.dim() : null, pad = cw * 4;
      lastBox = box;
      const dimAt = box ? (x, y) => {
        const d = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
        return 0.46 + 0.54 * sstep(0, pad, d);
      } : () => 1;
      const order = fish.filter(f => f.seen > 0).sort((a, b) => a.depth - b.depth);
      fadeAt = dimAt;
      updateCaus();
      fid++;
      for (const f of order) rasterize(f, dimAt);
      rasterDrops();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(pack(P.water));
      ctx.fillRect(0, 0, vw, vh);
      ctx.font = `600 ${Math.round(ch * 0.74)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const dotRGB = pack(P.dot), shadeFill = P.dark ? "#000" : css(pack(mul(P.water, 0.55)));
      /* cell edges land on whole device pixels, so tiles stay crisp at any zoom */
      const snap = v => Math.round(v * dpr) / dpr, gap = Math.max(0.8, cw * 0.14), spark = 0.022;
      drawBed();
      /*
       * Every rectangle first, then every glyph, glyphs stamped from the atlas: the GPU gets a few long runs of
       * one kind instead of thousands of switches between filling and text.
       */
      ctx.fillStyle = shadeFill;
      for (let i = 0; i < shade.length; i++) {
        if (!(shade[i] > 0)) continue;
        const x = (i % cols) * cw, y = ((i / cols) | 0) * ch;
        ctx.globalAlpha = shade[i]; ctx.fillRect(snap(x), snap(y), snap(x + cw) - snap(x), snap(y + ch) - snap(y));
      }
      let fill = -1;
      for (const i of touched) {
        if (!(tileA[i] > 0)) continue;
        const x = (i % cols) * cw, y = ((i / cols) | 0) * ch, x0 = snap(x + gap), y0 = snap(y + gap);
        if (tileRGB[i] !== fill) { fill = tileRGB[i]; ctx.fillStyle = css(fill); }
        ctx.globalAlpha = tileA[i]; ctx.fillRect(x0, y0, snap(x + cw - gap) - x0, snap(y + ch - gap) - y0);
      }
      /* open water: ripples first, then the wake, then the caustic net, then a few sparkles; each cell shows the first that applies */
      if (rings.length) {
        for (const g of rings) {
          const age = t - g.born, Rm = ((g.small ? age * 34 + 4 : age * 74 + 26) * g.k) + cw * 2;
          if (age < 0 || Rm > 900) continue;
          const c0 = Math.max(0, Math.floor((g.x - Rm) / cw)), c1 = Math.min(cols - 1, Math.floor((g.x + Rm) / cw));
          const r0 = Math.max(0, Math.floor((g.y - Rm) / ch)), r1 = Math.min(rows - 1, Math.floor((g.y + Rm) / ch));
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const i = r * cols + c;
            if (mark[i] === fid || tileA[i] > 0 || glyphA[i] > 0) continue;
            const q = ringAt(c * cw + cw / 2, r * ch + ch / 2);
            if (!q) continue;
            mark[i] = fid; ctx.globalAlpha = q.a; glyphAt(q.g.charCodeAt(0), dotRGB, c * cw + cw / 2, r * ch + ch / 2);
          }
        }
      }
      for (let i = 0; i < wake.length; i++) {
        const w = wake[i];
        if (!(w > 0.03) || mark[i] === fid || tileA[i] > 0 || glyphA[i] > 0) continue;
        mark[i] = fid; ctx.globalAlpha = Math.min(0.5, w * 1.2);
        glyphAt(w > 0.25 ? 58 : 183, dotRGB, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2);
      }
      for (let k = 0; k < ambN; k++) {
        const i = ambList[k];
        if (mark[i] === fid || tileA[i] > 0 || glyphA[i] > 0) continue;
        mark[i] = fid; ctx.globalAlpha = ambA[i];
        glyphAt(ambG[i], dotRGB, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2);
      }
      for (let k = 0; k < sparkN; k++) {
        const i = sparkList[k];
        if (mark[i] === fid || tileA[i] > 0 || glyphA[i] > 0) continue;
        const c = i % cols, r = (i / cols) | 0, h = h2(c, r);
        ctx.globalAlpha = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t * 0.9 + h * 900));
        glyphAt(183, dotRGB, c * cw + cw / 2, r * ch + ch / 2);
      }
      fill = -1;
      for (const i of touched) {
        if (!(glyphA[i] > 0) || glyphCode[i] === 32) continue;
        ctx.globalAlpha = glyphA[i]; glyphAt(glyphCode[i], glyphRGB[i], (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2);
      }
      drawSurface();
      drawPads();
      drawAbove();
      drawFood();
      for (const p of paws) drawPaw(p);
      drawFinish();
      ctx.globalAlpha = 1;
    }

    /* From scratch: the shoal, then a few seconds of swimming so it starts in natural curves. */
    function reset() {
      makeFish();
      makePads();
      paws.length = rings.length = drops.length = food.length = bubbles.length = 0;
      drift.length = flakes.length = flies.length = 0; dragon = frog = duck = null; rc = 0; decorSeed = Math.floor(Math.random() * 1e6); buildDecor(); makeFry();
      wake.fill(0); wakeTmp.fill(0);
      t = 0;
      const n = count();
      fish.forEach((f, i) => { f.seen = i < n ? 1 : 0; });
      for (let j = 0; j < 90; j++) { t += 1 / 30; step(1 / 30); }
      simT = 0; planAt = 0;
    }

    /* Film mode: the pond at film time T, stepped forward in fixed steps; the same T always gives the same frame. draw = false only steps it. */
    function seek(T, draw = true) {
      if (!fish.length || T < simT - 1e-6) reset();
      while (simT + STEP <= T + 1e-6) {
        simT += STEP;
        while (planAt < plan.length && plan[planAt].at <= simT + 1e-6) plan[planAt++].fn();
        advance(STEP);
      }
      if (draw) render();
    }

    /*
     * Live mode: one animation frame. The pond moves at the display's rate and
     * draws a frame at most every 12 ms: a 60 Hz screen gets every frame, a
     * 120 Hz screen every other one. A slow machine simply gets fewer frames
     * from the browser; the time a draw call takes is no guide, as it includes
     * waiting for the GPU to finish the frame before.
     */
    let last = 0, drawn = 0, running = false, dirty = true;
    /* Adaptive quality: if frames arrive slower than about 38 per second for a couple of seconds it steps down a level
       (fewer koi and effects, bigger cells, 30 frames a second); when there is headroom for a long while it climbs back,
       and if it has to come down again soon after it stays down for five minutes. */
    let rawEma = 16.7, slowMs = 0, fastMs = 0, lastDown = -999, upAt = -999, noUpUntil = 0;
    function setLevel(n) { qLevel = clamp(n, 0, 2); size(vw, vh); colors(); dirty = true; rawEma = 16.7; slowMs = fastMs = 0; }
    function adapt(rawMs, now) {
      if (qMode !== "auto" || rawMs > 250 || rawMs <= 0 || (typeof document !== "undefined" && document.hidden)) return;
      rawEma = rawEma * 0.92 + rawMs * 0.08;
      const sec = now / 1000;
      if (rawEma > 26 && qLevel > 0) {
        slowMs += rawMs;
        if (slowMs > 1800) { if (sec - upAt < 20) noUpUntil = sec + 300; lastDown = sec; setLevel(qLevel - 1); }
      } else slowMs = 0;
      if (rawEma < 18.4 && qLevel < 2 && sec - lastDown > 30 && sec > noUpUntil) {
        fastMs += rawMs;
        if (fastMs > 12000) { upAt = sec; setLevel(qLevel + 1); }
      } else fastMs = 0;
    }
    let skyClock = 0;
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      const raw = now - last, dt = Math.min(0.05, raw / 1000 || 0);
      last = now;
      const moving = !paused && !reduce;
      if (moving && dt > 0) { advance(dt); adapt(raw, now); }
      /* the light of the hour is refreshed every half minute */
      skyClock += dt;
      if (skyClock > 30) { skyClock = 0; if (skyOn) { colors(); dirty = true; } }
      if (!moving && !dirty) return;
      if (now - drawn < Qn().ms - 1 && !dirty) return;
      dirty = false;
      drawn = now;
      render();
    }

    return {
      size(w, h) { size(w, h); colors(); dirty = true; },
      colors() { colors(); dirty = true; },
      reset,
      start() {
        reset();
        running = true;
        requestAnimationFrame(now => { last = now; frame(now); });
      },
      stop() { running = false; },
      seek,
      /* film events: at simulation time `at`, run fn */
      at(at, fn) { plan.push({ at, fn }); plan.sort((a, b) => a.at - b.at); return this; },
      paw: (x, y) => poke(x, y),
      feed: (x, y) => feed(x, y),
      pause(v) { paused = v === undefined ? !paused : !!v; dirty = true; return paused; },
      get paused() { return paused; },
      get count() { return count(); },
      /* looks: quality "auto" | "low" | "med" | "high"; style "tile" | "glyph"; weather "auto" | "none" | "rain" | "snow" | "leaves"; sky (time of day) on or off */
      setQuality(m) { if (!QNAMES.includes(m)) return qMode; qMode = m; qLevel = m === "auto" ? Math.max(qLevel, 1) : QNAMES.indexOf(m) - 1; size(vw, vh); colors(); dirty = true; return qMode; },
      get quality() { return qMode; },
      get qualityLevel() { return Qn().name; },
      setStyle(m) { styleMode = m === "glyph" ? "glyph" : "tile"; atlasInit(); buildShapes(); for (const p of pads) p.spr = null; dirty = true; return styleMode; },
      get style() { return styleMode; },
      setWeather(w) { weatherMode = w; dirty = true; return weatherMode; },
      get weather() { return weatherMode; },
      setSky(on) { skyOn = !!on; colors(); dirty = true; return skyOn; },
      get sky() { return skyOn; },
      get time() { return t; },
      /* for tests: the koi and the food */
      get fish() { return fish; },
      get life() { return { dragon, frog, duck, fry, drift: drift.length, flies: flies.length, weather: weatherNow, quality: Qn().name, pads: pads.map(p => ({ open: +p.open.toFixed(2), lotus: p.lotus, variant: p.variant })) }; },
      get food() { return food; },
      render() { render(); },
      /* The colour of the koi under canvas point (x, y), as [r, g, b, weight], or null: the title takes it on. */
      tint(x, y) {
        const c = Math.floor(x / cw), r = Math.floor(y / ch), i = r * cols + c;
        if (c < 0 || r < 0 || c >= cols || r >= rows || !(tintA[i] > 0)) return null;
        const n = tintRGB[i];
        return [n >> 16, (n >> 8) & 255, n & 255, tintA[i]];
      },
      /* The water's light at canvas point (x, y), 0 to 1, from the caustic net: the title catches it as it plays over. */
      light: (x, y) => caus(x, y)
    };
  }

  /*
   * A word drawn in character cells like the koi. The letters are sampled from
   * the real font outline. A cell the outline crosses gets a stroke along it
   * (| / - \, from the coverage gradient), moved a little toward the ink, so
   * the contour reads as one clean line; a cell inside a stroke is a tile with
   * a glyph pressed into it in the water's colour. A koi passing under takes
   * the cell to its colour, and where the caustic net crosses, the cell
   * brightens. A blurred glow canvas behind the letters carries that light.
   * New cells flicker through random glyphs and settle into the word; when the
   * text changes (the clock ticks), only the cells that changed flicker.
   *
   * spec() returns { text, font, cw, ch, maxW, tone, edge, glow }. look.tint(x, y)
   * and look.light(x, y) give the koi colour and the water's light under a cell
   * centre, in viewport pixels (a full-window pond's own). The colours are read from CSS:
   * --title-from, --title-to (left to right), --title-glow and --pond.
   */
  function AsciiMark(canvas, spec, look = {}) {
    const ctx = canvas.getContext("2d");
    const NOISE = "/\\|=+*%#@", EDGE = " |/-\\";
    let cols = 0, rows = 0, cw = 6, ch = 8, cov = null, born = null, edge = null, ex = null, ey = null;
    let tone = 1, glowK = 0, ready = false, dpr = 1, glow = null, gctx = null, gimg = null;
    /* the glyphs of one frame, drawn after the tiles */
    const Q = { g: [], x: [], y: [], a: [], f: [] };
    async function build(now) {
      const o = spec();
      cw = o.cw; ch = o.ch; tone = o.tone || 1; glowK = o.glow || 0;
      try { await document.fonts.load(o.font, o.text); } catch (e) { /* draw with the fallback font */ }
      /* Measure once at the font's own size, work out how far the word must shrink to fit, then rasterise the mask
         at the final size (not big-then-shrunk): hinting and thin strokes stay true, and every cell is an exact area average. */
      const num = /(\d+(?:\.\d+)?)px/, fontAt = n => o.font.replace(num, n.toFixed(2) + "px");
      const px0 = parseFloat((o.font.match(num) || [])[1]) || 100;
      const m = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      m.font = o.font; m.textBaseline = "alphabetic"; m.textAlign = "left";
      const met0 = m.measureText(o.text);
      const w0 = Math.max(met0.width || 1, (met0.actualBoundingBoxLeft || 0) + (met0.actualBoundingBoxRight || 0)) + px0 * 0.08;
      const px = px0 * Math.min(1, o.maxW / w0);
      /* supersampling: finer for small cells; bold thickens hairlines (Didone serifs) so they survive coarse cells */
      const SS = cw >= 6 ? 2 : 3, fS = px * SS, cwS = cw * SS, chS = ch * SS, bold = (o.bold || 0) * fS;
      m.font = fontAt(fS);
      const met = m.measureText(o.text);
      const asc = Math.max(1, Math.ceil(met.actualBoundingBoxAscent || fS * 0.78));
      const hasDesc = (met.actualBoundingBoxDescent || 0) > 2 * SS;
      const desc = hasDesc ? Math.max(Math.ceil(fS * 0.28), Math.ceil(met.actualBoundingBoxDescent || 0), Math.ceil(met.fontBoundingBoxDescent || 0)) : Math.ceil(met.actualBoundingBoxDescent || 0);
      const left = Math.max(0, Math.ceil(met.actualBoundingBoxLeft || 0));
      const tw = Math.max(Math.ceil(met.width || 1), Math.ceil((met.actualBoundingBoxLeft || 0) + (met.actualBoundingBoxRight || 0)));
      const pad = Math.ceil(fS * 0.04 + bold);
      const nc = Math.ceil((tw + pad * 2) / cwS), nr = Math.ceil((asc + desc + pad * 2) / chS);
      /* a window with no width yet (a hidden or prerendered tab): nothing to draw until it is resized */
      if (!nc || !nr || !isFinite(nc) || !isFinite(nr)) { ready = false; return; }
      const mw = nc * cwS, mh = nr * chS;
      m.canvas.width = mw; m.canvas.height = mh;
      m.font = fontAt(fS); m.textBaseline = "alphabetic"; m.textAlign = "left"; m.fillStyle = m.strokeStyle = "#000";
      m.fillText(o.text, pad + left, pad + asc);
      if (bold > 0) { m.lineWidth = bold; m.lineJoin = "round"; m.strokeText(o.text, pad + left, pad + asc); }
      const data = m.getImageData(0, 0, mw, mh).data;
      const sum = new Float32Array(nc * nr), top = new Uint8Array(nc * nr);
      for (let y = 0; y < mh; y++) {
        const row = ((y / chS) | 0) * nc;
        for (let x = 0; x < mw; x++) {
          const v = data[(y * mw + x) * 4 + 3];
          if (!v) continue;
          const i = row + ((x / cwS) | 0);
          sum[i] += v; if (v > top[i]) top[i] = v;
        }
      }
      /* exact coverage, lifted a little so a one-pixel stroke that fills a third of a cell still reads */
      const area = 255 * cwS * chS, next = new Float32Array(nc * nr);
      for (let i = 0; i < next.length; i++) { const a = sum[i] / area; next[i] = Math.min(1, Math.max(a * (o.gain || 1.12), (top[i] / 255) * 0.3 * Math.min(1, a * 8))); }
      /* the same grid: only cells that changed settle again */
      if (cov && nc === cols && nr === rows) for (let i = 0; i < next.length; i++) { if (Math.abs(next[i] - cov[i]) > 0.08) born[i] = now; }
      else born = new Float32Array(nc * nr).fill(now);
      cols = nc; rows = nr; cov = next;
      /* the outline: a stroke by the direction of the coverage gradient. The gradient is read from a 5-tap smoothed
         field, so neighbouring cells agree on a direction and the contour reads as one line instead of a ragged run. */
      edge = null;
      if (o.edge) {
        edge = new Uint8Array(cols * rows); ex = new Float32Array(cols * rows); ey = new Float32Array(cols * rows);
        const at = (c, r) => c < 0 || r < 0 || c >= cols || r >= rows ? 0 : cov[r * cols + c];
        const sm = (c, r) => (4 * at(c, r) + 2 * (at(c - 1, r) + at(c + 1, r) + at(c, r - 1) + at(c, r + 1)) + at(c - 1, r - 1) + at(c + 1, r - 1) + at(c - 1, r + 1) + at(c + 1, r + 1)) / 16;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const i = r * cols + c, v = cov[i];
          if (v < 0.06 || v >= 0.62) continue;
          const gx = (sm(c + 1, r) - sm(c - 1, r)) / (2 * cw), gy = (sm(c, r + 1) - sm(c, r - 1)) / (2 * ch);
          const n = Math.hypot(gx, gy);
          if (n * Math.min(cw, ch) < 0.1) continue;
          let a = Math.atan2(gy, gx) * 180 / Math.PI;
          if (a < 0) a += 180;
          edge[i] = a < 22.5 || a >= 157.5 ? 1 : a < 67.5 ? 2 : a < 112.5 ? 3 : 4;
          const k = (0.5 - v) * 0.7;
          ex[i] = gx / n * k * cw; ey[i] = gy / n * k * ch;
        }
      }
      dpr = Math.min(4, global.devicePixelRatio || 1);
      canvas.width = Math.round(cols * cw * dpr); canvas.height = Math.round(rows * ch * dpr);
      canvas.style.width = cols * cw + "px"; canvas.style.height = rows * ch + "px";
      /* the glow: one pixel per cell in the light the letters take on; CSS blurs it behind them */
      if (glowK && !glow) {
        glow = document.createElement("canvas");
        glow.className = "mark-glow"; glow.setAttribute("aria-hidden", "true");
        canvas.before(glow);
        gctx = glow.getContext("2d");
      }
      if (glow) {
        glow.width = cols; glow.height = rows; gimg = gctx.createImageData(cols, rows);
        glow.style.width = cols * cw + "px"; glow.style.height = rows * ch + "px";
      }
      ready = true;
    }
    function draw(now) {
      if (!ready) return;
      const cs = getComputedStyle(canvas);
      const from = rgb(cs.getPropertyValue("--title-from")), to = rgb(cs.getPropertyValue("--title-to")), water = cs.getPropertyValue("--pond").trim();
      const gv = parseFloat(cs.getPropertyValue("--title-glow")), gk = glowK * (isNaN(gv) ? 1 : gv);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cols * cw, rows * ch);
      if (glow) { glow.style.left = canvas.offsetLeft + "px"; glow.style.top = canvas.offsetTop + "px"; gimg.data.fill(0); }
      ctx.font = `700 ${(ch * (edge ? 0.95 : 1.1)).toFixed(1)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const snap = v => Math.round(v * dpr) / dpr, gap = cw <= 5 ? 0.4 : Math.max(0.75, cw * 0.14), G = gimg ? gimg.data : null, tick = Math.floor(now * 24);
      const lightMode = from[0] + from[1] + from[2] < 380;
      /* on light backgrounds structural / edge chars use the raw ink colour so they stay crisp and legible */
      const inkFill = lightMode ? css(pack(from)) : null;
      /* where each cell is on screen, to find the koi under it */
      const box = look.tint || look.light ? canvas.getBoundingClientRect() : null, sx = box ? box.width / (cols * cw) : 1, sy = box ? box.height / (rows * ch) : 1;
      /* the tiles are drawn as they come and the glyphs queued, then drawn in one run (as in the pond) */
      let n = 0;
      const glyph = (g, x, y, a, fill) => { Q.g[n] = g; Q.x[n] = x; Q.y[n] = y; Q.a[n] = a; Q.f[n] = fill; n++; };
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, v = cov[i], e = edge ? edge[i] : 0;
        /* raise the minimum coverage threshold for edge cells slightly to avoid stray specks */
        if (v < (e ? 0.09 : 0.12)) continue;
        const h = h2(c + 7, r + 3), x = c / cols, age = now - born[i], settle = 0.08 + h * 0.45;
        if (age < 0) continue;
        if (age < settle) {
          /* settling noise: on light backgrounds pin to ink colour so the scramble reads clearly */
          glyph(NOISE[(h2(i, tick) * NOISE.length) | 0], c * cw + cw / 2, r * ch + ch / 2,
            tone * (lightMode ? 0.5 + 0.5 * (age / settle) : 0.55 + 0.45 * (age / settle)),
            lightMode ? inkFill : css(pack(mixC(from, to, x))));
          continue;
        }
        const px = box ? box.left + (c + 0.5) * cw * sx : 0, py = box ? box.top + (r + 0.5) * ch * sy : 0;
        const k = look.tint && look.tint(px, py), w = k ? Math.min(1, k[3] * 1.35) : 0;
        const l = look.light ? clamp((look.light(px, py) - 0.72) / 0.28, 0, 1) : 0, L = l * l * (3 - 2 * l);
        const col = from.map((f, j) => {
          let n = f + (to[j] - f) * x;
          /* the koi tint the letters only lightly, so they stay legible; light water keeps them true black */
          if (k && !lightMode) n += (k[j] - n) * w * 0.4;
          return lightMode ? n : n + (255 - n) * 0.3 * L;
        });
        /* on light bg every glyph uses the pure ink colour; on dark bg use the computed (possibly tinted) col */
        const fill = lightMode ? inkFill : css(pack(col));
        const solidV = edge ? 0.56 : 0.34;
        /* edge outline chars: on light bg boost alpha so strokes are always sharp */
        if (e) glyph(EDGE[e], c * cw + cw / 2 + ex[i], r * ch + ch / 2 + ey[i],
          lightMode ? Math.min(1, tone * 1.3) : tone, fill);
        else if (v >= solidV) {
          /* inside a stroke: a tile like the koi's, with a glyph pressed into it in the water's colour */
          const x0 = snap(c * cw + gap), y0 = snap(r * ch + gap), tw = snap((c + 1) * cw - gap) - x0, th = snap((r + 1) * ch - gap) - y0;
          /* a soft shadow in the water's colour, cut to the letter itself (no box), lifts it off whatever is beneath */
          ctx.globalAlpha = (lightMode ? 0.15 : 0.5) * tone; ctx.fillStyle = lightMode ? css(pack(mul(from, 0.3))) : water; ctx.fillRect(x0 + 1, y0 + 1, tw, th);
          ctx.globalAlpha = tone; ctx.fillStyle = fill;
          ctx.fillRect(x0, y0, tw, th);
          if (cw > 5) glyph(v > 0.9 ? (h < 0.5 ? "#" : "@") : "%", c * cw + cw / 2, r * ch + ch / 2, (lightMode ? 0.14 : 0.2) * tone, water);
        /* sparse coverage — structural chars (+ :): on light bg scale alpha with coverage so they're bold */
        } else glyph(v > 0.32 ? "+" : ":", c * cw + cw / 2, r * ch + ch / 2,
          tone * (lightMode ? Math.min(1, 0.55 + v * 1.4) : 0.95), fill);
        if (G) {
          const q = i * 4, ga = gk * tone * (v >= 0.62 ? 1 : v) * (0.16 + 0.6 * w + 0.32 * L);
          G[q] = col[0]; G[q + 1] = col[1]; G[q + 2] = col[2]; G[q + 3] = Math.min(255, ga * 255);
        }
      }
      let fill = "";
      for (let j = 0; j < n; j++) {
        if (Q.f[j] !== fill) { fill = Q.f[j]; ctx.fillStyle = fill; }
        ctx.globalAlpha = Q.a[j]; ctx.fillText(Q.g[j], Q.x[j], Q.y[j]);
      }
      ctx.globalAlpha = 1;
      if (glow) gctx.putImageData(gimg, 0, 0);
    }
    return { build, draw, get glow() { return glow; }, get size() { return { w: cols * cw, h: rows * ch }; } };
  }

  global.AsciiKoi = { createPond, AsciiMark, seeded };
})(typeof window !== "undefined" ? window : globalThis);