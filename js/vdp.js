'use strict';
// "VDP" por software: 320x224, dos planos (A = primer plano del nivel, B = fondo)
// con scroll horizontal por línea, sprites con prioridad y paleta de 64 colores.

const SCREEN_W = 320, SCREEN_H = 224;
// Niveles de la DAC del Mega Drive para los valores 0..7 de cada componente.
const MD_LEVELS = [0, 52, 87, 116, 144, 172, 206, 255];

class VDP {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.fb = new Uint32Array(this.img.data.buffer);
    this.vram = new Uint8Array(2048 * 64);        // patrones expandidos: 1 byte por píxel
    this.palette = new Uint16Array(64);            // colores en formato MD (0000BBB0GGG0RRR0)
    this.rgba = new Uint32Array(64);
    this.bgColor = 0x20;                           // registro $87: línea 2, color 0
    this.hscrollA = new Int16Array(SCREEN_H);
    this.hscrollB = new Int16Array(SCREEN_H);
    this.vscrollA = 0;
    this.vscrollB = 0;
    this.planeA = null;                            // función (x, y) -> palabra de patrón
    this.planeB = null;
    this.sprites = [];
    this.sprCol = new Uint8Array(SCREEN_W * SCREEN_H);
    this.sprPri = new Uint8Array(SCREEN_W * SCREEN_H);
    this.lineA = new Uint8Array(SCREEN_W); this.lineAP = new Uint8Array(SCREEN_W);
    this.lineB = new Uint8Array(SCREEN_W); this.lineBP = new Uint8Array(SCREEN_W);
    this.fadeLevel = 0; // 0 = normal, 1..7 = oscurecido (fundidos)
    this.whiteFade = 0;
  }

  loadTiles(data, tileIndex) {
    const n = data.length >> 5;
    for (let t = 0; t < n; t++) {
      const dst = (tileIndex + t) * 64, src = t * 32;
      for (let i = 0; i < 32; i++) {
        const b = data[src + i];
        this.vram[dst + i * 2] = b >> 4;
        this.vram[dst + i * 2 + 1] = b & 15;
      }
    }
  }

  setPalette(line, words) {
    for (let i = 0; i < words.length; i++) this.palette[line * 16 + i] = words[i];
  }

  updateRGBA() {
    const f = this.fadeLevel, w = this.whiteFade;
    for (let i = 0; i < 64; i++) {
      const c = this.palette[i];
      let r = (c >> 1) & 7, g = (c >> 5) & 7, b = (c >> 9) & 7;
      if (f) { r = Math.max(0, r - f); g = Math.max(0, g - f); b = Math.max(0, b - f); }
      if (w) { r = Math.min(7, r + w); g = Math.min(7, g + w); b = Math.min(7, b + w); }
      this.rgba[i] = 0xFF000000 | (MD_LEVELS[b] << 16) | (MD_LEVELS[g] << 8) | MD_LEVELS[r];
    }
  }

  // Añade un sprite con un frame de mappings de formato S2
  // (y:byte, tamaño:byte, patrón:word, patrón 2P:word, x:word por pieza).
  // Las piezas se dibujan en el orden dado; la primera queda encima.
  addSprite(pieces, sx, sy, artTile, flags) {
    this.sprites.push({ pieces, sx, sy, artTile, flags });
  }

  renderSprites() {
    this.sprCol.fill(0);
    this.sprPri.fill(0);
    const vram = this.vram;
    // El primer sprite de la lista tiene mayor prioridad: dibujamos del último al primero.
    for (let s = this.sprites.length - 1; s >= 0; s--) {
      const sp = this.sprites[s];
      const xflip = (sp.flags & 1) !== 0, yflip = (sp.flags & 2) !== 0;
      const pcs = sp.pieces;
      for (let p = pcs.length - 1; p >= 0; p--) {
        const pc = pcs[p];
        const w = ((pc.size >> 2) & 3) + 1, h = (pc.size & 3) + 1;
        let tileWord = (pc.tile + sp.artTile) & 0xFFFF;
        let px = pc.x, py = pc.y;
        if (xflip) { tileWord ^= 0x800; px = -px - w * 8; }
        if (yflip) { tileWord ^= 0x1000; py = -py - h * 8; }
        this.drawPiece(sp.sx + px, sp.sy + py, w, h, tileWord);
      }
    }
  }

  drawPiece(x0, y0, w, h, tw) {
    const pri = (tw >> 15) & 1, pal = ((tw >> 13) & 3) << 4;
    const hf = (tw & 0x800) !== 0, vf = (tw & 0x1000) !== 0;
    const base = tw & 0x7FF;
    if (x0 >= SCREEN_W || y0 >= SCREEN_H || x0 + w * 8 <= 0 || y0 + h * 8 <= 0) return;
    const vram = this.vram, col = this.sprCol, pr = this.sprPri;
    for (let tx = 0; tx < w; tx++) {
      for (let ty = 0; ty < h; ty++) {
        const tile = (base + tx * h + ty) & 0x7FF;
        const dx = x0 + (hf ? (w - 1 - tx) : tx) * 8;
        const dy = y0 + (vf ? (h - 1 - ty) : ty) * 8;
        const tb = tile * 64;
        for (let yy = 0; yy < 8; yy++) {
          const sy = dy + yy;
          if (sy < 0 || sy >= SCREEN_H) continue;
          const row = tb + (vf ? 7 - yy : yy) * 8;
          const o = sy * SCREEN_W;
          for (let xx = 0; xx < 8; xx++) {
            const sx = dx + xx;
            if (sx < 0 || sx >= SCREEN_W) continue;
            const c = vram[row + (hf ? 7 - xx : xx)];
            if (c) { col[o + sx] = pal | c; pr[o + sx] = pri; }
          }
        }
      }
    }
  }

  renderPlaneLine(plane, sy, scrollX, scrollY, out, outP) {
    const y = sy + scrollY;
    const vram = this.vram;
    let x = -scrollX;
    let sx = 0;
    while (sx < SCREEN_W) {
      const tw = plane(x, y);
      const hf = (tw & 0x800) !== 0, vf = (tw & 0x1000) !== 0;
      const pal = ((tw >> 13) & 3) << 4, pri = (tw >> 15) & 1;
      const row = (tw & 0x7FF) * 64 + (vf ? 7 - (y & 7) : (y & 7)) * 8;
      let tx = x & 7;
      for (; tx < 8 && sx < SCREEN_W; tx++, sx++, x++) {
        const c = vram[row + (hf ? 7 - tx : tx)];
        out[sx] = c ? (pal | c) : 0;
        outP[sx] = pri;
      }
    }
  }

  render() {
    this.updateRGBA();
    this.renderSprites();
    const fb = this.fb, rgba = this.rgba, bg = rgba[this.bgColor];
    const A = this.lineA, AP = this.lineAP, B = this.lineB, BP = this.lineBP;
    const sc = this.sprCol, sp = this.sprPri;
    for (let y = 0; y < SCREEN_H; y++) {
      if (this.planeB) this.renderPlaneLine(this.planeB, y, this.hscrollB[y], this.vscrollB, B, BP); else B.fill(0);
      if (this.planeA) this.renderPlaneLine(this.planeA, y, this.hscrollA[y], this.vscrollA, A, AP); else A.fill(0);
      const o = y * SCREEN_W;
      for (let x = 0; x < SCREEN_W; x++) {
        // Orden: fondo, B baja, A baja, sprite baja, B alta, A alta, sprite alta
        let c = 0;
        const s = sc[o + x], spri = sp[o + x];
        if (s && spri) c = s;
        else if (A[x] && AP[x]) c = A[x];
        else if (B[x] && BP[x]) c = B[x];
        else if (s) c = s;
        else if (A[x]) c = A[x];
        else if (B[x]) c = B[x];
        fb[o + x] = c ? rgba[c] : bg;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.sprites.length = 0;
  }
}
