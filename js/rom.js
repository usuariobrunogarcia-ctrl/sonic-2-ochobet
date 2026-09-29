'use strict';
// Carga de la ROM y descompresores (Kosinski y Nemesis), portados de KosDec y
// NemDec del desensamblado.

class Rom {
  constructor(bytes) {
    this.b = Rom.normalize(bytes);
    this.rev = Rom.detectRevision(this.b);
    if (!this.rev) throw new Error('No se reconoce la ROM. Usa Sonic The Hedgehog 2 (World) REV00 o REV01 (.bin/.md/.gen/.smd).');
    this.o = ROM_OFFSETS[this.rev];
  }

  // Acepta ROMs en formato .smd (cabecera de 512 bytes + bloques entrelazados).
  static normalize(b) {
    if (b.length % 0x4000 === 512 && b[8] === 0xAA && b[9] === 0xBB) {
      const data = b.subarray(512);
      const out = new Uint8Array(data.length);
      for (let blk = 0; blk < data.length; blk += 0x4000) {
        for (let i = 0; i < 0x2000; i++) {
          out[blk + i * 2 + 1] = data[blk + i];
          out[blk + i * 2] = data[blk + 0x2000 + i];
        }
      }
      return out;
    }
    return b;
  }

  // Busca la tabla de senos (0,6,$C,$12...) en el offset de cada revisión.
  static detectRevision(b) {
    for (const rev of Object.keys(ROM_OFFSETS)) {
      const o = ROM_OFFSETS[rev].Sine_Data;
      if (o + 8 > b.length) continue;
      if (b[o] === 0 && b[o + 1] === 0 && b[o + 2] === 0 && b[o + 3] === 6 &&
          b[o + 4] === 0 && b[o + 5] === 0x0C && b[o + 6] === 0 && b[o + 7] === 0x12) {
        // comprobación extra: la cabecera Kosinski del arte de EHZ
        const col = ROM_OFFSETS[rev].ColArrayVertical;
        if (col < b.length) return rev;
      }
    }
    return null;
  }

  u8(a) { return this.b[a]; }
  s8(a) { return (this.b[a] << 24) >> 24; }
  u16(a) { return (this.b[a] << 8) | this.b[a + 1]; }
  s16(a) { return ((this.b[a] << 24) | (this.b[a + 1] << 16)) >> 16; }
  u32(a) { return ((this.b[a] << 24) | (this.b[a + 1] << 16) | (this.b[a + 2] << 8) | this.b[a + 3]) >>> 0; }
  slice(a, n) { return this.b.slice(a, a + n); }

  kos(label) { return Rom.kosDec(this.b, typeof label === 'number' ? label : this.o[label]); }
  nem(label) { return Rom.nemDec(this.b, typeof label === 'number' ? label : this.o[label]); }

  // Kosinski: descriptor de 16 bits little-endian leído bit a bit (LSB primero).
  static kosDec(src, pos) {
    const out = [];
    let desc = src[pos] | (src[pos + 1] << 8); pos += 2;
    let bits = 16;
    const bit = () => {
      const r = desc & 1;
      desc >>>= 1;
      if (--bits === 0) { desc = src[pos] | (src[pos + 1] << 8); pos += 2; bits = 16; }
      return r;
    };
    for (;;) {
      if (bit()) { out.push(src[pos++]); continue; }
      let count, offset;
      if (bit()) {
        const lo = src[pos++], hi = src[pos++];
        offset = (((hi & 0xF8) << 5) | lo) - 0x2000;
        count = hi & 7;
        if (count) count += 2;
        else {
          const c = src[pos++];
          if (c === 0) break;
          if (c === 1) continue;
          count = c + 1;
        }
      } else {
        const b1 = bit(), b0 = bit();
        count = (b1 << 1 | b0) + 2;
        offset = src[pos++] - 0x100;
      }
      for (let i = 0; i < count; i++) out.push(out[out.length + offset]);
    }
    return Uint8Array.from(out);
  }

  // Nemesis: tabla de códigos Huffman + flujo de bits MSB primero; 8 nibbles por fila.
  static nemDec(src, pos) {
    const hdr = (src[pos] << 8) | src[pos + 1]; pos += 2;
    const xorMode = (hdr & 0x8000) !== 0;
    const tiles = hdr & 0x7FFF;
    const table = new Map();
    let b = src[pos++];
    let nib = 0;
    while (b !== 0xFF) {
      if (b & 0x80) { nib = b & 0x0F; b = src[pos++]; continue; }
      const run = ((b >> 4) & 7) + 1;
      const len = b & 0x0F;
      const code = src[pos++];
      table.set((len << 8) | code, (run << 4) | nib);
      b = src[pos++];
    }
    const out = new Uint8Array(tiles * 32);
    let o = 0;
    let bitbuf = 0, bitcnt = 0;
    const getBit = () => {
      if (bitcnt === 0) { bitbuf = src[pos++]; bitcnt = 8; }
      bitcnt--;
      return (bitbuf >> bitcnt) & 1;
    };
    let row = 0, rowNibs = 0, prevRow = 0;
    const total = tiles * 8; // filas
    let rowsDone = 0;
    const putNib = (n) => {
      row = ((row << 4) | n) >>> 0;
      if (++rowNibs === 8) {
        let v = row;
        if (xorMode) { v = (v ^ prevRow) >>> 0; prevRow = v; }
        out[o++] = v >>> 24; out[o++] = (v >>> 16) & 0xFF; out[o++] = (v >>> 8) & 0xFF; out[o++] = v & 0xFF;
        row = 0; rowNibs = 0; rowsDone++;
      }
    };
    while (rowsDone < total) {
      let code = 0, len = 0, entry;
      for (;;) {
        code = (code << 1) | getBit(); len++;
        if (len === 6 && code === 0x3F) { entry = -1; break; }
        const e = table.get((len << 8) | code);
        if (e !== undefined) { entry = e; break; }
        if (len > 8) throw new Error('Nemesis: código inválido');
      }
      let run, n;
      if (entry === -1) {
        run = ((getBit() << 2) | (getBit() << 1) | getBit()) + 1;
        n = (getBit() << 3) | (getBit() << 2) | (getBit() << 1) | getBit();
      } else { run = entry >> 4; n = entry & 0xF; }
      for (let i = 0; i < run && rowsDone < total; i++) putNib(n);
    }
    return out;
  }
}
