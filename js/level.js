'use strict';
// Datos del nivel (patrones, bloques 16x16, chunks 128x128, layout) y rutinas de
// colisión con el terreno portadas de s2.asm (Find_Tile, FindFloor, FindWall...).

const s16 = (v) => (v << 16) >> 16;
const s8 = (v) => (v << 24) >> 24;
const u8 = (v) => v & 0xFF;
const u16 = (v) => v & 0xFFFF;

class Level {
  constructor(rom) {
    this.rom = rom;
    const o = rom.o;
    this.art = rom.kos('ArtKos_EHZ');
    const bm16 = rom.kos('BM16_EHZ');
    this.blocks = new Uint16Array(0x1800 >> 1); // Block_Table ($1800 bytes)
    for (let i = 0; i < bm16.length >> 1; i++) this.blocks[i] = (bm16[i * 2] << 8) | bm16[i * 2 + 1];
    const bm128 = rom.kos('BM128_EHZ');
    this.chunks = new Uint16Array(0x8000 >> 1);
    for (let i = 0; i < bm128.length >> 1; i++) this.chunks[i] = (bm128[i * 2] << 8) | bm128[i * 2 + 1];
    this.layout = rom.kos('Level_EHZ1');
    this.colP = rom.kos('ColP_EHZHTZ');
    this.colS = rom.kos('ColS_EHZHTZ');
    this.colV = rom.slice(o.ColArrayVertical, 0x1000);
    this.colH = rom.slice(o.ColArrayHorizontal, 0x1000);
    this.curve = rom.slice(o.ColCurveMap, 0x100);
    this.colAddr = this.colP;
    this.primaryAngle = 0;
    this.secondaryAngle = 0;
    this.a4 = 0; // 0 = Primary_Angle, 1 = Secondary_Angle
    // Tamaño del nivel (LevelSize, EHZ acto 1)
    this.minX = 0; this.maxX = 0x29A0; this.minY = 0; this.maxY = 0x320;
    this.startX = rom.u16(o.StartLocations); this.startY = rom.u16(o.StartLocations + 2);
  }

  // Palabra de patrón del primer plano (layer 0) o fondo (layer 1) en coordenadas de nivel.
  tileAt(x, y, layer) {
    x &= 0x3FFF; y &= 0x7FF;
    const chunk = this.layout[((y >> 7) << 8) + (layer << 7) + (x >> 7)];
    const bw = this.chunks[(chunk << 6) + (((y >> 4) & 7) << 3) + ((x >> 4) & 7)];
    let px = x & 15, py = y & 15;
    let flip = 0;
    if (bw & 0x400) { px = 15 - px; flip ^= 0x800; }
    if (bw & 0x800) { py = 15 - py; flip ^= 0x1000; }
    const tw = this.blocks[((bw & 0x3FF) << 2) + ((py >> 3) << 1) + (px >> 3)];
    // Se devuelve una palabra coherente con los 8 píxeles de la fila en coordenadas
    // de pantalla: con bloque volteado, la inversión se compone con la del patrón.
    return tw ^ flip;
  }

  setAngle(v) { if (this.a4) this.secondaryAngle = u8(v); else this.primaryAngle = u8(v); }
  getAngle() { return this.a4 ? this.secondaryAngle : this.primaryAngle; }

  // Find_Tile: devuelve la palabra de bloque 16x16 del chunk en (d3, d2)
  findTile(d2, d3) {
    const row = (d2 * 2) & 0xF00;
    const col = (u16(d3) >> 7) & 0x7F;
    const chunk = this.layout[row + col];
    return this.chunks[(chunk << 6) + ((d2 & 0x70) >> 1) + ((u16(d3) >> 4) & 7)];
  }

  // Rutina común de FindFloor/FindFloor2: devuelve la altura (con signo) o null si no hay colisión
  _vertHeight(d2, d3, d5, d6) {
    const d4 = this.findTile(d2, d3);
    const blk = d4 & 0x3FF;
    if (!blk || !((d4 >> d5) & 1)) return null;
    let cid = this.colAddr[blk];
    if (!cid) return null;
    let ang = this.curve[cid];
    let d1 = d3;
    if (d4 & 0x400) { d1 = ~d1; ang = u8(-ang); }
    if (d4 & 0x800) { ang = u8(-(u8(ang + 0x40))); ang = u8(ang - 0x40); }
    this.setAngle(ang);
    let h = s8(this.colV[(cid << 4) + (d1 & 0xF)]);
    if ((d4 ^ d6) & 0x800) h = -h;
    return h;
  }

  _horzWidth(d2, d3, d5, d6) {
    const d4 = this.findTile(d2, d3);
    const blk = d4 & 0x3FF;
    if (!blk || !((d4 >> d5) & 1)) return null;
    let cid = this.colAddr[blk];
    if (!cid) return null;
    let ang = this.curve[cid];
    let d1 = d2;
    if (d4 & 0x800) { d1 = ~d1; ang = u8(-(u8(ang + 0x40))); ang = u8(ang - 0x40); }
    if (d4 & 0x400) ang = u8(-ang);
    this.setAngle(ang);
    let w = s8(this.colH[(cid << 4) + (d1 & 0xF)]);
    if ((d4 ^ d6) & 0x400) w = -w;
    return w;
  }

  findFloor(d2, d3, d5, d6, a3) {
    let h = this._vertHeight(d2, d3, d5, d6);
    if (h === null || h === 0) return this.findFloor2(d2 + a3, d3, d5, d6) + 0x10;
    if (h < 0) {
      const t = (d2 & 0xF) + h;
      if (t >= 0) return this.findFloor2(d2 + a3, d3, d5, d6) + 0x10;
      return this.findFloor2(d2 - a3, d3, d5, d6) - 0x10;
    }
    if (h === 0x10) return this.findFloor2(d2 - a3, d3, d5, d6) - 0x10;
    return 0xF - ((d2 & 0xF) + h);
  }

  findFloor2(d2, d3, d5, d6) {
    const h = this._vertHeight(d2, d3, d5, d6);
    if (h === null || h === 0) return 0xF - (d2 & 0xF);
    if (h < 0) {
      const t = (d2 & 0xF) + h;
      if (t >= 0) return 0xF - (d2 & 0xF);
      return s16(~(d2 & 0xF)); // not.w d1 (d1 = y & $F)
    }
    return 0xF - ((d2 & 0xF) + h);
  }

  // Ring_FindFloor (anillos desperdigados)
  ringFindFloor(d2, d3, d5, d6, a3) {
    const h = this._vertHeight(d2, d3, d5, d6);
    if (h === null || h === 0) return 0x10;
    if (h < 0) {
      if ((d2 & 0xF) + h >= 0) return 0x10;
      return this.findFloor2(d2 - a3, d3, d5, d6) - 0x10;
    }
    if (h === 0x10) return this.findFloor2(d2 - a3, d3, d5, d6) - 0x10;
    return 0xF - ((d2 & 0xF) + h);
  }

  findWall(d2, d3, d5, d6, a3) {
    const w = this._horzWidth(d2, d3, d5, d6);
    if (w === null || w === 0) return this.findWall2(d2, d3 + a3, d5, d6) + 0x10;
    if (w < 0) {
      if ((d3 & 0xF) + w >= 0) return this.findWall2(d2, d3 + a3, d5, d6) + 0x10;
      return this.findWall2(d2, d3 - a3, d5, d6) - 0x10;
    }
    if (w === 0x10) return this.findWall2(d2, d3 - a3, d5, d6) - 0x10;
    return 0xF - ((d3 & 0xF) + w);
  }

  findWall2(d2, d3, d5, d6) {
    const w = this._horzWidth(d2, d3, d5, d6);
    if (w === null || w === 0) return 0xF - (d3 & 0xF);
    if (w < 0) {
      if ((d3 & 0xF) + w >= 0) return 0xF - (d3 & 0xF);
      return s16(~(d3 & 0xF));
    }
    return 0xF - ((d3 & 0xF) + w);
  }
}
