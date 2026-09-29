'use strict';
// Sistema de sonido del Mega Drive: Z80 + YM2612 + PSG ejecutando el driver de
// sonido original de Sonic 2 (descomprimido desde la ROM). La música y los
// efectos salen del propio driver y de los datos de la ROM.

const SND_ID = {
  // música
  EHZ: 0x82, Invincible: 0x97, ExtraLife: 0x98, EndLevel: 0x9A, GameOver: 0x9B, Drowning: 0x9F,
  // efectos
  Jump: 0xA0, Checkpoint: 0xA1, Hurt: 0xA3, Skidding: 0xA4, HurtBySpikes: 0xA6, Shield: 0xAF,
  Ring: 0xB5, SpikesMove: 0xB6, SpindashRelease: 0xBC, Roll: 0xBE, Explosion: 0xC1,
  TallyEnd: 0xC5, RingSpill: 0xC6, Spring: 0xCC, Blip: 0xCD, Signpost: 0xCF, SpindashRev: 0xE0,
  LavaBall: 0xAE, DoorSlam: 0xBB, Gloop: 0xDA, CNZLaunch: 0xE2,
  // órdenes
  FadeOut: 0xF9, SpeedUp: 0xFB, SlowDown: 0xFC, Stop: 0xFD, Pause: 0xFE, Unpause: 0xFF,
};

// Relojes NTSC
const MASTER_CLOCK = 53693175;
const MASTER_PER_FRAME = 262 * 3420;
const Z80_CYCLES_PER_FRAME = Math.round(MASTER_PER_FRAME / 15);
const YM_RATE = MASTER_CLOCK / 7 / 144;
const YM_SAMPLES_PER_FRAME = MASTER_PER_FRAME / 7 / 144;
const PSG_TICKS_PER_SAMPLE = (MASTER_CLOCK / 15 / 16) / YM_RATE;
const ZADDR = { QueueToPlay: 0x1B88, Queue0: 0x1B89, StopMusic: 0x1B83 };

// Descompresor Saxman (DecompressSoundDriver)
function saxmanDecompress(src, pos, size) {
  const out = [];
  let remaining = size;
  let desc = 0;
  const getByte = () => {
    const b = src[pos++];
    if (--remaining === 0) throw 'end';
    return b;
  };
  try {
    for (;;) {
      desc >>= 1;
      if (!(desc & 0x100)) desc = getByte() | 0xFF00;
      if (desc & 1) { out.push(getByte()); continue; }
      let d4 = getByte();
      let d0 = getByte();
      const len = (d0 & 0xF) + 3;
      d4 = (((d0 & 0xF0) << 4) + d4 + 0x12) & 0xFFF;
      d4 += out.length & 0xF000;
      let zero = false;
      if (!(out.length >= d4)) { d4 -= 0x1000; if (d4 < 0) zero = true; }
      for (let i = 0; i < len; i++) out.push(zero ? 0 : out[d4 + i]);
    }
  } catch (e) { if (e !== 'end') throw e; }
  return Uint8Array.from(out);
}

class SoundSystem {
  constructor(rom) {
    this.rom = rom.b;
    this.romMask = this.rom.length - 1;
    this.ram = new Uint8Array(0x2000);
    const size = rom.u16(rom.o.movewZ80CompSize + 2);
    const drv = saxmanDecompress(rom.b, rom.o.Snd_Driver, size);
    this.ram.set(drv.subarray(0, 0x2000));
    this.ram[7] = 0; // zPalModeByte: NTSC
    this.bank = 0;
    this.ym = new YM.Chip();
    this.psg = new PSG();
    this.writes = [];
    this.cyc = 0;
    this.z80 = new Z80((a) => this.read(a), (a, v) => this.write(a, v));
    this.queue = { music0: 0, music1: 0, sfx: [0, 0, 0] };
    this.sampleAcc = 0;
    this.psgAcc = 0;
    this.out = [];
    this.lastL = 0; this.lastR = 0;
  }

  read(a) {
    if (a < 0x4000) return this.ram[a & 0x1FFF];
    if (a < 0x6000) return 0; // estado del YM2612: nunca ocupado
    if (a >= 0x8000) {
      this.cyc += 3; // penalización de acceso al bus del 68000
      return this.rom[((this.bank << 15) | (a & 0x7FFF)) & this.romMask];
    }
    return 0xFF;
  }

  write(a, v) {
    if (a < 0x4000) { this.ram[a & 0x1FFF] = v; return; }
    if (a < 0x6000) { this.writes.push(this.cyc, 0, a & 3, v); return; }
    if (a < 0x6100) { this.bank = ((this.bank >> 1) | ((v & 1) << 8)) & 0x1FF; return; }
    if ((a & 0xFFF8) === 0x7F10) { this.writes.push(this.cyc, 1, 0, v); return; }
  }

  // Cola del 68000 (PlayMusic / PlaySound / PlaySound2)
  playMusic(id) { if (!this.queue.music0) this.queue.music0 = id; else this.queue.music1 = id; }
  playSound(id) { this.queue.sfx[0] = id; }
  playSound2(id) { this.queue.sfx[1] = id; }

  // sndDriverInput
  driverInput() {
    const ram = this.ram, q = this.queue;
    if (ram[ZADDR.QueueToPlay] === 0x80) {
      let d0 = 0;
      if (q.music0) { d0 = q.music0; q.music0 = 0; }
      else if (q.music1) { d0 = q.music1; q.music1 = 0; }
      if (d0) {
        if (d0 >= 0xFE) ram[ZADDR.StopMusic] = d0 - 0xFE + 0x7F;
        else ram[ZADDR.QueueToPlay] = d0;
      }
    }
    for (let i = 2; i >= 0; i--) {
      const id = q.sfx[i];
      if (!id) continue;
      if (ram[ZADDR.Queue0 + i]) continue;
      q.sfx[i] = 0;
      ram[ZADDR.Queue0 + i] = id;
    }
  }

  // Ejecuta un frame de vídeo del Z80 y sintetiza el audio correspondiente
  frame() {
    this.driverInput();
    const z = this.z80;
    this.writes.length = 0;
    this.cyc = 0;
    z.intLine = true;
    while (this.cyc < Z80_CYCLES_PER_FRAME) {
      this.cyc += z.step();
      if (this.cyc >= 171) z.intLine = false;
    }
    z.intLine = false;
    this.cyc -= Z80_CYCLES_PER_FRAME;
    // síntesis a la frecuencia nativa aplicando las escrituras en su instante
    this.sampleAcc += YM_SAMPLES_PER_FRAME;
    const n = Math.floor(this.sampleAcc);
    this.sampleAcc -= n;
    const w = this.writes;
    let wi = 0;
    const out = this.out;
    out.length = 0;
    for (let i = 0; i < n; i++) {
      const t = (i * Z80_CYCLES_PER_FRAME) / n;
      while (wi < w.length && w[wi] <= t) {
        if (w[wi + 1] === 0) this.ym.write(w[wi + 2], w[wi + 3]); else this.psg.write(w[wi + 3]);
        wi += 4;
      }
      this.ym.clock();
      this.psgAcc += PSG_TICKS_PER_SAMPLE;
      const ticks = Math.floor(this.psgAcc);
      this.psgAcc -= ticks;
      const p = this.psg.run(ticks) * 0.12;
      out.push(this.ym.outL / 32768 * 0.9 + p, this.ym.outR / 32768 * 0.9 + p);
    }
    while (wi < w.length) {
      if (w[wi + 1] === 0) this.ym.write(w[wi + 2], w[wi + 3]); else this.psg.write(w[wi + 3]);
      wi += 4;
    }
    return out;
  }
}

// Salida por Web Audio: remuestrea el audio de cada frame y lo encola
class AudioOut {
  constructor() {
    this.ctx = null;
    this.buf = new Float32Array(1 << 16);
    this.rd = 0; this.wr = 0;
    this.pos = 0;
    this.muted = false;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.rate = this.ctx.sampleRate;
    const node = this.ctx.createScriptProcessor(2048, 0, 2);
    node.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
      const mask = this.buf.length - 1;
      for (let i = 0; i < L.length; i++) {
        if (this.rd !== this.wr) {
          L[i] = this.buf[this.rd]; R[i] = this.buf[(this.rd + 1) & mask];
          this.rd = (this.rd + 2) & mask;
        } else { L[i] = 0; R[i] = 0; }
      }
    };
    node.connect(this.ctx.destination);
    this.node = node;
  }

  // Añade las muestras (entrelazadas L,R a la frecuencia del YM2612)
  push(samples) {
    if (!this.ctx) return;
    const mask = this.buf.length - 1;
    const n = samples.length >> 1;
    const fill = ((this.wr - this.rd) & mask) >> 1;
    if (fill > this.rate * 0.25) return; // demasiado retraso: se descarta el frame
    // control de ritmo: mantiene el búfer cerca de ~70 ms ajustando levemente el remuestreo
    const target = this.rate * 0.07;
    const adj = Math.max(-0.01, Math.min(0.01, (fill - target) / target * 0.01));
    const step = YM_RATE / this.rate * (1 + adj);
    while (this.pos < n - 1) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const l = samples[i * 2] * (1 - f) + samples[i * 2 + 2] * f;
      const r = samples[i * 2 + 1] * (1 - f) + samples[i * 2 + 3] * f;
      const g = this.muted ? 0 : 1;
      this.buf[this.wr] = Math.max(-1, Math.min(1, l * g));
      this.buf[(this.wr + 1) & mask] = Math.max(-1, Math.min(1, r * g));
      this.wr = (this.wr + 2) & mask;
      this.pos += step;
    }
    this.pos -= n - 1;
  }
}

// Interfaz usada por el juego (nombres de sonidos del código original)
class GameAudio {
  constructor(rom) {
    this.snd = new SoundSystem(rom);
    this.out = new AudioOut();
    this.levelMusic = SND_ID.EHZ;
  }
  start() { this.out.start(); }
  sfx(name) { const id = SND_ID[name]; if (id) this.snd.playSound(id); }
  sfx2(name) { const id = SND_ID[name]; if (id) this.snd.playSound2(id); }
  music(name) { const id = SND_ID[name]; if (id) this.snd.playMusic(id); }
  restoreLevelMusic() { this.snd.playMusic(this.levelMusic); }
  setTempo(fast) { this.snd.playMusic(fast ? SND_ID.SpeedUp : SND_ID.SlowDown); }
  pause(p) { this.snd.playMusic(p ? SND_ID.Pause : SND_ID.Unpause); }
  frame() {
    const s = this.snd.frame();
    this.out.push(s);
  }
}
