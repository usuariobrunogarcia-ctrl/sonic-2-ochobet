'use strict';
// PSG SN76489 (variante del VDP de Sega): 3 canales de tono + ruido.

class PSG {
  constructor() {
    this.reg = new Uint16Array(8); // tono0, vol0, tono1, vol1, tono2, vol2, ruido, vol3
    for (let i = 1; i < 8; i += 2) this.reg[i] = 0xF;
    this.latch = 0;
    this.counter = new Int32Array(4);
    this.out = new Int8Array([1, 1, 1, 1]);
    this.lfsr = 0x8000;
    this.noiseToggle = 0;
    this.vol = new Float32Array(16);
    for (let i = 0; i < 15; i++) this.vol[i] = Math.pow(10, -i * 2 / 20);
    this.vol[15] = 0;
  }

  write(v) {
    v &= 0xFF;
    let r;
    if (v & 0x80) {
      r = this.latch = (v >> 4) & 7;
      if (!(r & 1) && r < 6) this.reg[r] = (this.reg[r] & 0x3F0) | (v & 0x0F);
      else this.reg[r] = v & 0x0F;
    } else {
      r = this.latch;
      if (!(r & 1) && r < 6) this.reg[r] = (this.reg[r] & 0x0F) | ((v & 0x3F) << 4);
      else this.reg[r] = v & 0x0F;
    }
    if (r === 6) this.lfsr = 0x8000;
  }

  // Avanza 'ticks' pasos de reloj/16 y devuelve la salida media
  run(ticks) {
    let acc = 0;
    for (let t = 0; t < ticks; t++) {
      for (let c = 0; c < 3; c++) {
        if (--this.counter[c] <= 0) {
          this.counter[c] = this.reg[c * 2] || 1;
          this.out[c] = -this.out[c];
        }
      }
      if (--this.counter[3] <= 0) {
        const nr = this.reg[6] & 3;
        this.counter[3] = nr === 3 ? (this.reg[4] || 1) : (0x10 << nr);
        this.noiseToggle ^= 1;
        if (this.noiseToggle) {
          const fb = (this.reg[6] & 4) ? ((this.lfsr ^ (this.lfsr >> 3)) & 1) : (this.lfsr & 1);
          this.lfsr = (this.lfsr >> 1) | (fb << 15);
        }
      }
      let s = 0;
      for (let c = 0; c < 3; c++) {
        // periodos muy cortos (supersónicos) se tratan como nivel constante
        s += (this.reg[c * 2] < 2 ? 1 : this.out[c]) * this.vol[this.reg[c * 2 + 1]];
      }
      s += ((this.lfsr & 1) ? 1 : -1) * this.vol[this.reg[7]];
      acc += s;
    }
    return ticks ? acc / ticks : 0;
  }
}
