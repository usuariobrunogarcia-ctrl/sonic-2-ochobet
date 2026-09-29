'use strict';
// Bucle principal del nivel (Level_MainLoop), cámara (ScrollHoriz/ScrollVerti),
// fondo de EHZ (SwScrl_EHZ), arte animado (Dynamic_Normal) y paletas.

class NullAudio {
  sfx() {} music() {} restoreLevelMusic() {} setTempo() {}
}

class Dust { // Obj08 (polvo del spindash/derrape) - pendiente de portar
  startSkid() {} startSpindash() {} stopSpindash() {}
}

class Game {
  constructor(rom, canvas) {
    this.rom = rom;
    this.vdp = new VDP(canvas);
    this.audio = new NullAudio();
    this.dust = new Dust();
    this.level = new Level(rom);
    this.sine = new Int16Array(0x140);
    for (let i = 0; i < 0x140; i++) this.sine[i] = rom.s16(rom.o.Sine_Data + i * 2);
    this.angleData = rom.slice(rom.o.Angle_Data, 0x102);
    this.ripple = rom.slice(rom.o.SwScrl_RippleData, 66);
    this.padHeld = 0; this.padPress = 0; this.prevPad = 0;
    this.ctrlHeld = 0; this.ctrlPress = 0;
    this.posRecordBuf = new Uint16Array(128);
    this.statRecordBuf = new Uint16Array(128);
    this.lives = 3;
    this.frame = 0;
    this.displayLists = [[], [], [], [], [], [], [], []];
    this.startLevel();
  }

  startLevel() {
    const rom = this.rom, vdp = this.vdp, L = this.level;
    vdp.vram.fill(0);
    vdp.loadTiles(L.art, 0);
    // Paletas: Pal_BGND (líneas 0-1) y Pal_EHZ (líneas 1-3)
    const pal = (addr, n) => { const w = []; for (let i = 0; i < n; i++) w.push(rom.u16(addr + i * 2)); return w; };
    vdp.setPalette(0, pal(rom.o.Pal_BGND, 32));
    vdp.setPalette(1, pal(rom.o.Pal_EHZ, 48));
    this.normalPalette = vdp.palette.slice();
    this.applyAnimatedBlocks();
    this.animCounters = new Uint8Array(16);
    this.palCycleTimer = 0; this.palCycleFrame = 0;
    this.layerDef = 0;
    // LevelSizeLoad
    this.camMinX = L.minX; this.camMaxX = L.maxX; this.camMinY = L.minY; this.camMaxY = L.maxY;
    this.camYBias = 0x60; this.lookDelay = 0;
    this.horizScrollDelay = 0;
    this.scrollLock = false; this.controlLocked = false;
    this.levelInactive = false; this.timeOver = false; this.bossActive = false;
    this.chainBonus = 0;
    this.rings = 0; this.score = 0; this.timer = 0;
    this.sonicTopSpeed = 0x600; this.sonicAccel = 0xC; this.sonicDecel = 0x80;
    const s = this.sonic = new Sonic(this);
    s.x = L.startX; s.y = L.startY;
    let cx = L.startX - 0xA0; if (cx < 0) cx = 0; if (cx >= this.camMaxX) cx = this.camMaxX;
    let cy = L.startY - 0x60; if (cy < 0) cy = 0; if (cy >= this.camMaxY) cy = this.camMaxY;
    this.camX = cx; this.camY = cy << 16; // Camera_Y_pos es un long (16.16)
    this.objects = [s];
    this.runAnimatedArt();
  }

  // LoadAnimatedBlocks: parchea la tabla de bloques con APM_EHZ (datos de la ROM)
  applyAnimatedBlocks() {
    const rom = this.rom, a = rom.o.APM_EHZ;
    if (a === undefined) return;
    const off = rom.u16(a), n = rom.u16(a + 2) + 1;
    for (let i = 0; i < n; i++) this.level.blocks[(off >> 1) + i] = rom.u16(a + 4 + i * 2);
  }

  // Dynamic_Normal con el guion Animated_EHZ leído de la ROM
  runAnimatedArt() {
    const rom = this.rom, vdp = this.vdp;
    let a2 = rom.o.Animated_EHZ;
    const count = rom.s16(a2) + 1; a2 += 2;
    for (let s = 0; s < count; s++) {
      const c = this.animCounters;
      const dur = rom.s8(a2);
      c[s * 2] = u8(c[s * 2] - 1);
      if (c[s * 2] === 0xFF) {
        let f = c[s * 2 + 1];
        const nFrames = rom.u8(a2 + 6);
        if (f >= nFrames) { f = 0; c[s * 2 + 1] = 0; }
        c[s * 2 + 1]++;
        let tileId;
        if (dur >= 0) { c[s * 2] = dur; tileId = rom.u8(a2 + 8 + f); }
        else { c[s * 2] = rom.u8(a2 + 9 + f * 2); tileId = rom.u8(a2 + 8 + f * 2); }
        const src = (rom.u32(a2) & 0xFFFFFF) + tileId * 32;
        const nTiles = rom.u8(a2 + 7);
        vdp.loadTiles(rom.b.subarray(src, src + nTiles * 32), rom.u16(a2 + 4) >> 5);
      }
      let size = rom.u8(a2 + 6);
      if (dur < 0) size *= 2;
      a2 += 8 + ((size + 1) & 0xFE);
    }
  }

  // PalCycle_EHZ: agua (línea 2, colores 3-4 y $E-$F)
  palCycle() {
    if (--this.palCycleTimer >= 0) return;
    this.palCycleTimer = 7;
    const d0 = (this.palCycleFrame++ & 3) * 8;
    const a = this.rom.o.CyclingPal_EHZ_ARZ_Water + d0;
    const p = this.vdp.palette;
    p[0x13] = this.rom.u16(a); p[0x14] = this.rom.u16(a + 2);
    p[0x1E] = this.rom.u16(a + 4); p[0x1F] = this.rom.u16(a + 6);
  }

  calcSine(angle) {
    angle &= 0xFF;
    return [this.sine[angle], this.sine[angle + 0x40]];
  }

  calcAngle(x, y) {
    if (!x && !y) return 0x40;
    const ax = Math.abs(x) & 0xFFFF, ay = Math.abs(y) & 0xFFFF;
    let d0;
    if (ay < ax) d0 = this.angleData[Math.floor((ay << 8) / ax) & 0xFFFF];
    else d0 = u8(0x40 - this.angleData[Math.floor((ax << 8) / ay) & 0xFFFF]);
    if (x < 0) d0 = -d0 + 0x80;
    if (y < 0) d0 = -d0 + 0x100;
    return d0 & 0xFF;
  }

  resetCamBias() {
    if (this.camYBias === 0x60) return;
    if (this.camYBias < 0x60) this.camYBias += 4;
    this.camYBias -= 2;
  }

  displaySprite(o) {
    const l = this.displayLists[o.priority & 7];
    if (l.length < 0x3F) l.push(o);
  }

  touchResponse(o) {} // pendiente: interacción con objetos

  killCharacter(o) {
    if (o.routine >= 6) return;
    o.status_secondary = 0;
    o.routine = 6;
    o.status &= ~0x40; // (el ajuste completo se porta junto con TouchResponse)
    o.y_vel = -0x700; o.x_vel = 0; o.inertia = 0;
    o.status |= 2;
    o.anim = ANI.Death;
    o.art_tile |= 0x8000;
    this.audio.sfx('Hurt');
  }

  gameOver() { this.lives = 3; }
  showTimeOver() {}

  // ------------------------------------------------------------------ cámara
  scrollHoriz() {
    const s = this.sonic;
    let d0;
    if (this.horizScrollDelay) {
      this.horizScrollDelay = (this.horizScrollDelay - 0x100) & 0xFFFF;
      let d1 = u8(((this.horizScrollDelay >> 8) & 0xFF) << 2);
      d1 = u8(d1 + 4);
      const idx = u8(this.posRecordIndex - d1);
      d0 = this.posRecordBuf[idx >> 1] & 0x3FFF;
    } else d0 = s.x;
    d0 = s16(d0 - this.camX - (160 - 16));
    if (d0 < 0) {
      if (d0 <= -16) d0 = -16;
      d0 += this.camX;
      if (!(d0 > this.camMinX)) d0 = this.camMinX;
    } else {
      d0 -= 16;
      if (d0 < 0) return;
      if (d0 >= 16) d0 = 16;
      d0 += this.camX;
      if (!(d0 < this.camMaxX)) d0 = this.camMaxX;
    }
    this.camX = d0;
  }

  scrollVerti() {
    const s = this.sonic;
    const d3 = this.camYBias;
    const camYw = this.camY >> 16;
    let d0 = s16(s.y - camYw);
    if (s.status & ST_ROLL) d0 -= 5;
    let d1;
    let mode; // 'max' o 'free'
    if (s.status & ST_AIR) {
      const X = u16(d0 + 0x20);
      if (X < d3) d0 = s16(X - d3);
      else if (u16(X - d3) >= 0x40) d0 = s16(X - d3 - 0x40);
      else return;
      d1 = 16 << 8;
      if (d0 > 16) mode = 'down'; else if (d0 < -16) mode = 'up'; else mode = 'free';
    } else {
      d0 -= d3;
      if (d0 === 0) return;
      if (d3 !== 0x60) {
        d1 = 2 << 8;
        if (d0 > 2) mode = 'down'; else if (d0 < -2) mode = 'up'; else mode = 'free';
      } else if (Math.abs(s.inertia) >= 0x800) {
        d1 = 16 << 8;
        if (d0 > 16) mode = 'down'; else if (d0 < -16) mode = 'up'; else mode = 'free';
      } else {
        d1 = 6 << 8;
        if (d0 > 6) mode = 'down'; else if (d0 < -6) mode = 'up'; else mode = 'free';
      }
    }
    let newY; // long 16.16
    if (mode === 'free') {
      const w = s16(d0 + camYw);
      newY = (w << 16);
      if (d0 >= 0) { if (!(w < this.camMaxY)) newY = this.camMaxY << 16; }
      else { if (!(w > this.camMinY)) newY = this.camMinY << 16; }
    } else if (mode === 'up') {
      newY = this.camY - (d1 << 8);
      if (!((newY >> 16) > this.camMinY)) newY = this.camMinY << 16;
    } else {
      newY = this.camY + (d1 << 8);
      if (!((newY >> 16) < this.camMaxY)) newY = this.camMaxY << 16;
    }
    this.camY = newY | 0;
  }

  // SwScrl_EHZ: scroll horizontal por línea (primer plano y fondo)
  swScrlEHZ() {
    const vdp = this.vdp, A = vdp.hscrollA, B = vdp.hscrollB;
    const d2 = s16(-this.camX);
    A.fill(d2);
    vdp.vscrollA = this.camY >> 16;
    vdp.vscrollB = 0;
    let line = 0;
    const put = (v, n) => { for (let i = 0; i < n; i++) B[line++] = v; };
    put(0, 22);
    let d0 = d2 >> 6;
    put(d0, 58);
    const d3 = d0;
    if ((this.frame & 7) === 0) this.layerDef = (this.layerDef - 1) & 0xFFFF;
    const r = this.layerDef & 0x1F;
    for (let i = 0; i < 21; i++) B[line++] = s16(s8(this.ripple[r + i]) + d3);
    put(0, 11);
    put(d2 >> 4, 16);
    d0 = d2 >> 4; d0 = d0 + (d0 >> 1);
    put(d0, 16);
    // gradiente final (15 + 18 + 45 líneas)
    let step = Math.trunc((((d2 >> 1) - (d2 >> 3)) << 8) / 0x30);
    step = step << 8;
    let v = d2 >> 3;
    let frac = 0;
    const adv = (k) => { const t = (v * 65536 + frac) + step * k; v = Math.floor(t / 65536); frac = t - v * 65536; };
    for (let i = 0; i < 15; i++) { B[line++] = s16(v); adv(1); }
    for (let i = 0; i < 9; i++) { B[line++] = s16(v); B[line++] = s16(v); adv(2); }
    for (let i = 0; i < 15; i++) { B[line++] = s16(v); B[line++] = s16(v); if (line < 224) B[line++] = s16(v); adv(3); }
    while (line < 224) B[line++] = B[221];
  }

  // ------------------------------------------------------------------ bucle
  step() {
    const held = this.padHeld;
    this.padPress = held & ~this.prevPad;
    this.prevPad = held;
    this.frame++;
    for (const l of this.displayLists) l.length = 0;
    // RunObjects
    for (const o of this.objects) if (o) o.update();
    if (this.levelInactive) { this.startLevel(); return; }
    // DeformBgLayer
    if (!this.scrollLock) { this.scrollHoriz(); this.scrollVerti(); }
    this.swScrlEHZ();
    this.runAnimatedArt();
    this.palCycle();
    this.buildSprites();
  }

  // BuildSprites: recorre las listas de prioridad 0..7
  buildSprites() {
    const camX = this.camX, camY = this.camY >> 16;
    for (let p = 0; p < 8; p++) {
      for (const o of this.displayLists[p]) {
        let pieces;
        if (o === this.sonic) pieces = this.getMapping(this.rom.o.MapUnc_Sonic, o.mapping_frame);
        else if (o.mappings) pieces = this.getMapping(o.mappings, o.mapping_frame);
        else continue;
        const sx = o.render_flags & 4 ? o.x - camX : o.x - 128;
        const sy = o.render_flags & 4 ? o.y - camY : o.y - 128;
        this.vdp.addSprite(pieces, sx, sy, o.art_tile, o.render_flags & 3);
      }
    }
  }

  // Lee un frame de mappings en formato S2 desde la ROM (con caché)
  getMapping(base, frame) {
    this.mapCache = this.mapCache || new Map();
    const key = base * 256 + frame;
    let m = this.mapCache.get(key);
    if (m) return m;
    const rom = this.rom;
    let a = base + rom.s16(base + frame * 2);
    const n = rom.u16(a); a += 2;
    m = [];
    for (let i = 0; i < n; i++, a += 8) {
      m.push({ y: rom.s8(a), size: rom.u8(a + 1), tile: rom.u16(a + 2), x: rom.s16(a + 6) });
    }
    this.mapCache.set(key, m);
    return m;
  }

  render() {
    const L = this.level;
    this.vdp.planeA = (x, y) => L.tileAt(x, y, 0);
    this.vdp.planeB = (x, y) => L.tileAt(x, y, 1);
    this.vdp.render();
  }
}
