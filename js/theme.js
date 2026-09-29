'use strict';
// Tema alternativo "Ruinas": arte nuevo en pixel art para Emerald Hill 1 que respeta
// el diseño, los bloques, los chunks y las colisiones de la ROM. Sólo se sustituyen
// los píxeles de los patrones (8x8, 4bpp) y las paletas (9 bits por color), así que
// todo cabe en las limitaciones del Mega Drive: 4 líneas de 16 colores, patrones
// volteables y los mismos índices de VRAM que usa el juego original.
//
// Los patrones del primer plano se generan a partir de los originales: para cada
// patrón se busca su colocación más habitual en el nivel y se "pinta" en coordenadas
// de mundo (ladrillos, musgo, hierba seca...) usando el color original como mapa de
// materiales y la solidez del bloque para distinguir muro de decoración.

const mdColor = (r, g, b) => (b << 9) | (g << 5) | (r << 1);

// Línea 2: primer plano. Índices con papel fijo para que el sombreado sea sencillo.
const TH = {
  DEEP: 1,                         // casi negro oliva (contornos, sombras profundas)
  BRICK: [2, 3, 4, 5, 6],          // rampa de piedra oliva, de oscuro a claro
  GRASS: [7, 8, 9, 10, 11],        // hierba seca dorada, de oscuro a claro
  STEEL: [12, 13, 14],             // metal
  RUST: 15,                        // óxido / acento cálido
};

const THEME_LINE2 = [
  mdColor(1, 5, 5),                // 0: color de fondo (cielo)
  mdColor(1, 1, 0),                // 1
  mdColor(1, 2, 1), mdColor(2, 3, 1), mdColor(3, 4, 2), mdColor(4, 5, 2), mdColor(5, 6, 3),
  mdColor(2, 1, 0), mdColor(4, 2, 0), mdColor(5, 4, 1), mdColor(6, 5, 1), mdColor(7, 6, 3),
  mdColor(2, 2, 3), mdColor(4, 4, 5), mdColor(6, 6, 6),
  mdColor(5, 2, 1),
];

// Línea 3: fondo (cielo, nubes, montañas, cordilleras) y flores del primer plano
const THEME_LINE3 = [
  0,
  mdColor(1, 4, 4), mdColor(2, 5, 5), mdColor(3, 6, 5), mdColor(5, 7, 6), mdColor(7, 7, 7),
  mdColor(4, 5, 5), mdColor(7, 5, 3), mdColor(6, 3, 1), mdColor(4, 2, 1), mdColor(3, 1, 1),
  mdColor(2, 0, 1), mdColor(1, 0, 0), mdColor(7, 2, 1), mdColor(6, 5, 1), mdColor(5, 1, 3),
];

// Flores del primer plano (línea 3 original -> línea 3 nueva): pétalos blancos, rojos
// y ciruela, tallos y hojas en los tonos de la hierba seca
const THEME_REMAP3 = [0, 12, 12, 6, 4, 13, 5, 5, 13, 15, 7, 10, 7, 13, 9, 14];
// Madera (puente, cocos): rampa dorada de la línea 2
const THEME_WOOD = [0, 1, 1, 7, 8, 8, 9, 10, 9, 7, 8, 8, 9, 10, 10, 11];

// Hash entero determinista -> [0, 1)
function thHash(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Matriz de Bayer 4x4 para tramas
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

class Theme {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    this.build();
    this.bgPlane = (x, y) => this.bgNames[((y >> 3) & 31) * 64 + ((x >> 3) & 63)];
  }

  // ------------------------------------------------------------------ análisis
  blockAt(x, y) {
    const L = this.level;
    x &= 0x3FFF; y &= 0x7FF;
    const chunk = L.layout[((y >> 7) << 8) + (x >> 7)];
    return L.chunks[(chunk << 6) + (((y >> 4) & 7) << 3) + ((x >> 4) & 7)];
  }

  // Píxel original del primer plano: (línea << 4) | índice
  origPix(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const tw = this.level.tileAt(x, y, 0);
    const c = this.orig[(tw & 0x7FF) * 64 + ((tw & 0x1000) ? 7 - (y & 7) : (y & 7)) * 8 + ((tw & 0x800) ? 7 - (x & 7) : (x & 7))];
    return c ? (((tw >> 13) & 3) << 4) | c : 0;
  }

  build() {
    const L = this.level;
    this.w = 0x2A00; this.h = 0x400;
    // copia expandida del arte original (1 byte por píxel)
    const art = L.art, n = art.length >> 5;
    this.nTiles = n;
    this.orig = new Uint8Array(n * 64);
    for (let i = 0; i < n * 32; i++) { this.orig[i * 2] = art[i] >> 4; this.orig[i * 2 + 1] = art[i] & 15; }
    // colocaciones de cada patrón agrupadas por fase de ladrillo (x mod 16, y mod 16, volteos)
    const groups = new Map();
    this.tileLine = new Uint8Array(0x800).fill(2);
    for (let Y = 0; Y < this.h; Y += 8) {
      for (let X = 0; X < this.w; X += 8) {
        const tw = L.tileAt(X, Y, 0), t = tw & 0x7FF;
        this.tileLine[t] = (tw >> 13) & 3;
        if (t >= n) continue;
        const key = t * 64 + ((X >> 3) & 1) * 32 + ((Y >> 3) & 1) * 16 + ((tw >> 11) & 3);
        let gr = groups.get(key);
        if (!gr) groups.set(key, gr = { t, list: [] });
        gr.list.push(X, Y, tw);
      }
    }
    this.place = new Array(n).fill(null);
    // patrones libres para el fondo nuevo: los que el primer plano no usa (el fondo
    // original deja de usarse), salvo el 0 y los de la plataforma Obj18 ($56-$65)
    const fgUsed = new Uint8Array(n);
    for (const gr of groups.values()) fgUsed[gr.t] = 1;
    this.free = [];
    for (let t = 1; t < n; t++) if (!fgUsed[t] && !(t >= 0x56 && t <= 0x65)) this.free.push(t);
    const best = new Array(n).fill(0);
    for (const gr of groups.values()) {
      const cnt = gr.list.length / 3;
      if (cnt > best[gr.t]) {
        best[gr.t] = cnt;
        const i = Math.floor(cnt / 2) * 3; // colocación central del grupo
        this.place[gr.t] = { x: gr.list[i], y: gr.list[i + 1], hf: (gr.list[i + 2] & 0x800) !== 0, vf: (gr.list[i + 2] & 0x1000) !== 0, line: (gr.list[i + 2] >> 13) & 3 };
      }
    }
    this.genTiles();
    this.genBackground();
  }

  // ------------------------------------------------------------------ materiales
  // Clasificación del píxel original en coordenadas de mundo
  mat(x, y) {
    const p = this.origPix(x, y);
    if (!p) return 0;                         // transparente
    const line = p >> 4, c = p & 15;
    if (line !== 2) return 5;                 // otros (agua, flores): se tratan aparte
    if (c >= 8) return 2;                     // hierba
    if (c === 2) return 4;
    return 1;                                  // tierra / roca
  }

  // Patrones con damero (los "cofres" de EHZ): se convierten en paneles tallados
  findPanels() {
    const n = this.nTiles, o = this.orig;
    const rock = (c) => c && c < 8 && c !== 2;
    this.isPanel = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      let rows = 0;
      for (let y = 0; y < 8; y++) {
        const r = t * 64 + y * 8, a = o[r + 1], b = o[r + 6];
        if (rock(a) && rock(b) && a !== b && o[r] === a && o[r + 2] === a && o[r + 5] === b && o[r + 7] === b) rows++;
      }
      if (rows >= 5) this.isPanel[t] = 1;
    }
  }
  panelCell(cx, cy) {
    const tw = this.level.tileAt(cx << 3, cy << 3, 0);
    return (tw & 0x7FF) < this.nTiles && this.isPanel[tw & 0x7FF] === 1;
  }

  // ¿El grupo de celdas con damero es pequeño (un cofre) o un muro entero?
  panelSmall(cx, cy) {
    if (!this.panelSize) this.panelSize = new Map();
    const k = cy * 0x1000 + cx;
    if (this.panelSize.has(k)) return this.panelSize.get(k);
    const seen = new Set([k]), stack = [[cx, cy]], cells = [];
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    while (stack.length && seen.size < 60) {
      const [x, y] = stack.pop();
      cells.push(y * 0x1000 + x);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = (y + dy) * 0x1000 + x + dx;
        if (!seen.has(nk) && this.panelCell(x + dx, y + dy)) { seen.add(nk); stack.push([x + dx, y + dy]); }
      }
    }
    const small = seen.size < 60 && x1 - x0 < 4 && y1 - y0 < 6;
    for (const c of cells) this.panelSize.set(c, small);
    this.panelSize.set(k, small);
    return small;
  }

  genTiles() {
    const n = this.nTiles;
    this.findPanels();
    this.tiles = new Uint8Array(n * 64);
    for (let t = 0; t < n; t++) {
      const pl = this.place[t];
      // patrón de superficie: contiene hierba o huecos (sólo en ellos se sombrea bajo la hierba)
      this.surf = false;
      for (let i = 0; i < 64; i++) { const c = this.orig[t * 64 + i]; if (!c || c >= 8) this.surf = true; }
      for (let ty = 0; ty < 8; ty++) {
          for (let tx = 0; tx < 8; tx++) {
          const c = this.orig[t * 64 + ty * 8 + tx];
          let v;
          if (!c) v = 0;
          else if (!pl) v = this.remap(2, c);
          else {
            const wx = pl.x + (pl.hf ? 7 - tx : tx), wy = pl.y + (pl.vf ? 7 - ty : ty);
            v = this.shade(wx, wy, pl.line, c);
          }
          this.tiles[t * 64 + ty * 8 + tx] = v;
        }
      }
    }
  }

  // Reasignación directa de color (patrones sin colocación en el nivel)
  remap(line, c) {
    if (line === 3) return THEME_REMAP3[c];
    if (line !== 2) return c;
    if (c >= 8) return TH.GRASS[[0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2, 3, 3, 3, 4][c]];
    return [0, 1, 1, 2, 3, 4, 5, 6][c];
  }

  shade(x, y, line, c) {
    if (line !== 2) return this.remap(line, c);
    if (c >= 8) return this.grass(x, y, c);
    if (c === 2) return TH.DEEP;
    // objetos finos (troncos, postes): transparente a ambos lados en la misma fila
    let l = 0, r = 0;
    for (let d = 1; d <= 7; d++) { if (!l && !this.origPix(x - d, y)) l = d; if (!r && !this.origPix(x + d, y)) r = d; }
    if (l && r) return this.pole(x, y, c, l, r);
    if (this.panelCell(x >> 3, y >> 3)) {
      if (this.panelSmall(x >> 3, y >> 3)) return this.panel(x, y);
      return this.masonry(x, y, c, true);                 // muro interior en sombra
    }
    return this.masonry(x, y, c);
  }

  // Hierba seca: más oscura en la raíz, puntas claras
  grass(x, y, c) {
    let lv = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2, 3, 3, 3, 4][c];
    let below = 0;
    while (below < 12 && this.mat(x, y + below + 1) === 2) below++;
    const m = this.mat(x, y + below + 1);
    if (m === 1 || m === 4) {
      if (below < 2) lv = Math.min(lv, 0);
      else if (below < 5) lv = Math.min(lv - 1, 2);
    }
    if (this.mat(x, y - 1) === 0 && lv >= 2) lv = 4;
    return TH.GRASS[Math.max(0, Math.min(4, lv))];
  }

  // Postes de metal (antiguos troncos de palmera)
  pole(x, y, c, l, r) {
    const w = l + r - 1, p = l - 1; // anchura y posición dentro del poste
    if (p === 0 || p === w - 1) return TH.DEEP;
    const f = p / (w - 1);
    if ((y & 15) === 0) return TH.STEEL[0];
    if ((y & 15) === 1) return f < 0.5 ? TH.STEEL[2] : TH.STEEL[1];
    return f < 0.35 ? TH.STEEL[2] : f < 0.7 ? TH.STEEL[1] : TH.STEEL[0];
  }

  // Panel rehundido con tachones dorados (uno por celda de 8x8)
  panel(x, y) {
    const cx = x >> 3, cy = y >> 3, px = x & 7, py = y & 7;
    const up = this.panelCell(cx, cy - 1), dn = this.panelCell(cx, cy + 1);
    const lf = this.panelCell(cx - 1, cy), rt = this.panelCell(cx + 1, cy);
    if ((!up && py === 0) || (!lf && px === 0) || (!rt && px === 7) || (!dn && py === 7)) return TH.DEEP;
    if (!up && py === 1) return TH.BRICK[0];             // sombra del borde superior
    if (!dn && py === 6) return TH.BRICK[3];             // borde inferior iluminado
    if ((!lf && px === 1) || (!rt && px === 6)) return TH.BRICK[1];
    // tachón en forma de rombo centrado en la celda
    const dx = Math.abs(px - 3.5), dy = Math.abs(py - 3.5);
    const d = dx + dy;
    if (d <= 2) {
      if (px < 4 && py < 4) return TH.GRASS[4];
      if (px >= 4 && py < 4) return TH.GRASS[3];
      if (px < 4) return TH.GRASS[2];
      return TH.GRASS[1];
    }
    if (d <= 3 && py >= 4 && px >= 3) return TH.BRICK[0];  // sombra del tachón
    return TH.BRICK[2];
  }

  // Profundidad bajo la superficie (distancia hasta el primer píxel no rocoso encima)
  depth(x, y) {
    let d = 0;
    while (d < 96) {
      const m = this.mat(x, y - d - 2);
      if (m !== 1) break;
      d += 2;
    }
    return d;
  }

  // Ladrillo 16x8 a soga, iluminado desde arriba
  masonry(x, y, c, dark) {
    const dep = this.surf && !dark ? this.depth(x, y) : 99;
    // borde oscuro bajo la hierba: se conserva la silueta original
    if (c === 1 && dep < 6) {
      for (let d = 1; d <= 3; d++) if (this.mat(x, y - d) === 2) return TH.DEEP;
    }
    // raíces colgando bajo la hierba
    const rh = thHash(x, 0, 7);
    if (rh < 0.14 && dep < 3 + rh * 70) return (thHash(x, y >> 2, 8) < 0.5 || dep < 3) ? TH.DEEP : TH.GRASS[0];
    const row = y >> 3, off = (row & 1) * 8;
    const bx = (x + off) & 15, by = y & 7;
    const bid = Math.floor((x + off) / 16);
    let lv = dep < 5 || dark ? 1 : 2;                     // sombra bajo la hierba
    if (by === 7) lv = Math.min(lv, 1) - 1;               // junta horizontal
    else if (bx === 0) lv = Math.min(lv, 1) - 1;          // junta vertical
    else if (bx === 15 || by === 6) lv -= 1;              // cara en sombra
    else if (by === 0) lv += (bx === 1 || bx === 2) && lv >= 2 ? 2 : 1; // arista iluminada
    else {
      if (by === 5 && ((x + y) & 1)) lv -= 1;             // trama hacia la sombra
      // picaduras (con brillo debajo), grietas y desgaste
      const hh = thHash(x, y, 2);
      if (hh < 0.03 && by < 5) lv -= 1;
      else if (hh > 0.985) lv += 1;
      else if (by > 1 && thHash(x, y - 1, 2) < 0.03) lv += 1;
      if (thHash(bid, row, 3) < 0.12) {                  // ladrillo agrietado
        const k = Math.floor(thHash(bid, row, 4) * 10) + 3;
        if (bx === k + (by >> 1) || bx === k + 1 + (by >> 1) && by === 5) lv = Math.min(lv, 1) - 1;
      }
    }
    // canto oscuro junto a los huecos
    if (!this.origPix(x - 1, y) || !this.origPix(x + 1, y) || !this.origPix(x, y + 1)) lv = Math.min(lv, 1) - 1;
    if (lv < 0) return TH.DEEP;
    return TH.BRICK[Math.min(4, lv)];
  }


  // ------------------------------------------------------------------ fondo
  // Se pinta una imagen de 512x256 (el tamaño del plano B) pensada para las bandas
  // de scroll de SwScrl_EHZ, se trocea en patrones con volteos y se reduce hasta
  // caber en los patrones libres.
  paintBackground() {
    const W = 512, H = 256, img = new Uint8Array(W * H);
    const put = (x, y, c) => { if (y >= 0 && y < H) img[y * W + (x & 511)] = c; };
    const get = (x, y) => img[y * W + (x & 511)];
    const dith = (x, y, a, b, f) => (BAYER4[(y & 3) * 4 + (x & 3)] < f ? b : a);
    // cielo: bandas horizontales con transiciones tramadas
    const sky = [[0, 1], [16, 1], [24, 2], [44, 2], [52, 3], [64, 3], [74, 4], [80, 4]];
    for (let y = 0; y < 80; y++) {
      let c = 1, f = 0, c2 = 1;
      for (let i = 0; i < sky.length - 1; i++) {
        if (y >= sky[i][0] && y < sky[i + 1][0]) { c = sky[i][1]; c2 = sky[i + 1][1]; f = (y - sky[i][0]) / (sky[i + 1][0] - sky[i][0]); }
      }
      for (let x = 0; x < W; x++) put(x, y, c === c2 ? c : dith(x, y, c, c2, f * f));
    }
    // nubes pequeñas (unión de círculos), sombra abajo
    const clouds = [[40, 24, 8], [150, 34, 6], [240, 20, 7], [330, 30, 9], [440, 22, 6]];
    for (const [cx, cy, r] of clouds) {
      const puffs = [];
      const k = 3 + (r >> 1);
      for (let i = 0; i < k; i++) {
        const a = (i / (k - 1) - 0.5) * 2;
        puffs.push([cx + a * r * 1.8, cy - (1 - a * a) * r * 0.6 + thHash(cx, i, 20) * 2, r * (0.55 + 0.45 * (1 - Math.abs(a))) + thHash(cy, i, 21) * 1.5]);
      }
      for (let y = cy - r * 2; y <= cy + r; y++) {
        for (let x = cx - r * 3; x <= cx + r * 3; x++) {
          let inside = false, top = 1e9;
          for (const [px, py, pr] of puffs) {
            const d = Math.hypot(x - px, (y - py) * 1.25);
            if (d <= pr) { inside = true; top = Math.min(top, d / pr); }
          }
          if (!inside || y > cy + 1) continue;
          const low = y >= cy - 1;
          put(Math.round(x), y, low ? 6 : (top > 0.75 && y > cy - r * 0.4) ? 4 : 5);
        }
      }
    }
    // montañas: cadena lejana (bruma) y macizo anaranjado, periódicos cada 256
    const peaks = (seed, n, yMin, yMax) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ x: (i + 0.2 + thHash(i, seed, 30) * 0.6) * 256 / n, y: yMin + thHash(i, seed, 31) * (yMax - yMin),
          sl: 0.5 + thHash(i, seed, 32) * 0.35, sr: 0.55 + thHash(i, seed, 33) * 0.35, k: 0.25 + thHash(i, seed, 34) * 0.35 });
      }
      return out;
    };
    const jag = (x, seed) => {                          // silueta dentada periódica
      const a = x & 255, i = a >> 2, f = (a & 3) / 4;
      const h0 = thHash(i & 63, seed, 35), h1 = thHash((i + 1) & 63, seed, 35);
      return (h0 * (1 - f) + h1 * f) * 2.5;
    };
    const surface = (list, x, seed) => {
      let best = 1e9, who = null;
      for (const p of list) {
        for (const o of [-256, 0, 256]) {
          const dx = x - (p.x + o);
          const y = p.y + (dx < 0 ? -dx * p.sl : dx * p.sr) + jag(x, seed) * Math.min(1, Math.abs(dx) / 6);
          if (y < best) { best = y; who = { p, dx, o }; }
        }
      }
      return [best, who];
    };
    const far = peaks(1, 6, 40, 54);
    const near = peaks(2, 6, 32, 58);
    for (let x = 0; x < W; x++) {
      const xx = x & 255;
      const [fy] = surface(far, xx, 1);
      for (let y = Math.ceil(fy); y < 80; y++) put(x, y, (y - fy) < 1 ? 3 : dith(x, y, 6, 4, (y - 66) / 14));
      const [ny, who] = surface(near, xx, 2);
      const streak = thHash(xx, 2, 36);
      for (let y = Math.ceil(ny); y < 80; y++) {
        const d = y - ny;
        const ridgeX = who.p.x + who.o + (y - who.p.y) * who.p.k;   // arista que baja del pico
        const lit = xx < ridgeX;
        let c;
        if (lit) {
          c = d < 1 ? 7 : 8;
          if (Math.abs(xx - ridgeX) < 1 && y > who.p.y + 1) c = 7;       // arista iluminada
          if (streak < 0.18 && d > 2 && d < 6 + streak * 60) c = (y & 1) || d > 4 ? 9 : 8; // cárcavas
        } else {
          c = d < 1 ? 8 : 9;
          if (streak > 0.84 && d > 2 && d < 4 + (1 - streak) * 90) c = 10;
          if (xx - ridgeX < 2) c = 10;                                      // sombra junto a la arista
        }
        if (y >= 66) c = dith(x, y, c, 6, (y - 66) / 13);                 // bruma en la base
        put(x, y, c);
      }
    }
    // lago (banda con ondulación): franjas claras que el scroll hace temblar
    for (let y = 80; y < 112; y++) {
      for (let x = 0; x < W; x++) {
        let c = y < 82 ? 4 : y < 94 ? 3 : 2;
        if (y >= 94 && y < 98) c = dith(x, y, 3, 2, (y - 94) / 4);
        if (y < 101) {
          const h = thHash((x >> 3) & 7, y, 40);
          if ((y & 1) === 0 && h < 0.3 && (x & 7) < 5) c = y < 90 ? 5 : 4;
        }
        put(x, y, c);
      }
    }
    // cordilleras granates (112-127 y 128-143)
    const ridge = (y0, y1, amp, per, seed, body, top, dark) => {
      for (let x = 0; x < W; x++) {
        const px = x % per;
        let h = 0;
        for (let k = 1; k <= 3; k++) h += Math.sin((px / per) * Math.PI * 2 * k + thHash(k, seed, 50) * 6.28) * amp / k;
        const ty = Math.round(y0 + amp + 1 + h);
        for (let y = Math.max(y0, ty); y < y1; y++) {
          let c = body;
          if (y === ty) c = top;
          else if (y === ty + 1 && (x & 1)) c = top;
          else if (thHash(px >> 1, y >> 2, seed + 51) < 0.12) c = dark;       // matorrales
          put(x, y, c);
        }
      }
    };
    for (let y = 112; y < 128; y++) for (let x = 0; x < W; x++) put(x, y, 2);
    ridge(112, 128, 3, 128, 3, 10, 9, 11);
    for (let y = 128; y < 144; y++) for (let x = 0; x < W; x++) put(x, y, 10);
    ridge(128, 144, 3, 64, 4, 11, 10, 12);
    // llanura en perspectiva (144-223): filas de matorral oscuro que crecen hacia abajo
    let y = 144, row = 0;
    while (y < 224) {
      const size = 3 + row;
      const body = row < 4 ? 11 : 10, dark = row < 4 ? 12 : 11, lite = row < 4 ? 10 : 9, tip = row < 6 ? 9 : 8;
      for (let yy = y; yy < Math.min(224, y + size); yy++) {
        const dy = (yy - y) / size;
        for (let x = 0; x < W; x++) {
          const px = x & 31;
          const edge = Math.sin((px / 32) * Math.PI * 2 + row) * 0.2 + Math.sin((px / 32) * Math.PI * 6 + row * 2) * 0.1;
          const top = 0.25 + edge;
          let c = dark;                                       // hueco entre matorrales
          if (dy >= top) c = body;
          if (dy >= top && dy < top + 0.2) c = ((x + yy) & 1) ? lite : body;
          if (Math.abs(dy - top) < 0.5 / size) c = tip;       // borde iluminado
          if (dy > 0.85) c = dark;
          put(x, yy, c);
        }
      }
      y += size; row++;
    }
    return img;
  }

  genBackground() {
    const W = 512, img = this.paintBackground();
    // las filas 224-255 no se ven: repiten la última fila visible
    for (let y = 224; y < 256; y++) img.copyWithin(y * W, 216 * W + (y & 7) * W, 216 * W + (y & 7) * W + W);
    const cells = [];                                  // contenido de cada celda de 8x8
    for (let cy = 0; cy < 32; cy++) {
      for (let cx = 0; cx < 64; cx++) {
        const t = new Uint8Array(64);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = img[(cy * 8 + y) * W + cx * 8 + x];
        cells.push(t);
      }
    }
    const flip = (t, h, v) => { const o = new Uint8Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o[y * 8 + x] = t[(v ? 7 - y : y) * 8 + (h ? 7 - x : x)]; return o; };
    const key = (t) => String.fromCharCode.apply(null, t);
    const uniq = [], index = new Map(), map = new Array(cells.length);
    cells.forEach((t, i) => {
      for (let f = 0; f < 4; f++) {
        const k = key(flip(t, f & 1, f & 2));
        if (index.has(k)) { map[i] = { u: index.get(k), f }; return; }
      }
      index.set(key(t), uniq.length);
      map[i] = { u: uniq.length, f: 0 };
      uniq.push({ t, n: 0 });
    });
    map.forEach((m) => uniq[m.u].n++);
    // reducción: se fusionan los patrones menos usados con su vecino más parecido
    const budget = this.free.length;
    const dist = (a, b) => { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++; return d; };
    const alive = uniq.map(() => true), redirect = uniq.map((_, i) => i);
    let count = uniq.length;
    while (count > budget) {
      let bestCost = 1e9, bi = -1, bj = -1;
      for (let i = 0; i < uniq.length; i++) {
        if (!alive[i]) continue;
        for (let j = 0; j < uniq.length; j++) {
          if (i === j || !alive[j]) continue;
          const c = dist(uniq[i].t, uniq[j].t) * uniq[i].n;
          if (c < bestCost) { bestCost = c; bi = i; bj = j; }
        }
      }
      alive[bi] = false; redirect[bi] = bj; uniq[bj].n += uniq[bi].n; count--;
    }
    const resolve = (i) => { while (redirect[i] !== i) i = redirect[i]; return i; };
    // asignación de VRAM
    const slot = new Map();
    this.bgTiles = [];
    let k = 0;
    for (let i = 0; i < uniq.length; i++) if (alive[i]) { slot.set(i, this.free[k]); this.bgTiles.push([this.free[k], uniq[i].t]); k++; }
    this.bgNames = new Uint16Array(64 * 32);
    map.forEach((m, i) => {
      const r = resolve(m.u);
      this.bgNames[i] = (3 << 13) | slot.get(r) | ((m.f & 1) ? 0x800 : 0) | ((m.f & 2) ? 0x1000 : 0);
    });
    const perRow = [];
    for (let r = 0; r < 32; r++) { const set = new Set(); for (let c = 0; c < 64; c++) set.add(map[r * 64 + c].u); perRow.push(set.size); }
    this.bgStats = { unique: uniq.length, budget, perRow: perRow.join(' ') };
  }

  // ------------------------------------------------------------------ aplicación
  apply() {
    const g = this.game, vdp = g.vdp;
    vdp.vram.set(this.tiles, 0);
    vdp.setPalette(2, THEME_LINE2);
    vdp.setPalette(3, THEME_LINE3);
    for (const [t, px] of this.bgTiles) vdp.vram.set(px, t * 64);
    // sprites con arte propio en la línea 2 (puente, cocos): se recolorean al usarse
    this.spriteFixed = new Set();
    vdp.spriteHook = (pieces, art) => this.fixSprite(pieces, art);
  }

  // Vuelve al arte original de la ROM
  remove() {
    const g = this.game, vdp = g.vdp, rom = g.rom;
    vdp.loadTiles(this.level.art, 0);
    const pal = (addr, n) => { const w = []; for (let i = 0; i < n; i++) w.push(rom.u16(addr + i * 2)); return w; };
    vdp.setPalette(2, pal(rom.o.Pal_EHZ + 32, 16));
    vdp.setPalette(3, pal(rom.o.Pal_EHZ + 64, 16));
    for (const t of this.spriteFixed || []) this.recolorTile(t, true);
    vdp.spriteHook = null;
  }

  fixSprite(pieces, art) {
    for (const p of pieces) {
      const w = p.tile + art;
      if (((w >> 13) & 3) !== 2) continue;
      const t0 = w & 0x7FF;
      if (t0 < this.nTiles) continue;               // arte del nivel: ya está hecho
      const n = (((p.size >> 2) & 3) + 1) * ((p.size & 3) + 1);
      for (let t = t0; t < t0 + n; t++) {
        if (this.spriteFixed.has(t)) continue;
        this.spriteFixed.add(t);
        this.recolorTile(t, false);
      }
    }
  }

  recolorTile(t, undo) {
    const v = this.game.vdp.vram, o = t * 64;
    if (!this.spriteOrig) this.spriteOrig = new Map();
    if (undo) { const b = this.spriteOrig.get(t); if (b) v.set(b, o); return; }
    this.spriteOrig.set(t, v.slice(o, o + 64));
    for (let i = 0; i < 64; i++) v[o + i] = THEME_WOOD[v[o + i]];
  }

  // Arte animado (flores, bola de EHZ): se transforma el frame de la ROM
  animFrame(src, nTiles, dest) {
    if (!this.animCache) this.animCache = new Map();
    const key = src * 4096 + dest;
    let out = this.animCache.get(key);
    if (out) return out;
    const b = this.game.rom.b;
    out = new Uint8Array(nTiles * 32);
    for (let t = 0; t < nTiles; t++) {
      const line = this.tileLine[dest + t];
      for (let i = 0; i < 32; i++) {
        const v = b[src + t * 32 + i];
        out[t * 32 + i] = (this.remap(line, v >> 4) << 4) | this.remap(line, v & 15);
      }
    }
    this.animCache.set(key, out);
    return out;
  }

  // Palabra de patrón del plano B (64x32 celdas)
  bgTile(x, y) {
    return this.bgNames[((y >> 3) & 31) * 64 + ((x >> 3) & 63)];
  }
}
