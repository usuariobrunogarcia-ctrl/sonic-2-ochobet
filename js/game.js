'use strict';
// Bucle principal del nivel (Level_MainLoop), cámara (ScrollHoriz/ScrollVerti),
// fondo de EHZ (SwScrl_EHZ), arte animado (Dynamic_Normal) y paletas.

class NullAudio {
  sfx() {} sfx2() {} music() {} restoreLevelMusic() {} setTempo() {} pause() {} frame() {} start() {}
}

class Game {
  constructor(rom, canvas, audio, opts = {}) {
    this.rom = rom;
    this.themeOn = !!opts.theme;
    this.vdp = new VDP(canvas);
    this.audio = audio || new NullAudio();
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

  // Level: carga del acto con cartel de título (Level_TtlCard) y arranque del bucle principal
  startLevel() {
    const rom = this.rom, vdp = this.vdp, L = this.level;
    if (this.lives <= 0) { this.lives = 3; this.score = 0; this.lastStarPole = 0; }
    if (this.nextActPending) { this.nextActPending = false; }
    vdp.vram.fill(0);
    vdp.loadTiles(L.art, 0);
    for (const plc of ['PlrList_Std1', 'PlrList_Std2', 'PlrList_Ehz1', 'PlrList_Ehz2']) this.loadPLC(plc);
    loadTitleCardArt(this);
    // Paletas: Pal_BGND (líneas 0-1) y Pal_EHZ (líneas 1-3)
    const pal = (addr, n) => { const w = []; for (let i = 0; i < n; i++) w.push(rom.u16(addr + i * 2)); return w; };
    vdp.setPalette(0, pal(rom.o.Pal_BGND, 32));
    vdp.setPalette(1, pal(rom.o.Pal_EHZ, 48));
    this.applyAnimatedBlocks();
    if (this.themeOn) { if (!this.theme) this.theme = new Theme(this); this.theme.apply(); }
    this.animCounters = new Uint8Array(16);
    this.palCycleTimer = 0; this.palCycleFrame = 0;
    this.layerDef = 0;
    this.levelFrame = 0;
    // LevelSizeLoad
    this.camMinX = L.minX; this.camMaxX = L.maxX; this.camMinY = L.minY; this.camMaxY = L.maxY;
    this.camYBias = 0x60; this.lookDelay = 0;
    this.horizScrollDelay = 0;
    this.scrollLock = false; this.controlLocked = true;
    this.levelInactive = false; this.timeOver = false; this.bossActive = false;
    this.chainBonus = 0;
    this.rings = 0; this.extraLifeFlags = 0;
    if (this.score === undefined) this.score = 0;
    this.ringSpillCounter = 0; this.ringSpillAccum = 0; this.ringSpillFrame = 0; this.rngSeed = this.rngSeed || 0;
    this.sonicTopSpeed = 0x600; this.sonicAccel = 0xC; this.sonicDecel = 0x80;
    this.bonus = [0, 0, 0, 0]; this.updateBonusScore = false;
    this.slots = new Array(0x80).fill(null);
    this.titleOverlay = this.titleOverlay || new TitleOverlay();
    this.levelStarted = false;
    this.timerParts = { min: 0, sec: 0, frame: 0 };
    this.updateHudTimer = false;
    const s = this.sonic = new Sonic(this);
    this.slots[0] = s; s.slot = 0;
    this.dust = this.spawn(Obj08, 10); this.dust.id = 8; this.dust.parent = s;
    let cx, cy;
    const cp = this.lastStarPole ? this.checkpoint : null;
    if (cp) {
      // Obj79_LoadData
      s.x = cp.x; s.y = cp.y;
      this.timerParts = { min: cp.timer.min, sec: cp.timer.sec - 1, frame: 59 };
      s.savedArt = cp.art_tile; s.savedTop = cp.top; s.savedLrb = cp.lrb;
      this.camMaxY = cp.camMaxY;
      cx = cp.camX; cy = cp.camY;
    } else {
      s.x = L.startX; s.y = L.startY;
      cx = s.x; cy = s.y;
    }
    cx -= 0xA0; if (cx < 0) cx = 0; if (cx >= this.camMaxX) cx = this.camMaxX;
    cy -= 0x60; if (cy < 0) cy = 0; if (cy >= this.camMaxY) cy = this.camMaxY;
    if (cp) { cx = cp.camX; cy = cp.camY; }
    this.camX = cx; this.camY = cy << 16; // Camera_Y_pos es un long (16.16)
    this.camXCoarse = 0;
    this.initOscillators();
    this.hud = new HUD(this);
    this.buildHUD = () => { if (this.levelStarted) this.hud.build(); };
    spawnTitleCard(this);
    this.phase = 'titlecard';
    this.loadWait = 0;
    this.audio.music('EHZ');
  }

  // Cambia entre el arte original y el tema "Ruinas" (arte nuevo) sin reiniciar
  setTheme(on) {
    if (on === !!this.themeOn) return;
    this.themeOn = on;
    if (on) { if (!this.theme) this.theme = new Theme(this); this.theme.apply(); }
    else if (this.theme) this.theme.remove();
    if (this.animCounters) { for (let i = 0; i < this.animCounters.length; i += 2) this.animCounters[i] = 0; this.runAnimatedArt(); }
  }

  // Segunda parte de la carga (tras llegar el nombre de la zona): objetos, anillos, HUD
  finishLevelLoad() {
    this.hud.base();
    this.ringMgr = new RingManager(this);
    this.initObjectsManager();
    this.runAnimatedArt();
    this.titleCardLeaving = true;
    this.tcZoneName.leaving = true;
    this.tcLeft.routine = 0xE;
    this.tcLeft.loc = 0xA;
    this.phase = 'titleleave';
  }

  // Load_EndOfAct: resultados y bonificaciones
  loadEndOfAct() {
    const rom = this.rom, s = this.sonic;
    s.status_secondary = 0;
    this.updateHudTimer = false;
    const r = this.allocObject(Obj3A);
    if (r) r.id = 0x3A;
    this.loadPLC('PlrList_Results');
    this.updateBonusScore = true;
    let d0 = Math.floor((this.timerParts.min * 60 + this.timerParts.sec) / 15);
    if (d0 >= 20) d0 = 20;
    this.bonus = [0, rom.u16(rom.o.TimeBonuses + d0 * 2), this.rings * 10, 0];
    if (this.ringMgr.perfectLeft() === 0) this.bonus[3] = 5000;
    this.audio.music('EndLevel');
  }

  // Carga una lista PLC de la ROM (palabra = n-1; entradas: dc.l arte Nemesis, dc.w VRAM)
  loadPLC(label) {
    const rom = this.rom;
    let a = rom.o[label];
    const n = rom.s16(a) + 1; a += 2;
    for (let i = 0; i < n; i++, a += 6) {
      const art = rom.u32(a), vram = rom.u16(a + 4);
      this.vdp.loadTiles(rom.nem(art), vram >> 5);
    }
  }

  // ------------------------------------------------------------------ osciladores
  initOscillators() {
    const init = [0x7D, 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0,
      0x3848, 0xEE, 0x2080, 0xB4, 0x3080, 0x10E, 0x5080, 0x1C2, 0x7080, 0x276, 0x80, 0, 0x4000, 0xFE];
    this.oscControl = init[0];
    this.osc = new Uint16Array(32);
    for (let i = 0; i < 32; i++) this.osc[i] = init[i + 1];
  }

  oscillateDo() {
    if (this.sonic.routine >= 6) return;
    const data = [2, 0x10, 2, 0x18, 2, 0x20, 2, 0x30, 4, 0x20, 8, 8, 8, 0x40, 4, 0x40, 2, 0x38, 2, 0x38, 2, 0x20, 3, 0x30, 5, 0x50, 7, 0x70, 2, 0x40, 2, 0x40];
    let d3 = this.oscControl;
    for (let i = 0, d1 = 15; i < 16; i++, d1--) {
      const d2 = data[i * 2], d4 = data[i * 2 + 1];
      if (!((d3 >> d1) & 1)) {
        this.osc[i * 2 + 1] = u16(this.osc[i * 2 + 1] + d2);
        this.osc[i * 2] = u16(this.osc[i * 2] + this.osc[i * 2 + 1]);
        if (!(d4 > (this.osc[i * 2] >> 8))) d3 |= 1 << d1;
      } else {
        this.osc[i * 2 + 1] = u16(this.osc[i * 2 + 1] - d2);
        this.osc[i * 2] = u16(this.osc[i * 2] + this.osc[i * 2 + 1]);
        if (!(d4 <= (this.osc[i * 2] >> 8))) d3 &= ~(1 << d1);
      }
    }
    this.oscControl = d3;
  }

  // Byte de Oscillating_Data (offset en bytes)
  oscByte(off) {
    const w = this.osc[off >> 1];
    return (off & 1) ? (w & 0xFF) : (w >> 8);
  }

  // ------------------------------------------------------------------ objetos
  allocSlot(from) {
    for (let i = from; i < 0x80; i++) if (!this.slots[i]) return i;
    return -1;
  }

  spawn(cls, slot) {
    if (slot < 0) return null;
    const o = new cls(this);
    o.slot = slot;
    this.slots[slot] = o;
    return o;
  }

  allocObject(cls) { return this.spawn(cls, this.allocSlot(0x10)); }
  allocObjectAfter(cur, cls) { return this.spawn(cls, this.allocSlot(Math.max(cur.slot + 1, 0x10))); }

  deleteObject(o) {
    if (o && this.slots[o.slot] === o) this.slots[o.slot] = null;
    if (o) o.deleted = true;
  }

  initObjectsManager() {
    const rom = this.rom;
    this.objLayout = [];
    let a = rom.o.Objects_EHZ_1;
    for (;;) {
      const x = rom.u16(a);
      if (x === 0xFFFF) break;
      this.objLayout.push({ x, yw: rom.u16(a + 2), id: rom.u8(a + 4), subtype: rom.u8(a + 5) });
      a += 6;
    }
    // índices de respawn (a partir de 2; los dos primeros bytes no se usan)
    let ri = 2;
    for (const e of this.objLayout) e.respawn = (e.yw & 0x8000) ? ri++ : 0;
    this.respawn = new Uint8Array(0x300);
    this.objRight = 0; this.objLeft = 0;
    let d6 = this.camX - 0x80; if (d6 < 0) d6 = 0; d6 &= 0xFF80;
    while (this.objRight < this.objLayout.length && this.objLayout[this.objRight].x < d6) this.objRight++;
    d6 -= 0x80;
    if (d6 >= 0) while (this.objLeft < this.objLayout.length && this.objLayout[this.objLeft].x < d6) this.objLeft++;
    this.camXLast = -1;
    this.objectsManager(true);
  }

  chkLoadObj(e) {
    if (e.respawn) {
      if (this.respawn[e.respawn] & 0x80) return true;
      this.respawn[e.respawn] |= 0x80;
    }
    const cls = OBJ_CLASSES[e.id];
    if (!cls) return true; // objeto aún no portado
    const o = this.allocObject(cls);
    if (!o) { if (e.respawn) this.respawn[e.respawn] &= 0x7F; return false; }
    o.id = e.id;
    o.x = e.x;
    o.y = e.yw & 0xFFF;
    o.respawn_index = e.respawn;
    o.render_flags = (e.yw >> 13) & 3;
    o.status = o.render_flags;
    o.subtype = e.subtype;
    return true;
  }

  objectsManager(first) {
    this.camXCoarse = u16((this.camX - 0x80) & 0xFF80);
    let d6 = this.camX & 0xFF80;
    if (!first && d6 === this.camXLast) return;
    const L = this.objLayout;
    if (first || d6 > this.camXLast) {
      this.camXLast = d6;
      const lim = d6 + 0x280;
      while (this.objRight < L.length && L[this.objRight].x < lim) {
        if (!this.chkLoadObj(L[this.objRight])) break;
        this.objRight++;
      }
      const left = d6 - 0x80;
      if (left >= 0) while (this.objLeft < L.length && L[this.objLeft].x < left) this.objLeft++;
    } else {
      this.camXLast = d6;
      const left = d6 - 0x80;
      if (left >= 0) {
        while (this.objLeft > 0 && L[this.objLeft - 1].x > left) {
          if (!this.chkLoadObj(L[this.objLeft - 1])) break;
          this.objLeft--;
        }
      }
      const lim = d6 + 0x280;
      while (this.objRight > 0 && L[this.objRight - 1].x >= lim) this.objRight--;
    }
  }

  collectRing() {
    if (this.rings < 999) this.rings++;
    this.audio.sfx2('Ring');
    if (this.rings >= 100 && !(this.extraLifeFlags & 2)) { this.extraLifeFlags |= 2; this.extraLife(); }
    else if (this.rings >= 200 && !(this.extraLifeFlags & 4)) { this.extraLifeFlags |= 4; this.extraLife(); }
  }

  // RandomNumber (mismo generador que el original)
  randomNumber() {
    let d1 = this.rngSeed >>> 0;
    if (!d1) d1 = 0x2A6D365A;
    const hi0 = d1 & 0xFFFF0000;
    const D = Math.imul(d1, 41) >>> 0;
    const lo = D & 0xFFFF, hi = D >>> 16;
    const sum = (lo + hi) & 0xFFFF;
    this.rngSeed = ((sum << 16) | lo) >>> 0;
    return (hi0 | sum) >>> 0;
  }

  // Sonic_Shield y Sonic_InvincibilityStars ocupan ranuras reservadas
  spawnShield() {
    const cur = this.slots[12];
    if (cur instanceof Obj38) return;
    const o = this.spawn(Obj38, 12); o.id = 0x38; o.parent = this.sonic;
  }
  spawnInvincibility() {
    const cur = this.slots[13];
    if (cur instanceof Obj35) return;
    const o = this.spawn(Obj35, 13); o.id = 0x35; o.parent = this.sonic;
  }

  extraLife() { this.lives++; this.audio.sfx2('ExtraLife'); }

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
        const dest = rom.u16(a2 + 4) >> 5;
        vdp.loadTiles(this.themeOn ? this.theme.animFrame(src, nTiles, dest) : rom.b.subarray(src, src + nTiles * 32), dest);
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

  // TouchResponse: anillos y objetos con collision_flags
  touchResponse(a0) {
    if (this.ringMgr) this.ringMgr.touch(a0);
    const d2 = s16(a0.x - 8);
    let d5 = s8(a0.y_radius) - 3;
    let d3 = s16(a0.y - d5);
    if (a0.mapping_frame === 0x4D) { d3 += 0xC; d5 = 0xA; }
    const d4 = 0x10;
    d5 *= 2;
    const rom = this.rom, sizes = rom.o.Touch_Sizes;
    for (let i = 0x10; i < 0x80; i++) {
      const a1 = this.slots[i];
      if (!a1 || !a1.collision_flags) continue;
      const f = a1.collision_flags & 0x3F;
      const w = rom.u8(sizes + f * 2), h = rom.u8(sizes + f * 2 + 1);
      let d0 = s16(a1.x - w - d2);
      if (d0 < 0) { if (d0 + w * 2 < 0) continue; } else if (d0 > d4) continue;
      d0 = s16(a1.y - h - d3);
      if (d0 < 0) { if (d0 + h * 2 < 0) continue; } else if (d0 > d5) continue;
      return this.touchChkValue(a0, a1);
    }
    return 0;
  }

  touchChkValue(a0, a1) {
    const cf = a1.collision_flags, kind = cf & 0xC0;
    if (kind === 0) return this.touchEnemy(a0, a1);
    if (kind === 0xC0) return this.touchSpecial(a0, a1);
    if (kind === 0x80) return this.touchChkHurt(a0, a1);
    if ((cf & 0x3F) === 6) { // monitor
      if (a0.y_vel < 0) {
        if (u16(a0.y - 0x10) < u16(a1.y)) return 0;
        a0.y_vel = s16(-a0.y_vel);
        a1.y_vel = -0x180;
        if (!a1.routine_secondary) a1.routine_secondary = 4;
        return 0;
      }
      if (a0.anim !== ANI.Roll) return 0;
      a0.y_vel = s16(-a0.y_vel);
      a1.routine = 4;
      a1.parent = a0;
      return 0;
    }
    if (a0.invulnerable_time < 90) { a1.routine = 4; a1.parent = a0; }
    return 0;
  }

  touchSpecial(a0, a1) {
    const d1 = a1.collision_flags & 0x3F;
    if (d1 === 7) { a1.collision_property = 2; return this.touchEnemy(a0, a1); }
    if (d1 === 0xB) { a1.status |= NO_BALANCING; return this.touchChkHurt(a0, a1); }
    if ([6, 0xA, 0x14, 0x15, 0x16, 0x17, 0x18].includes(d1)) { a1.collision_property = u8(a1.collision_property + 1); return 0; }
    if (d1 === 0x1A) { a1.collision_property = 0xFF; return this.touchEnemy(a0, a1); }
    if (d1 === 0x21) { a1.collision_property = u8(a1.collision_property + 1); return 0; }
    return 0;
  }

  touchEnemy(a0, a1) {
    if (!(a0.status_secondary & ST2_INVINC) && a0.anim !== ANI.Spindash && a0.anim !== ANI.Roll) return this.touchChkHurt(a0, a1);
    if (a1.collision_property) {
      a0.x_vel = s16(-a0.x_vel); a0.y_vel = s16(-a0.y_vel);
      a1.collision_flags = 0;
      if (--a1.collision_property === 0) a1.status |= NO_BALANCING;
      return 0;
    }
    // Touch_KillEnemy
    a1.status |= NO_BALANCING;
    let d0 = this.chainBonus;
    this.chainBonus += 2;
    if (d0 >= 6) d0 = 6;
    a1.pointsFrame = d0;
    let pts = [10, 20, 50, 100][d0 >> 1];
    if (this.chainBonus >= 0x20) { pts = 1000; a1.pointsFrame = 0xA; }
    this.addPoints(pts);
    this.becomeExplosion(a1);
    if (a0.y_vel < 0) { a0.y_vel = s16(a0.y_vel + 0x100); return 0; }
    if (u16(a0.y) >= u16(a1.y)) { a0.y_vel = s16(a0.y_vel - 0x100); return 0; }
    a0.y_vel = s16(-a0.y_vel);
    return 0;
  }

  touchChkHurt(a0, a1) {
    if (a0.status_secondary & ST2_INVINC) return -1;
    if (a0.invulnerable_time) return -1;
    return this.hurtCharacter(a0, a1);
  }

  hurtCharacter(a0, a2) {
    if (!(a0.status_secondary & ST2_SHIELD)) {
      if (this.rings === 0) return this.killCharacter(a0, a2);
      const lr = this.allocObject(typeof Obj37 !== 'undefined' ? Obj37 : Obj);
      if (lr) { lr.id = 0x37; lr.x = a0.x; lr.y = a0.y; lr.parent = a0; }
    }
    a0.status_secondary &= ~ST2_SHIELD;
    a0.routine = 4;
    a0.resetOnFloorPart2();
    a0.status |= ST_AIR;
    a0.y_vel = -0x400; a0.x_vel = -0x200;
    if (a0.status & ST_UNDERWATER) { a0.y_vel = -0x200; a0.x_vel = -0x100; }
    if (!(u16(a0.x) < u16(a2.x))) a0.x_vel = s16(-a0.x_vel);
    a0.inertia = 0;
    a0.anim = ANI.Hurt2;
    a0.invulnerable_time = 0x78;
    this.audio.sfx(a2.id === 0x36 ? 'HurtBySpikes' : 'Hurt');
    return -1;
  }

  killCharacter(o, cause) {
    o.status_secondary = 0;
    o.routine = 6;
    o.resetOnFloorPart2();
    o.status |= ST_AIR;
    o.y_vel = -0x700; o.x_vel = 0; o.inertia = 0;
    o.anim = ANI.Death;
    o.art_tile |= 0x8000;
    this.audio.sfx(cause && cause.id === 0x36 ? 'HurtBySpikes' : 'Hurt');
    return -1;
  }

  addPoints(n) {
    this.score += n;
    if (this.score > 999999) this.score = 999999;
  }

  becomeExplosion(a1) {
    // Obj27 (explosión) sustituye al enemigo en su misma ranura
    if (typeof Obj27 === 'undefined') { this.deleteObject(a1); return; }
    const e = new Obj27(this);
    e.slot = a1.slot; e.id = 0x27; e.x = a1.x; e.y = a1.y;
    e.respawn_index = a1.respawn_index; e.pointsFrame = a1.pointsFrame;
    this.slots[a1.slot] = e;
    a1.deleted = true;
  }

  // Game Over / Time Over (Obj39)
  gameOver() {
    this.updateHudTimer = false;
    this.audio.music('GameOver');
    spawnOverText(this, [0, 1]);
  }
  showTimeOver() {
    this.updateHudTimer = false;
    this.audio.music('GameOver');
    spawnOverText(this, [2, 3]);
    this.checkpoint && (this.checkpoint.timer = { min: 0, sec: 1, frame: 0 });
  }

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
    this.audio.frame();
    for (const l of this.displayLists) l.length = 0;
    if (this.phase === 'fadeout') {
      // Pal_FadeToBlack: 22 frames reduciendo rojo, luego verde y luego azul
      const p = this.vdp.palette;
      for (let i = 0; i < 64; i++) {
        const c = p[i];
        if (c & 0xE) p[i] = c - 2; else if (c & 0xE0) p[i] = c - 0x20; else if (c & 0xE00) p[i] = c - 0x200;
      }
      this.buildSprites();
      if (--this.fadeFrames < 0) {
        if (this.lives <= 0) { this.score = 0; this.lastStarPole = 0; }
        this.startLevel();
      }
      return;
    }
    if (this.phase === 'titlecard') {
      // Level_TtlCard: solo se ejecutan los objetos del cartel
      const zn = this.tcZoneName;
      if (zn.x === zn.xTarget && ++this.loadWait > 20) { this.finishLevelLoad(); }
      else { this.runObjects(1); this.buildSprites(); return; }
    }
    if (this.phase === 'titleleave') {
      this.ctrlHeld = 0; this.ctrlPress = 0;
      this.swScrlEHZ();
      this.runObjects();
      this.buildSprites();
      if (!this.slots[this.tcBackground.slot] || this.tcBackground.deleted) {
        for (const o of [this.tcZoneName, this.tcZone, this.tcAct]) {
          if (!o.deleted) { o.routine = 0x16; o.anim_frame_duration = 0x2D; }
        }
        this.controlLocked = false;
        this.levelStarted = true;
        this.updateHudTimer = true;
        this.phase = 'level';
        this.plcAfterTitle = false;
      }
      return;
    }
    // Level_MainLoop
    this.levelFrame++;
    this.hud.update(); // HudUpdate se ejecuta en la interrupción vertical
    if (!this.plcAfterTitle && this.tcZoneName.deleted) {
      // Obj34_LoadStandardWaterAndAnimalArt
      this.plcAfterTitle = true;
      this.loadPLC('PlrList_StdWtr');
      this.loadPLC('PlrList_EhzAnimals');
    }
    this.runObjects();
    if (this.gameOverReset) {
      this.gameOverReset = false;
      this.lives = 0; this.levelInactive = true;
    }
    if (this.levelInactive) { this.beginFadeOut(); return; }
    // DeformBgLayer
    if (!this.scrollLock) { this.scrollHoriz(); this.scrollVerti(); }
    this.swScrlEHZ();
    this.ringMgr.update();
    this.runAnimatedArt();
    this.palCycle();
    this.oscillateDo();
    this.ringMgr.changeFrame();
    if (this.ringSpillCounter) {
      this.ringSpillAccum = (this.ringSpillAccum + this.ringSpillCounter) & 0xFFFF;
      this.ringSpillFrame = (this.ringSpillAccum >> 9) & 3;
      this.ringSpillCounter--;
    }
    this.checkLoadSignpostArt();
    this.buildSprites();
    this.objectsManager(false);
  }

  beginFadeOut() {
    this.phase = 'fadeout';
    this.fadeFrames = 0x15;
    this.audio.music('FadeOut');
  }

  runObjects(from = 0) {
    // con el jugador muerto solo se dibujan los objetos dinámicos visibles
    const dead = this.sonic.routine >= 6;
    for (let i = from; i < 0x80; i++) {
      const o = this.slots[i];
      if (!o) continue;
      if (dead && i >= 0x10) { if (o.render_flags & RF_ONSCREEN) this.displaySprite(o); continue; }
      o.update();
    }
  }

  checkLoadSignpostArt() {
    const d1 = this.camMaxX - 0x100;
    if (this.camX < d1) return;
    if (!this.updateHudTimer) return;
    if (this.camMinX === d1) return;
    this.camMinX = d1;
    this.loadPLC('PlrList_Signpost');
  }

  // BuildSprites: anillos y listas de prioridad 0..7
  buildSprites() {
    const camX = this.camX, camY = this.camY >> 16;
    const vdp = this.vdp;
    vdp.sprites.length = 0;
    if (this.buildHUD) this.buildHUD();
    if (this.levelStarted) this.ringMgr.build();
    for (let p = 0; p < 8; p++) {
      for (const o of this.displayLists[p]) {
        o.render_flags &= ~RF_ONSCREEN;
        const base = o === this.sonic ? this.rom.o.MapUnc_Sonic : o.mappings;
        if (!base) continue;
        const flips = o.render_flags & 3;
        if (o.render_flags & RF_MULTI) {
          const sx = o.x - camX;
          if (sx + o.mainspr_width < 0 || sx - o.mainspr_width >= 320) continue;
          const sy = o.y - camY;
          if (((sy + 128) & 0x7FF) < 128 - 32 || ((sy + 128) & 0x7FF) >= 128 + 224 + 32) continue;
          if (o.mainspr_mapframe) vdp.addSprite(this.getMapping(base, o.mainspr_mapframe), sx, sy, o.art_tile, flips);
          o.render_flags |= RF_ONSCREEN;
          for (const c of o.children) {
            vdp.addSprite(this.getMapping(base, c.frame), c.x - camX, s16(((c.y - camY + 128) & 0x7FF) - 128), o.art_tile, flips);
          }
          continue;
        }
        let sx, sy;
        if (o.render_flags & RF_LEVEL) {
          sx = o.x - camX;
          if (sx + o.width_pixels < 0 || sx - o.width_pixels >= 320) continue;
          sy = o.y - camY;
          if (o.render_flags & RF_EXPLICIT_H) {
            if (sy + o.y_radius < 0 || sy - o.y_radius >= 224) continue;
          } else {
            const t = (sy + 128) & 0x7FF;
            if (t < 128 - 32 || t >= 128 + 224 + 32) continue;
            sy = t - 128;
          }
        } else { sx = o.x - 128; sy = o.y - 128; }
        let pieces = this.getMapping(base, o.mapping_frame);
        if (o.singlePiece) pieces = pieces.slice(0, 1);
        vdp.addSprite(pieces, sx, sy, o.art_tile, flips);
        o.render_flags |= RF_ONSCREEN;
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
    const ov = this.titleOverlay, camX = this.camX, vs = this.vdp.vscrollA;
    this.vdp.planeA = ov && ov.active
      ? (x, y) => { const w = ov.get((x - camX) >> 3, (y - vs) >> 3); return w || L.tileAt(x, y, 0); }
      : (x, y) => L.tileAt(x, y, 0);
    this.vdp.planeB = this.themeOn ? this.theme.bgPlane : (x, y) => L.tileAt(x, y, 1);
    this.vdp.render();
  }
}
