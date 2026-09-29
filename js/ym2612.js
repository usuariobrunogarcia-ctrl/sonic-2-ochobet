'use strict';
// Chip FM Yamaha YM2612 (OPN2): 6 canales x 4 operadores, LFO, DAC en el canal 6.
// Implementación por muestra a la frecuencia nativa (reloj / 144).

const YM = (() => {
  const FREQ_SH = 16, EG_SH = 16, LFO_SH = 24;
  const FREQ_MASK = (1 << FREQ_SH) - 1;
  const ENV_BITS = 10, ENV_LEN = 1 << ENV_BITS, ENV_STEP = 128 / ENV_LEN;
  const MAX_ATT = ENV_LEN - 1, MIN_ATT = 0;
  const SIN_BITS = 10, SIN_LEN = 1 << SIN_BITS, SIN_MASK = SIN_LEN - 1;
  const TL_RES_LEN = 256, TL_TAB_LEN = 13 * 2 * TL_RES_LEN;
  const ENV_QUIET = TL_TAB_LEN >> 3;
  const RATE_STEPS = 8;
  const EG_OFF = 0, EG_REL = 1, EG_SUS = 2, EG_DEC = 3, EG_ATT = 4;

  const tl_tab = new Int32Array(TL_TAB_LEN);
  for (let x = 0; x < TL_RES_LEN; x++) {
    let m = Math.floor((1 << 16) / Math.pow(2, (x + 1) * (ENV_STEP / 4) / 8));
    let n = m >> 4;
    n = (n & 1) ? (n >> 1) + 1 : n >> 1;
    n <<= 2;
    tl_tab[x * 2] = n; tl_tab[x * 2 + 1] = -n;
    for (let i = 1; i < 13; i++) {
      tl_tab[x * 2 + i * 2 * TL_RES_LEN] = n >> i;
      tl_tab[x * 2 + 1 + i * 2 * TL_RES_LEN] = -(n >> i);
    }
  }
  const sin_tab = new Uint32Array(SIN_LEN);
  for (let i = 0; i < SIN_LEN; i++) {
    const m = Math.sin(((i * 2) + 1) * Math.PI / SIN_LEN);
    let o = m > 0 ? 8 * Math.log(1 / m) / Math.log(2) : 8 * Math.log(-1 / m) / Math.log(2);
    o = o / (ENV_STEP / 4);
    let n = Math.floor(2 * o);
    n = (n & 1) ? (n >> 1) + 1 : n >> 1;
    sin_tab[i] = n * 2 + (m >= 0 ? 0 : 1);
  }

  const eg_inc = [
    0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 2, 2, 1, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 4, 4, 2, 4, 4, 4,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 8, 4, 8, 4, 8, 4, 8, 4, 8, 4, 8, 8, 8, 4, 8, 8, 8,
    8, 8, 8, 8, 8, 8, 8, 8, 16, 16, 16, 16, 16, 16, 16, 16, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const O = (a) => a * RATE_STEPS;
  const eg_rate_select = [], eg_rate_shift = [];
  for (let i = 0; i < 32; i++) { eg_rate_select.push(O(18)); eg_rate_shift.push(0); }
  for (let r = 0; r < 12; r++) for (let j = 0; j < 4; j++) { eg_rate_select.push(O(j)); eg_rate_shift.push(11 - r); }
  for (let j = 0; j < 4; j++) { eg_rate_select.push(O(4 + j)); eg_rate_shift.push(0); }
  for (let j = 0; j < 4; j++) { eg_rate_select.push(O(8 + j)); eg_rate_shift.push(0); }
  for (let j = 0; j < 4; j++) { eg_rate_select.push(O(12 + j)); eg_rate_shift.push(0); }
  for (let j = 0; j < 4; j++) { eg_rate_select.push(O(16)); eg_rate_shift.push(0); }
  for (let i = 0; i < 32; i++) { eg_rate_select.push(O(16)); eg_rate_shift.push(0); }

  const dt_raw = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8,
    1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 16, 16, 16,
    2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 22, 22, 22, 22,
  ];
  const dt_tab = [];
  for (let d = 0; d < 4; d++) {
    const pos = new Int32Array(32), neg = new Int32Array(32);
    for (let i = 0; i < 32; i++) { const r = dt_raw[d * 32 + i] * SIN_LEN * (1 << FREQ_SH) / (1 << 20); pos[i] = r; neg[i] = -r; }
    dt_tab[d] = pos; dt_tab[d + 4] = neg;
  }
  const opn_fktable = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3];
  const fn_table = new Int32Array(4096);
  for (let i = 0; i < 4096; i++) fn_table[i] = i * 32 * (1 << (FREQ_SH - 10));
  const fn_max = 0x20000 * (1 << (FREQ_SH - 10));
  const sl_table = [];
  for (let i = 0; i < 15; i++) sl_table.push(i * 32);
  sl_table.push(31 * 32);
  const lfo_samples_per_step = [108, 77, 71, 67, 62, 44, 8, 5];
  const lfo_ams_depth_shift = [8, 3, 1, 0];
  const lfo_pm_output = [
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 1, 2, 2, 2, 3],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 1, 2, 2, 2, 3], [0, 0, 2, 3, 4, 4, 5, 6],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 1, 1, 1, 1],
    [0, 0, 0, 1, 1, 1, 1, 2], [0, 0, 1, 1, 2, 2, 2, 3], [0, 0, 2, 3, 4, 4, 5, 6], [0, 0, 4, 6, 8, 8, 10, 12],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1], [0, 0, 0, 1, 1, 1, 2, 2], [0, 0, 1, 1, 2, 2, 3, 3],
    [0, 0, 1, 2, 2, 2, 3, 4], [0, 0, 2, 3, 4, 4, 5, 6], [0, 0, 4, 6, 8, 8, 10, 12], [0, 0, 8, 12, 16, 16, 20, 24],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 2, 2, 2, 2], [0, 0, 0, 2, 2, 2, 4, 4], [0, 0, 2, 2, 4, 4, 6, 6],
    [0, 0, 2, 4, 4, 4, 6, 8], [0, 0, 4, 6, 8, 8, 10, 12], [0, 0, 8, 12, 16, 16, 20, 24], [0, 0, 16, 24, 32, 32, 40, 48],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 4, 4, 4, 4], [0, 0, 0, 4, 4, 4, 8, 8], [0, 0, 4, 4, 8, 8, 12, 12],
    [0, 0, 4, 8, 8, 8, 12, 16], [0, 0, 8, 12, 16, 16, 20, 24], [0, 0, 16, 24, 32, 32, 40, 48], [0, 0, 32, 48, 64, 64, 80, 96],
  ];
  const lfo_pm_table = new Int32Array(128 * 8 * 32);
  for (let depth = 0; depth < 8; depth++) {
    for (let fnum = 0; fnum < 128; fnum++) {
      for (let step = 0; step < 8; step++) {
        let value = 0;
        for (let bit = 0; bit < 7; bit++) if (fnum & (1 << bit)) value += lfo_pm_output[bit * 8 + depth][step];
        const base = fnum * 32 * 8 + depth * 32;
        lfo_pm_table[base + step] = value;
        lfo_pm_table[base + (step ^ 7) + 8] = value;
        lfo_pm_table[base + step + 16] = -value;
        lfo_pm_table[base + (step ^ 7) + 24] = -value;
      }
    }
  }

  class Slot {
    constructor() {
      this.DT = dt_tab[0]; this.KSR = 3; this.ar = 0; this.d1r = 0; this.d2r = 0; this.rr = 34;
      this.ksr = 0; this.mul = 1; this.phase = 0; this.Incr = -1;
      this.state = EG_OFF; this.tl = 0; this.volume = MAX_ATT; this.sl = 0; this.vol_out = MAX_ATT;
      this.eg_sh_ar = 0; this.eg_sel_ar = O(18); this.eg_sh_d1r = 0; this.eg_sel_d1r = O(18);
      this.eg_sh_d2r = 0; this.eg_sel_d2r = O(18); this.eg_sh_rr = 0; this.eg_sel_rr = O(18);
      this.key = 0; this.AMmask = 0;
    }
  }

  class Channel {
    constructor() {
      this.SLOT = [new Slot(), new Slot(), new Slot(), new Slot()];
      this.ALGO = 0; this.FB = 0;
      this.op1_out0 = 0; this.op1_out1 = 0;
      this.mem_value = 0;
      this.pms = 0; this.ams = 8;
      this.fc = 0; this.kcode = 0; this.block_fnum = 0;
      this.panL = true; this.panR = true;
      this.fn_h = 0;
    }
  }

  class Chip {
    constructor() {
      this.CH = [0, 1, 2, 3, 4, 5].map(() => new Channel());
      this.addr = [0, 0];
      this.eg_timer = 0; this.eg_cnt = 0;
      this.lfo_cnt = 0; this.lfo_timer = 0; this.lfo_timer_overflow = 0;
      this.LFO_AM = 0; this.LFO_PM = 0;
      this.dacEnable = false; this.dacOut = 0;
      this.mode = 0; // registro $27
      this.sl3 = { fc: [0, 0, 0], kcode: [0, 0, 0], block_fnum: [0, 0, 0], fn_h: 0 };
      this.outL = 0; this.outR = 0;
      // conexiones: indices 0=m2, 1=c1, 2=c2, 3=mem, 4=salida
      this.buf = new Int32Array(5);
    }

    write(port, v) {
      v &= 0xFF;
      switch (port & 3) {
        case 0: this.addr[0] = v; break;
        case 2: this.addr[1] = v; break;
        case 1: this.writeReg(this.addr[0], v, 0); break;
        case 3: this.writeReg(this.addr[1], v, 1); break;
      }
    }

    writeReg(r, v, part) {
      if (part === 0 && r < 0x30) { this.writeMode(r, v); return; }
      if (r < 0x30) return;
      let c = r & 3;
      if (c === 3) return;
      c += part * 3;
      const CH = this.CH[c];
      const slot = CH.SLOT[(r >> 2) & 3];
      switch (r & 0xF0) {
        case 0x30:
          slot.mul = (v & 0x0F) ? (v & 0x0F) * 2 : 1;
          slot.DT = dt_tab[(v >> 4) & 7];
          CH.SLOT[0].Incr = -1;
          break;
        case 0x40: slot.tl = (v & 0x7F) << (ENV_BITS - 7); slot.vol_out = slot.volume + slot.tl; break;
        case 0x50: {
          const oldKSR = slot.KSR;
          slot.KSR = 3 - (v >> 6);
          slot.ar = (v & 0x1F) ? 32 + ((v & 0x1F) << 1) : 0;
          if (slot.KSR !== oldKSR) CH.SLOT[0].Incr = -1;
          if (slot.ar + slot.ksr < 32 + 62) { slot.eg_sh_ar = eg_rate_shift[slot.ar + slot.ksr]; slot.eg_sel_ar = eg_rate_select[slot.ar + slot.ksr]; }
          else { slot.eg_sh_ar = 0; slot.eg_sel_ar = O(17); }
          break;
        }
        case 0x60:
          slot.AMmask = (v & 0x80) ? ~0 : 0;
          slot.d1r = (v & 0x1F) ? 32 + ((v & 0x1F) << 1) : 0;
          slot.eg_sh_d1r = eg_rate_shift[slot.d1r + slot.ksr]; slot.eg_sel_d1r = eg_rate_select[slot.d1r + slot.ksr];
          break;
        case 0x70:
          slot.d2r = (v & 0x1F) ? 32 + ((v & 0x1F) << 1) : 0;
          slot.eg_sh_d2r = eg_rate_shift[slot.d2r + slot.ksr]; slot.eg_sel_d2r = eg_rate_select[slot.d2r + slot.ksr];
          break;
        case 0x80:
          slot.sl = sl_table[v >> 4];
          slot.rr = 34 + ((v & 0x0F) << 2);
          slot.eg_sh_rr = eg_rate_shift[slot.rr + slot.ksr]; slot.eg_sel_rr = eg_rate_select[slot.rr + slot.ksr];
          break;
        case 0x90: break; // SSG-EG (no usado por el juego)
        case 0xA0:
          switch ((r >> 2) & 3) {
            case 0: {
              const fn = ((CH.fn_h & 7) << 8) + v, blk = CH.fn_h >> 3;
              CH.kcode = (blk << 2) | opn_fktable[fn >> 7];
              CH.fc = fn_table[fn * 2] >> (7 - blk);
              CH.block_fnum = (blk << 11) | fn;
              CH.SLOT[0].Incr = -1;
              break;
            }
            case 1: CH.fn_h = v & 0x3F; break;
            case 2:
              if (r < 0x100 && part === 0) {
                const i = r & 3; // canal 3, modo especial
                const fn = ((this.sl3.fn_h & 7) << 8) + v, blk = this.sl3.fn_h >> 3;
                this.sl3.kcode[i] = (blk << 2) | opn_fktable[fn >> 7];
                this.sl3.fc[i] = fn_table[fn * 2] >> (7 - blk);
                this.sl3.block_fnum[i] = (blk << 11) | fn;
                this.CH[2].SLOT[0].Incr = -1;
              }
              break;
            case 3: if (part === 0) this.sl3.fn_h = v & 0x3F; break;
          }
          break;
        case 0xB0:
          if (((r >> 2) & 3) === 0) {
            const fb = (v >> 3) & 7;
            CH.ALGO = v & 7;
            CH.FB = fb ? fb + 6 : 0;
          } else if (((r >> 2) & 3) === 1) {
            CH.panL = (v & 0x80) !== 0; CH.panR = (v & 0x40) !== 0;
            CH.ams = lfo_ams_depth_shift[(v >> 4) & 3];
            CH.pms = (v & 7) * 32;
          }
          break;
      }
    }

    writeMode(r, v) {
      switch (r) {
        case 0x22:
          if (v & 8) this.lfo_timer_overflow = lfo_samples_per_step[v & 7] * (1 << LFO_SH);
          else { this.lfo_timer_overflow = 0; this.lfo_timer = 0; this.lfo_cnt = 0; this.LFO_PM = 0; this.LFO_AM = 126; }
          break;
        case 0x27: this.mode = v; break;
        case 0x28: {
          let c = v & 3;
          if (c === 3) break;
          if (v & 4) c += 3;
          const CH = this.CH[c];
          this.key(CH.SLOT[0], (v & 0x10) !== 0);
          this.key(CH.SLOT[2], (v & 0x20) !== 0);
          this.key(CH.SLOT[1], (v & 0x40) !== 0);
          this.key(CH.SLOT[3], (v & 0x80) !== 0);
          break;
        }
        case 0x2A: this.dacOut = ((v & 0xFF) - 0x80) << 6; break;
        case 0x2B: this.dacEnable = (v & 0x80) !== 0; break;
      }
    }

    key(s, on) {
      if (on) {
        if (!s.key) {
          s.phase = 0;
          s.state = EG_ATT;
          if (s.ar + s.ksr >= 32 + 62) { s.volume = MIN_ATT; s.state = EG_DEC; }
          s.vol_out = s.volume + s.tl;
        }
        s.key = 1;
      } else if (s.key) {
        s.key = 0;
        if (s.state > EG_REL) s.state = EG_REL;
      }
    }

    refreshSlot(s, fc, kc) {
      const ksr = kc >> s.KSR;
      fc += s.DT[kc];
      if (fc < 0) fc += fn_max;
      s.Incr = (fc * s.mul) >> 1;
      if (s.ksr !== ksr) {
        s.ksr = ksr;
        if (s.ar + ksr < 32 + 62) { s.eg_sh_ar = eg_rate_shift[s.ar + ksr]; s.eg_sel_ar = eg_rate_select[s.ar + ksr]; }
        else { s.eg_sh_ar = 0; s.eg_sel_ar = O(17); }
        s.eg_sh_d1r = eg_rate_shift[s.d1r + ksr]; s.eg_sel_d1r = eg_rate_select[s.d1r + ksr];
        s.eg_sh_d2r = eg_rate_shift[s.d2r + ksr]; s.eg_sel_d2r = eg_rate_select[s.d2r + ksr];
        s.eg_sh_rr = eg_rate_shift[s.rr + ksr]; s.eg_sel_rr = eg_rate_select[s.rr + ksr];
      }
    }

    refreshChannel(CH, idx) {
      if (CH.SLOT[0].Incr !== -1) return;
      if (idx === 2 && (this.mode & 0xC0)) {
        const s3 = this.sl3;
        this.refreshSlot(CH.SLOT[0], s3.fc[1], s3.kcode[1]);
        this.refreshSlot(CH.SLOT[2], s3.fc[2], s3.kcode[2]);
        this.refreshSlot(CH.SLOT[1], s3.fc[0], s3.kcode[0]);
        this.refreshSlot(CH.SLOT[3], CH.fc, CH.kcode);
      } else {
        for (const s of CH.SLOT) this.refreshSlot(s, CH.fc, CH.kcode);
      }
    }

    advanceEG() {
      const cnt = this.eg_cnt;
      for (const CH of this.CH) {
        for (const s of CH.SLOT) {
          switch (s.state) {
            case EG_ATT:
              if (!(cnt & ((1 << s.eg_sh_ar) - 1))) {
                s.volume += ((~s.volume) * eg_inc[s.eg_sel_ar + ((cnt >> s.eg_sh_ar) & 7)]) >> 4;
                if (s.volume <= MIN_ATT) { s.volume = MIN_ATT; s.state = EG_DEC; }
              }
              break;
            case EG_DEC:
              if (!(cnt & ((1 << s.eg_sh_d1r) - 1))) {
                s.volume += eg_inc[s.eg_sel_d1r + ((cnt >> s.eg_sh_d1r) & 7)];
                if (s.volume >= s.sl) s.state = EG_SUS;
              }
              break;
            case EG_SUS:
              if (!(cnt & ((1 << s.eg_sh_d2r) - 1))) {
                s.volume += eg_inc[s.eg_sel_d2r + ((cnt >> s.eg_sh_d2r) & 7)];
                if (s.volume >= MAX_ATT) s.volume = MAX_ATT;
              }
              break;
            case EG_REL:
              if (!(cnt & ((1 << s.eg_sh_rr) - 1))) {
                s.volume += eg_inc[s.eg_sel_rr + ((cnt >> s.eg_sh_rr) & 7)];
                if (s.volume >= MAX_ATT) { s.volume = MAX_ATT; s.state = EG_OFF; }
              }
              break;
          }
          s.vol_out = s.volume + s.tl;
        }
      }
    }

    opCalc(phase, env, pm) {
      const p = (env << 3) + sin_tab[(((phase & ~FREQ_MASK) + (pm << 15)) >> FREQ_SH) & SIN_MASK];
      return p >= TL_TAB_LEN ? 0 : tl_tab[p];
    }
    opCalc1(phase, env, pm) {
      const p = (env << 3) + sin_tab[(((phase & ~FREQ_MASK) + pm) >> FREQ_SH) & SIN_MASK];
      return p >= TL_TAB_LEN ? 0 : tl_tab[p];
    }

    // Calcula un canal; devuelve su salida (14 bits con signo)
    chanCalc(CH, idx) {
      const AM = this.LFO_AM >> CH.ams;
      let m2 = 0, c1 = 0, c2 = 0, mem = 0, out = 0;
      // restaura la muestra retardada del algoritmo
      switch (CH.ALGO) {
        case 0: case 1: case 2: m2 = CH.mem_value; break;
        case 3: c2 = CH.mem_value; break;
        case 5: m2 = CH.mem_value; break;
      }
      const S1 = CH.SLOT[0], S3 = CH.SLOT[1], S2 = CH.SLOT[2], S4 = CH.SLOT[3];
      let eg = S1.vol_out + (AM & S1.AMmask);
      let fbin = CH.op1_out0 + CH.op1_out1;
      CH.op1_out0 = CH.op1_out1;
      const o1 = CH.op1_out0;
      // salida de M1 según el algoritmo
      switch (CH.ALGO) {
        case 0: c1 += o1; break;
        case 1: mem += o1; break;
        case 2: c2 += o1; break;
        case 3: c1 += o1; break;
        case 4: c1 += o1; break;
        case 5: mem = c1 = c2 = o1; break;
        case 6: c1 += o1; break;
        case 7: out += o1; break;
      }
      CH.op1_out1 = 0;
      if (eg < ENV_QUIET) {
        if (!CH.FB) fbin = 0;
        CH.op1_out1 = this.opCalc1(S1.phase, eg, fbin << CH.FB);
      }
      // M2 (SLOT3)
      eg = S3.vol_out + (AM & S3.AMmask);
      if (eg < ENV_QUIET) {
        const v = this.opCalc(S3.phase, eg, m2);
        switch (CH.ALGO) {
          case 0: case 1: case 2: case 3: case 4: c2 += v; break;
          case 5: case 6: case 7: out += v; break;
        }
      }
      // C1 (SLOT2)
      eg = S2.vol_out + (AM & S2.AMmask);
      if (eg < ENV_QUIET) {
        const v = this.opCalc(S2.phase, eg, c1);
        switch (CH.ALGO) {
          case 0: case 1: case 2: case 3: mem += v; break;
          default: out += v; break;
        }
      }
      // C2 (SLOT4)
      eg = S4.vol_out + (AM & S4.AMmask);
      if (eg < ENV_QUIET) out += this.opCalc(S4.phase, eg, c2);
      CH.mem_value = mem;
      // avance de fase (con modulación de LFO)
      if (CH.pms && !(idx === 2 && (this.mode & 0xC0))) {
        const bf = CH.block_fnum;
        const off = lfo_pm_table[((bf & 0x7F0) >> 4) * 32 * 8 + CH.pms + this.LFO_PM];
        if (off) {
          const b2 = bf * 2 + off;
          const blk = (b2 & 0x7000) >> 12, fn = b2 & 0xFFF;
          const kc = (blk << 2) | opn_fktable[fn >> 8];
          const fc = fn_table[fn] >> (7 - blk);
          for (const s of CH.SLOT) {
            let finc = fc + s.DT[kc];
            if (finc < 0) finc += fn_max;
            s.phase = (s.phase + ((finc * s.mul) >> 1)) >>> 0;
          }
        } else for (const s of CH.SLOT) s.phase = (s.phase + s.Incr) >>> 0;
      } else for (const s of CH.SLOT) s.phase = (s.phase + s.Incr) >>> 0;
      if (out > 8191) out = 8191; else if (out < -8192) out = -8192;
      return out;
    }

    // Genera una muestra estéreo a la frecuencia nativa
    clock() {
      // LFO
      if (this.lfo_timer_overflow) {
        this.lfo_timer += 1 << LFO_SH;
        while (this.lfo_timer >= this.lfo_timer_overflow) {
          this.lfo_timer -= this.lfo_timer_overflow;
          this.lfo_cnt = (this.lfo_cnt + 1) & 127;
          this.LFO_AM = this.lfo_cnt < 64 ? this.lfo_cnt * 2 : 126 - ((this.lfo_cnt & 63) * 2);
          this.LFO_PM = this.lfo_cnt >> 2;
        }
      }
      let L = 0, R = 0;
      for (let c = 0; c < 6; c++) {
        const CH = this.CH[c];
        this.refreshChannel(CH, c);
        let o = this.chanCalc(CH, c);
        if (c === 5 && this.dacEnable) o = this.dacOut;
        if (CH.panL) L += o;
        if (CH.panR) R += o;
      }
      // envolventes: cada 3 muestras
      if (++this.eg_timer >= 3) {
        this.eg_timer = 0;
        this.eg_cnt = (this.eg_cnt + 1) & 0xFFF;
        if (this.eg_cnt === 0) this.eg_cnt = 1;
        this.advanceEG();
      }
      this.outL = L; this.outR = R;
    }
  }

  return { Chip };
})();
