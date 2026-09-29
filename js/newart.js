'use strict';
// Sprites nuevos (Crabmeat, Meleon, carrito de mina...): convierte NEWART_DATA en
// patrones de 8x8 a 4 bits y en piezas de sprite como las de los mappings de S2.
//
// Se respetan los límites del Mega Drive: cada patrón usa una de las líneas de
// paleta ya cargadas (0 = Sonic, 1 = objetos de EHZ; de la línea 1 se evitan los
// colores que cicla PalCycle_EHZ), las piezas miden como mucho 4x4 patrones y
// cada juego de sprites ocupa una zona de VRAM que EHZ deja libre.

// Zonas de VRAM (índice de patrón) para cada juego de sprites
const NEWART_VRAM = {
  meleon: [0x3EE, 0x414],    // la que usaba Coconuts (Meleon lo sustituye)
  crabmeat: [0x500, 0x580],  // zona de enemigos de cada zona (libre en EHZ)
  props: [0x7A0, 0x7D4],     // la de Tails (no está portado: se juega con Sonic solo)
};

// Colores de la línea 1 que cambian con el ciclo de paleta del agua
const PAL1_CYCLED = [3, 4, 14, 15];

class NewArt {
  constructor(game) {
    this.game = game;
    const pal = game.vdp.palette;
    const rgb = (c) => [(c >> 1) & 7, (c >> 5) & 7, (c >> 9) & 7];
    // colores candidatos por línea: [índice, r, g, b]
    this.lines = [0, 1].map((line) => {
      const list = [];
      for (let i = 1; i < 16; i++) {
        if (line === 1 && PAL1_CYCLED.includes(i)) continue;
        list.push([i, ...rgb(pal[line * 16 + i])]);
      }
      return { line, list };
    });
    this.sets = {};
    this.tiles = []; // [índice de VRAM, datos de 32 bytes]
    for (const name of Object.keys(NEWART_VRAM)) this.sets[name] = this.buildSet(name);
  }

  // Carga los patrones en la VRAM (al empezar el acto, que borra la VRAM)
  load() {
    for (const [idx, data] of this.tiles) this.game.vdp.loadTiles(data, idx);
  }

  frames(name) { return this.sets[name]; }

  buildSet(name) {
    const def = NEWART_DATA[name];
    const [base, limit] = NEWART_VRAM[name];
    const cache = new Map();
    let next = base;
    // el color de cada índice del juego se aproxima al color más cercano de cada línea
    const quant = this.lines.map(({ list }) => def.pal.map(([r, g, b]) => {
      let best = null, bestErr = 1e9;
      for (const [i, R, G, B] of list) {
        // distancia con más peso en el verde (como la luminancia)
        const e = 3 * (r - R) ** 2 + 4 * (g - G) ** 2 + 2 * (b - B) ** 2;
        if (e < bestErr) { bestErr = e; best = i; }
      }
      return [best, bestErr];
    }));
    const frames = def.frames.map((fr) => {
      const h = fr.rows.length, w = fr.rows[0].length;
      const tw = (w + 7) >> 3, th = (h + 7) >> 3;
      const px = (x, y) => {
        if (y >= h || x >= w) return 0;
        const c = fr.rows[y][x];
        return c === '.' ? 0 : parseInt(c, 16);
      };
      // patrón de cada celda con la línea de paleta que menos error da
      const cells = [];
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const src = [];
          let any = false;
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const c = px(tx * 8 + x, ty * 8 + y); src.push(c); if (c) any = true; }
          if (!any) { cells.push(null); continue; }
          let line = 0, bestErr = 1e9;
          for (let l = 0; l < quant.length; l++) {
            let e = 0;
            for (const c of src) if (c) e += quant[l][c - 1][1];
            if (e < bestErr) { bestErr = e; line = l; }
          }
          cells.push({ line, pix: src.map((c) => (c ? quant[line][c - 1][0] : 0)), used: false });
        }
      }
      const cell = (x, y) => (x < tw && y < th ? cells[y * tw + x] : null);
      // piezas rectangulares (hasta 4x4 patrones) de celdas no vacías de la misma línea
      const pieces = [];
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const c0 = cell(tx, ty);
          if (!c0 || c0.used) continue;
          const ok = (x, y) => { const c = cell(x, y); return c && !c.used && c.line === c0.line; };
          let pw = 1;
          while (pw < 4 && ok(tx + pw, ty)) pw++;
          let ph = 1;
          while (ph < 4) {
            let all = true;
            for (let i = 0; i < pw; i++) if (!ok(tx + i, ty + ph)) { all = false; break; }
            if (!all) break;
            ph++;
          }
          // orden de patrones del VDP: por columnas
          const data = new Uint8Array(pw * ph * 32);
          let o = 0;
          for (let i = 0; i < pw; i++) {
            for (let j = 0; j < ph; j++) {
              const c = cell(tx + i, ty + j);
              c.used = true;
              for (let k = 0; k < 64; k += 2) data[o++] = (c.pix[k] << 4) | c.pix[k + 1];
            }
          }
          const key = c0.line + ':' + data.join(',');
          let idx = cache.get(key);
          if (idx === undefined) {
            idx = next;
            next += pw * ph;
            if (next > limit) throw new Error(`NewArt: "${name}" no cabe en la VRAM`);
            cache.set(key, idx);
            this.tiles.push([idx, data]);
          }
          pieces.push({ x: tx * 8 - fr.ax, y: ty * 8 - fr.ay, size: ((pw - 1) << 2) | (ph - 1), tile: (this.lines[c0.line].line << 13) | idx });
        }
      }
      return pieces;
    });
    frames.tilesUsed = next - base;
    return frames;
  }
}
