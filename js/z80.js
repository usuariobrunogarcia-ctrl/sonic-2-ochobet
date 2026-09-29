'use strict';
// CPU Zilog Z80 con instrucciones no documentadas y conteo de ciclos (T-states).
// Se usa para ejecutar el driver de sonido original de Sonic 2.

const FC = 0x01, FN = 0x02, FP = 0x04, FX = 0x08, FH = 0x10, FY = 0x20, FZ = 0x40, FS = 0x80;

const Z80_SZ = new Uint8Array(256), Z80_SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let f = (i & 0x80) | (i & (FY | FX));
  if (i === 0) f |= FZ;
  Z80_SZ[i] = f;
  let p = i; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1;
  Z80_SZP[i] = f | ((p & 1) ? 0 : FP);
}

// Ciclos base de las instrucciones sin prefijo (los condicionales añaden los extra al tomarse)
const Z80_CYC = [
  4, 10, 7, 6, 4, 4, 7, 4, 4, 11, 7, 6, 4, 4, 7, 4,
  8, 10, 7, 6, 4, 4, 7, 4, 12, 11, 7, 6, 4, 4, 7, 4,
  7, 10, 16, 6, 4, 4, 7, 4, 7, 11, 16, 6, 4, 4, 7, 4,
  7, 10, 13, 6, 11, 11, 10, 4, 7, 11, 13, 6, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  7, 7, 7, 7, 7, 7, 4, 7, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 10, 11, 7, 11, 5, 10, 10, 0, 10, 17, 7, 11,
  5, 10, 10, 11, 10, 11, 7, 11, 5, 4, 10, 11, 10, 0, 7, 11,
  5, 10, 10, 19, 10, 11, 7, 11, 5, 4, 10, 4, 10, 0, 7, 11,
  5, 10, 10, 4, 10, 11, 7, 11, 5, 6, 10, 4, 10, 0, 7, 11,
];

class Z80 {
  constructor(read, write) {
    this.read = read; this.write = write;
    this.reset();
  }

  reset() {
    this.a = 0xFF; this.f = 0xFF; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0; this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0xFFFF; this.iy = 0xFFFF; this.sp = 0xFFFF; this.pc = 0;
    this.i = 0; this.r = 0; this.iff1 = 0; this.iff2 = 0; this.im = 0;
    this.halted = false; this.eiDelay = false;
    this.cycles = 0;
    this.intLine = false;
  }

  // --------------------------------------------------------------- helpers
  rd(a) { return this.read(a & 0xFFFF); }
  wr(a, v) { this.write(a & 0xFFFF, v & 0xFF); }
  rd16(a) { return this.rd(a) | (this.rd(a + 1) << 8); }
  wr16(a, v) { this.wr(a, v); this.wr(a + 1, v >> 8); }
  fetch() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const v = this.rd16(this.pc); this.pc = (this.pc + 2) & 0xFFFF; return v; }
  push(v) { this.sp = (this.sp - 2) & 0xFFFF; this.wr16(this.sp, v); }
  pop() { const v = this.rd16(this.sp); this.sp = (this.sp + 2) & 0xFFFF; return v; }
  get bc() { return (this.b << 8) | this.c; } set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  get de() { return (this.d << 8) | this.e; } set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
  get hl() { return (this.h << 8) | this.l; } set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }
  get af() { return (this.a << 8) | this.f; } set af(v) { this.a = (v >> 8) & 0xFF; this.f = v & 0xFF; }
  incR() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F); }

  // --------------------------------------------------------------- ALU
  add8(v, carry) {
    const a = this.a, r = a + v + carry;
    this.f = Z80_SZ[r & 0xFF] | ((r >> 8) & FC) | ((a ^ v ^ r) & FH) | (((a ^ ~v) & (a ^ r) & 0x80) ? FP : 0);
    this.a = r & 0xFF;
  }
  sub8(v, carry) {
    const a = this.a, r = a - v - carry;
    this.f = Z80_SZ[r & 0xFF] | ((r >> 8) & FC) | FN | ((a ^ v ^ r) & FH) | (((a ^ v) & (a ^ r) & 0x80) ? FP : 0);
    this.a = r & 0xFF;
  }
  cp8(v) {
    const a = this.a, r = a - v;
    this.f = (Z80_SZ[r & 0xFF] & ~(FY | FX)) | (v & (FY | FX)) | ((r >> 8) & FC) | FN | ((a ^ v ^ r) & FH) | (((a ^ v) & (a ^ r) & 0x80) ? FP : 0);
  }
  and8(v) { this.a &= v; this.f = Z80_SZP[this.a] | FH; }
  xor8(v) { this.a = (this.a ^ v) & 0xFF; this.f = Z80_SZP[this.a]; }
  or8(v) { this.a = (this.a | v) & 0xFF; this.f = Z80_SZP[this.a]; }
  alu(op, v) {
    switch (op) {
      case 0: this.add8(v, 0); break;
      case 1: this.add8(v, this.f & FC); break;
      case 2: this.sub8(v, 0); break;
      case 3: this.sub8(v, this.f & FC); break;
      case 4: this.and8(v); break;
      case 5: this.xor8(v); break;
      case 6: this.or8(v); break;
      case 7: this.cp8(v); break;
    }
  }
  inc8(v) {
    const r = (v + 1) & 0xFF;
    this.f = (this.f & FC) | Z80_SZ[r] | ((v ^ r) & FH) | (v === 0x7F ? FP : 0);
    return r;
  }
  dec8(v) {
    const r = (v - 1) & 0xFF;
    this.f = (this.f & FC) | Z80_SZ[r] | FN | ((v ^ r) & FH) | (v === 0x80 ? FP : 0);
    return r;
  }
  add16(a, b) {
    const r = a + b;
    this.f = (this.f & (FS | FZ | FP)) | ((r >> 16) & FC) | ((a ^ b ^ r) >> 8 & FH) | ((r >> 8) & (FY | FX));
    return r & 0xFFFF;
  }
  adc16(b) {
    const a = this.hl, r = a + b + (this.f & FC);
    this.f = ((r >> 8) & (FS | FY | FX)) | ((r & 0xFFFF) ? 0 : FZ) | ((r >> 16) & FC) | ((a ^ b ^ r) >> 8 & FH) |
      (((a ^ ~b) & (a ^ r) & 0x8000) ? FP : 0);
    this.hl = r & 0xFFFF;
  }
  sbc16(b) {
    const a = this.hl, r = a - b - (this.f & FC);
    this.f = ((r >> 8) & (FS | FY | FX)) | ((r & 0xFFFF) ? 0 : FZ) | ((r >> 16) & FC) | FN | ((a ^ b ^ r) >> 8 & FH) |
      (((a ^ b) & (a ^ r) & 0x8000) ? FP : 0);
    this.hl = r & 0xFFFF;
  }
  // rotaciones/desplazamientos del prefijo CB
  rot(op, v) {
    let r, c;
    switch (op) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 0xFF; break;            // RLC
      case 1: c = v & 1; r = ((v >> 1) | (c << 7)) & 0xFF; break;      // RRC
      case 2: c = v >> 7; r = ((v << 1) | (this.f & FC)) & 0xFF; break; // RL
      case 3: c = v & 1; r = ((v >> 1) | ((this.f & FC) << 7)) & 0xFF; break; // RR
      case 4: c = v >> 7; r = (v << 1) & 0xFF; break;                  // SLA
      case 5: c = v & 1; r = ((v >> 1) | (v & 0x80)) & 0xFF; break;    // SRA
      case 6: c = v >> 7; r = ((v << 1) | 1) & 0xFF; break;            // SLL (no doc.)
      case 7: c = v & 1; r = v >> 1; break;                            // SRL
    }
    this.f = Z80_SZP[r] | c;
    return r;
  }

  // --------------------------------------------------------------- registros por índice
  getR(i) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.rd(this.hl); case 7: return this.a;
    }
  }
  setR(i, v) {
    v &= 0xFF;
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.wr(this.hl, v); break; case 7: this.a = v; break;
    }
  }
  cond(i) {
    switch (i) {
      case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ);
      case 2: return !(this.f & FC); case 3: return !!(this.f & FC);
      case 4: return !(this.f & FP); case 5: return !!(this.f & FP);
      case 6: return !(this.f & FS); case 7: return !!(this.f & FS);
    }
  }

  // --------------------------------------------------------------- interrupciones
  interrupt() {
    if (!this.iff1 || this.eiDelay) return 0;
    this.halted = false;
    this.iff1 = this.iff2 = 0;
    this.incR();
    if (this.im === 2) {
      this.push(this.pc);
      this.pc = this.rd16((this.i << 8) | 0xFF);
      return 19;
    }
    this.push(this.pc);
    this.pc = 0x38;
    return 13;
  }

  // Ejecuta una instrucción y devuelve los ciclos consumidos
  step() {
    if (this.intLine && this.iff1 && !this.eiDelay) {
      const c = this.interrupt();
      if (c) return c;
    }
    this.eiDelay = false;
    if (this.halted) { this.incR(); return 4; }
    this.incR();
    const op = this.fetch();
    return this.exec(op);
  }

  exec(op) {
    let cyc = Z80_CYC[op];
    switch (op) {
      case 0x00: break;
      case 0x01: this.bc = this.fetch16(); break;
      case 0x02: this.wr(this.bc, this.a); break;
      case 0x03: this.bc = (this.bc + 1) & 0xFFFF; break;
      case 0x04: this.b = this.inc8(this.b); break;
      case 0x05: this.b = this.dec8(this.b); break;
      case 0x06: this.b = this.fetch(); break;
      case 0x07: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xFF; this.f = (this.f & (FS | FZ | FP)) | (this.a & (FY | FX)) | c; break; }
      case 0x08: { let t = this.a; this.a = this.a_; this.a_ = t; t = this.f; this.f = this.f_; this.f_ = t; break; }
      case 0x09: this.hl = this.add16(this.hl, this.bc); break;
      case 0x0A: this.a = this.rd(this.bc); break;
      case 0x0B: this.bc = (this.bc - 1) & 0xFFFF; break;
      case 0x0C: this.c = this.inc8(this.c); break;
      case 0x0D: this.c = this.dec8(this.c); break;
      case 0x0E: this.c = this.fetch(); break;
      case 0x0F: { const c = this.a & 1; this.a = ((this.a >> 1) | (c << 7)) & 0xFF; this.f = (this.f & (FS | FZ | FP)) | (this.a & (FY | FX)) | c; break; }
      case 0x10: { const d = this.fetch(); this.b = (this.b - 1) & 0xFF; if (this.b) { this.pc = (this.pc + ((d << 24) >> 24)) & 0xFFFF; cyc = 13; } break; }
      case 0x11: this.de = this.fetch16(); break;
      case 0x12: this.wr(this.de, this.a); break;
      case 0x13: this.de = (this.de + 1) & 0xFFFF; break;
      case 0x14: this.d = this.inc8(this.d); break;
      case 0x15: this.d = this.dec8(this.d); break;
      case 0x16: this.d = this.fetch(); break;
      case 0x17: { const c = this.a >> 7; this.a = ((this.a << 1) | (this.f & FC)) & 0xFF; this.f = (this.f & (FS | FZ | FP)) | (this.a & (FY | FX)) | c; break; }
      case 0x18: { const d = this.fetch(); this.pc = (this.pc + ((d << 24) >> 24)) & 0xFFFF; break; }
      case 0x19: this.hl = this.add16(this.hl, this.de); break;
      case 0x1A: this.a = this.rd(this.de); break;
      case 0x1B: this.de = (this.de - 1) & 0xFFFF; break;
      case 0x1C: this.e = this.inc8(this.e); break;
      case 0x1D: this.e = this.dec8(this.e); break;
      case 0x1E: this.e = this.fetch(); break;
      case 0x1F: { const c = this.a & 1; this.a = ((this.a >> 1) | ((this.f & FC) << 7)) & 0xFF; this.f = (this.f & (FS | FZ | FP)) | (this.a & (FY | FX)) | c; break; }
      case 0x20: case 0x28: case 0x30: case 0x38: {
        const d = this.fetch();
        if (this.cond((op >> 3) & 3)) { this.pc = (this.pc + ((d << 24) >> 24)) & 0xFFFF; cyc = 12; }
        break;
      }
      case 0x21: this.hl = this.fetch16(); break;
      case 0x22: this.wr16(this.fetch16(), this.hl); break;
      case 0x23: this.hl = (this.hl + 1) & 0xFFFF; break;
      case 0x24: this.h = this.inc8(this.h); break;
      case 0x25: this.h = this.dec8(this.h); break;
      case 0x26: this.h = this.fetch(); break;
      case 0x27: this.daa(); break;
      case 0x29: this.hl = this.add16(this.hl, this.hl); break;
      case 0x2A: this.hl = this.rd16(this.fetch16()); break;
      case 0x2B: this.hl = (this.hl - 1) & 0xFFFF; break;
      case 0x2C: this.l = this.inc8(this.l); break;
      case 0x2D: this.l = this.dec8(this.l); break;
      case 0x2E: this.l = this.fetch(); break;
      case 0x2F: this.a ^= 0xFF; this.f = (this.f & (FS | FZ | FP | FC)) | FH | FN | (this.a & (FY | FX)); break;
      case 0x31: this.sp = this.fetch16(); break;
      case 0x32: this.wr(this.fetch16(), this.a); break;
      case 0x33: this.sp = (this.sp + 1) & 0xFFFF; break;
      case 0x34: { const a = this.hl; this.wr(a, this.inc8(this.rd(a))); break; }
      case 0x35: { const a = this.hl; this.wr(a, this.dec8(this.rd(a))); break; }
      case 0x36: this.wr(this.hl, this.fetch()); break;
      case 0x37: this.f = (this.f & (FS | FZ | FP)) | (this.a & (FY | FX)) | FC; break;
      case 0x39: this.hl = this.add16(this.hl, this.sp); break;
      case 0x3A: this.a = this.rd(this.fetch16()); break;
      case 0x3B: this.sp = (this.sp - 1) & 0xFFFF; break;
      case 0x3C: this.a = this.inc8(this.a); break;
      case 0x3D: this.a = this.dec8(this.a); break;
      case 0x3E: this.a = this.fetch(); break;
      case 0x3F: this.f = ((this.f & (FS | FZ | FP | FC)) | ((this.f & FC) << 4) | (this.a & (FY | FX))) ^ FC; break;
      case 0x76: this.halted = true; break;
      case 0xC0: case 0xC8: case 0xD0: case 0xD8: case 0xE0: case 0xE8: case 0xF0: case 0xF8:
        if (this.cond((op >> 3) & 7)) { this.pc = this.pop(); cyc = 11; }
        break;
      case 0xC1: this.bc = this.pop(); break;
      case 0xD1: this.de = this.pop(); break;
      case 0xE1: this.hl = this.pop(); break;
      case 0xF1: this.af = this.pop(); break;
      case 0xC2: case 0xCA: case 0xD2: case 0xDA: case 0xE2: case 0xEA: case 0xF2: case 0xFA: {
        const a = this.fetch16(); if (this.cond((op >> 3) & 7)) this.pc = a; break;
      }
      case 0xC3: this.pc = this.fetch16(); break;
      case 0xC4: case 0xCC: case 0xD4: case 0xDC: case 0xE4: case 0xEC: case 0xF4: case 0xFC: {
        const a = this.fetch16(); if (this.cond((op >> 3) & 7)) { this.push(this.pc); this.pc = a; cyc = 17; } break;
      }
      case 0xC5: this.push(this.bc); break;
      case 0xD5: this.push(this.de); break;
      case 0xE5: this.push(this.hl); break;
      case 0xF5: this.push(this.af); break;
      case 0xC6: case 0xCE: case 0xD6: case 0xDE: case 0xE6: case 0xEE: case 0xF6: case 0xFE:
        this.alu((op >> 3) & 7, this.fetch()); break;
      case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF:
        this.push(this.pc); this.pc = op & 0x38; break;
      case 0xC9: this.pc = this.pop(); break;
      case 0xCB: return this.execCB();
      case 0xCD: { const a = this.fetch16(); this.push(this.pc); this.pc = a; break; }
      case 0xD3: this.fetch(); break; // OUT (n),A (sin uso)
      case 0xD9: {
        let t;
        t = this.b; this.b = this.b_; this.b_ = t; t = this.c; this.c = this.c_; this.c_ = t;
        t = this.d; this.d = this.d_; this.d_ = t; t = this.e; this.e = this.e_; this.e_ = t;
        t = this.h; this.h = this.h_; this.h_ = t; t = this.l; this.l = this.l_; this.l_ = t;
        break;
      }
      case 0xDB: this.fetch(); this.a = 0xFF; break; // IN A,(n)
      case 0xDD: return this.execXY('ix');
      case 0xE3: { const v = this.rd16(this.sp); this.wr16(this.sp, this.hl); this.hl = v; break; }
      case 0xE9: this.pc = this.hl; break;
      case 0xEB: { let t = this.d; this.d = this.h; this.h = t; t = this.e; this.e = this.l; this.l = t; break; }
      case 0xED: return this.execED();
      case 0xF3: this.iff1 = this.iff2 = 0; break;
      case 0xF9: this.sp = this.hl; break;
      case 0xFB: this.iff1 = this.iff2 = 1; this.eiDelay = true; break;
      case 0xFD: return this.execXY('iy');
      default:
        if (op >= 0x40 && op < 0x80) { this.setR((op >> 3) & 7, this.getR(op & 7)); break; }
        if (op >= 0x80 && op < 0xC0) { this.alu((op >> 3) & 7, this.getR(op & 7)); break; }
    }
    return cyc;
  }

  daa() {
    let a = this.a, corr = 0, c = this.f & FC;
    if ((this.f & FH) || (a & 0x0F) > 9) corr |= 0x06;
    if (c || a > 0x99) { corr |= 0x60; c = FC; }
    let r;
    if (this.f & FN) r = (a - corr) & 0xFF; else r = (a + corr) & 0xFF;
    const h = (this.f & FN) ? ((this.f & FH) && (a & 0x0F) < 6 ? FH : 0) : ((a & 0x0F) > 9 ? FH : 0);
    this.a = r;
    this.f = Z80_SZP[r] | c | h | (this.f & FN);
  }

  execCB() {
    this.incR();
    const op = this.fetch();
    const r = op & 7, y = (op >> 3) & 7;
    let v = this.getR(r);
    switch (op >> 6) {
      case 0: this.setR(r, this.rot(y, v)); return r === 6 ? 15 : 8;
      case 1: {
        const t = v & (1 << y);
        this.f = (this.f & FC) | FH | (t ? 0 : FZ | FP) | (t & FS) | (v & (FY | FX));
        return r === 6 ? 12 : 8;
      }
      case 2: this.setR(r, v & ~(1 << y)); return r === 6 ? 15 : 8;
      case 3: this.setR(r, v | (1 << y)); return r === 6 ? 15 : 8;
    }
  }

  execED() {
    this.incR();
    const op = this.fetch();
    switch (op) {
      case 0x40: case 0x48: case 0x50: case 0x58: case 0x60: case 0x68: case 0x70: case 0x78: {
        const v = 0xFF; if (op !== 0x70) this.setR((op >> 3) & 7, v);
        this.f = (this.f & FC) | Z80_SZP[v]; return 12;
      }
      case 0x41: case 0x49: case 0x51: case 0x59: case 0x61: case 0x69: case 0x71: case 0x79: return 12;
      case 0x42: this.sbc16(this.bc); return 15;
      case 0x52: this.sbc16(this.de); return 15;
      case 0x62: this.sbc16(this.hl); return 15;
      case 0x72: this.sbc16(this.sp); return 15;
      case 0x4A: this.adc16(this.bc); return 15;
      case 0x5A: this.adc16(this.de); return 15;
      case 0x6A: this.adc16(this.hl); return 15;
      case 0x7A: this.adc16(this.sp); return 15;
      case 0x43: this.wr16(this.fetch16(), this.bc); return 20;
      case 0x53: this.wr16(this.fetch16(), this.de); return 20;
      case 0x63: this.wr16(this.fetch16(), this.hl); return 20;
      case 0x73: this.wr16(this.fetch16(), this.sp); return 20;
      case 0x4B: this.bc = this.rd16(this.fetch16()); return 20;
      case 0x5B: this.de = this.rd16(this.fetch16()); return 20;
      case 0x6B: this.hl = this.rd16(this.fetch16()); return 20;
      case 0x7B: this.sp = this.rd16(this.fetch16()); return 20;
      case 0x44: case 0x4C: case 0x54: case 0x5C: case 0x64: case 0x6C: case 0x74: case 0x7C: {
        const v = this.a; this.a = 0; this.sub8(v, 0); return 8;
      }
      case 0x45: case 0x55: case 0x5D: case 0x65: case 0x6D: case 0x75: case 0x7D:
        this.pc = this.pop(); this.iff1 = this.iff2; return 14;
      case 0x4D: this.pc = this.pop(); this.iff1 = this.iff2; return 14;
      case 0x46: case 0x4E: case 0x66: case 0x6E: this.im = 0; return 8;
      case 0x56: case 0x76: this.im = 1; return 8;
      case 0x5E: case 0x7E: this.im = 2; return 8;
      case 0x47: this.i = this.a; return 9;
      case 0x4F: this.r = this.a; return 9;
      case 0x57: this.a = this.i; this.f = (this.f & FC) | Z80_SZ[this.a] | (this.iff2 ? FP : 0); return 9;
      case 0x5F: this.a = this.r; this.f = (this.f & FC) | Z80_SZ[this.a] | (this.iff2 ? FP : 0); return 9;
      case 0x67: { // RRD
        const m = this.rd(this.hl);
        this.wr(this.hl, ((this.a << 4) | (m >> 4)) & 0xFF);
        this.a = (this.a & 0xF0) | (m & 0x0F);
        this.f = (this.f & FC) | Z80_SZP[this.a]; return 18;
      }
      case 0x6F: { // RLD
        const m = this.rd(this.hl);
        this.wr(this.hl, ((m << 4) | (this.a & 0x0F)) & 0xFF);
        this.a = (this.a & 0xF0) | (m >> 4);
        this.f = (this.f & FC) | Z80_SZP[this.a]; return 18;
      }
      case 0xA0: case 0xA8: case 0xB0: case 0xB8: { // LDI/LDD/LDIR/LDDR
        const v = this.rd(this.hl);
        this.wr(this.de, v);
        const d = (op & 8) ? -1 : 1;
        this.hl = (this.hl + d) & 0xFFFF; this.de = (this.de + d) & 0xFFFF;
        this.bc = (this.bc - 1) & 0xFFFF;
        const n = (v + this.a) & 0xFF;
        this.f = (this.f & (FS | FZ | FC)) | (this.bc ? FP : 0) | (n & FX) | ((n << 4) & FY);
        if (op >= 0xB0 && this.bc) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
      case 0xA1: case 0xA9: case 0xB1: case 0xB9: { // CPI/CPD/CPIR/CPDR
        const v = this.rd(this.hl), r = (this.a - v) & 0xFF;
        const d = (op & 8) ? -1 : 1;
        this.hl = (this.hl + d) & 0xFFFF;
        this.bc = (this.bc - 1) & 0xFFFF;
        const h = (this.a ^ v ^ r) & FH;
        const n = (r - (h ? 1 : 0)) & 0xFF;
        this.f = (this.f & FC) | FN | (Z80_SZ[r] & (FS | FZ)) | h | (this.bc ? FP : 0) | (n & FX) | ((n << 4) & FY);
        if (op >= 0xB0 && this.bc && r) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
      case 0xA2: case 0xAA: case 0xB2: case 0xBA: // INI/IND/INIR/INDR
      case 0xA3: case 0xAB: case 0xB3: case 0xBB: { // OUTI/OUTD/OTIR/OTDR
        const d = (op & 8) ? -1 : 1;
        if ((op & 3) === 2) this.wr(this.hl, 0xFF); else this.rd(this.hl);
        this.hl = (this.hl + d) & 0xFFFF;
        this.b = (this.b - 1) & 0xFF;
        this.f = Z80_SZ[this.b] | FN;
        if (op >= 0xB0 && this.b) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
      default: return 8; // NOP no documentado
    }
  }

  // Prefijos DD/FD: IX/IY, incluidas las mitades IXH/IXL (no documentadas)
  execXY(reg) {
    this.incR();
    const op = this.fetch();
    let xy = this[reg];
    const hi = () => (this[reg] >> 8) & 0xFF, lo = () => this[reg] & 0xFF;
    const setHi = (v) => { this[reg] = ((v & 0xFF) << 8) | (this[reg] & 0xFF); };
    const setLo = (v) => { this[reg] = (this[reg] & 0xFF00) | (v & 0xFF); };
    const disp = () => { const d = this.fetch(); return (this[reg] + ((d << 24) >> 24)) & 0xFFFF; };
    // lectura/escritura de registro con H/L sustituidos por la mitad de IX/IY
    const getX = (i) => i === 4 ? hi() : i === 5 ? lo() : this.getR(i);
    const setX = (i, v) => { if (i === 4) setHi(v); else if (i === 5) setLo(v); else this.setR(i, v); };
    switch (op) {
      case 0x09: this[reg] = this.add16(xy, this.bc); return 15;
      case 0x19: this[reg] = this.add16(xy, this.de); return 15;
      case 0x29: this[reg] = this.add16(xy, xy); return 15;
      case 0x39: this[reg] = this.add16(xy, this.sp); return 15;
      case 0x21: this[reg] = this.fetch16(); return 14;
      case 0x22: this.wr16(this.fetch16(), xy); return 20;
      case 0x2A: this[reg] = this.rd16(this.fetch16()); return 20;
      case 0x23: this[reg] = (xy + 1) & 0xFFFF; return 10;
      case 0x2B: this[reg] = (xy - 1) & 0xFFFF; return 10;
      case 0x24: setHi(this.inc8(hi())); return 8;
      case 0x25: setHi(this.dec8(hi())); return 8;
      case 0x26: setHi(this.fetch()); return 11;
      case 0x2C: setLo(this.inc8(lo())); return 8;
      case 0x2D: setLo(this.dec8(lo())); return 8;
      case 0x2E: setLo(this.fetch()); return 11;
      case 0x34: { const a = disp(); this.wr(a, this.inc8(this.rd(a))); return 23; }
      case 0x35: { const a = disp(); this.wr(a, this.dec8(this.rd(a))); return 23; }
      case 0x36: { const a = disp(); this.wr(a, this.fetch()); return 19; }
      case 0xE1: this[reg] = this.pop(); return 14;
      case 0xE3: { const v = this.rd16(this.sp); this.wr16(this.sp, xy); this[reg] = v; return 23; }
      case 0xE5: this.push(xy); return 15;
      case 0xE9: this.pc = xy; return 8;
      case 0xF9: this.sp = xy; return 10;
      case 0xCB: {
        const a = disp();
        const op2 = this.fetch();
        const r = op2 & 7, y = (op2 >> 3) & 7;
        const v = this.rd(a);
        let res;
        switch (op2 >> 6) {
          case 0: res = this.rot(y, v); break;
          case 1: {
            const t = v & (1 << y);
            this.f = (this.f & FC) | FH | (t ? 0 : FZ | FP) | (t & FS) | ((a >> 8) & (FY | FX));
            return 20;
          }
          case 2: res = v & ~(1 << y); break;
          case 3: res = v | (1 << y); break;
        }
        this.wr(a, res);
        if (r !== 6) this.setR(r, res);
        return 23;
      }
      case 0xDD: case 0xFD: case 0xED: this.pc = (this.pc - 1) & 0xFFFF; return 4;
    }
    if (op >= 0x40 && op < 0x80 && op !== 0x76) {
      const dst = (op >> 3) & 7, src = op & 7;
      if (src === 6) { const a = disp(); this.setR(dst, this.rd(a)); return 19; }
      if (dst === 6) { const a = disp(); this.wr(a, this.getR(src)); return 19; }
      setX(dst, getX(src));
      return 8;
    }
    if (op >= 0x80 && op < 0xC0) {
      const src = op & 7;
      if (src === 6) { const a = disp(); this.alu((op >> 3) & 7, this.rd(a)); return 19; }
      this.alu((op >> 3) & 7, getX(src));
      return 8;
    }
    // resto: se comporta como la instrucción sin prefijo (+4 ciclos)
    return this.exec(op) + 4;
  }
}
