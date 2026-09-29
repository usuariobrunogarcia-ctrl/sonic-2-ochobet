'use strict';
// Cartel de título (Obj34 + DrawLevelTitleCard), cartel de fin de acto (Obj0D),
// pantalla de resultados (Obj3A) y poste de control (Obj79).

// Palabras de patrón de relleno del cartel (make_block_tile_pair, prioridad alta)
const TC_BLUE = 0x8000 | (ART.TitleCard + 0x5A);
const TC_RED = 0x8000 | (ART.TitleCard + 0x58);
const TC_YELLOW = 0x8000 | (1 << 13) | (ART.TitleCard + 0x5C);

// Carga ArtNem_TitleCard y las letras de "EMERALD HILL" (LoadTitleCard)
function loadTitleCardArt(g) {
  const rom = g.rom;
  g.vdp.loadTiles(rom.nem('ArtNem_TitleCard'), ART.TitleCard);
  const letters = rom.nem('ArtNem_TitleCard2');
  let a = rom.o.TitleCardLetters_EHZ, dst = 0x5DE;
  for (;;) {
    const c = rom.u8(a);
    if (c & 0x80) break;
    const n = rom.u8(a + 1);
    g.vdp.loadTiles(letters.subarray(c * 32, c * 32 + n * 32), dst);
    dst += n;
    a += 2;
  }
}

// Capa del plano A usada por el cartel (64x32 celdas, 0 = transparente)
class TitleOverlay {
  constructor() { this.cells = new Uint16Array(64 * 32); this.active = false; }
  set(col, row, w) { if (col >= 0 && col < 64 && row >= 0 && row < 32) this.cells[row * 64 + col] = w; }
  get(col, row) { return this.cells[(row & 31) * 64 + (col & 63)]; }
}

class Obj34 extends Obj {
  update() {
    const g = this.game, ov = g.titleOverlay;
    switch (this.routine) {
      case 2: { // fondo azul entrando
        if (this.loc !== 0x10) {
          for (let r = 0; r < 2; r++) for (let c = 0; c < 64; c++) ov.set(c, this.loc * 2 + r, TC_BLUE);
          this.loc++;
        }
        return;
      }
      case 4: { // parte amarilla inferior entrando
        if (!this.wait()) return;
        if (this.loc >= 0) {
          this.drawYellow(this.loc);
          this.loc -= 2;
          if (this.loc === 6) this.loc = -1;
        }
        this.moveTowardsTarget();
        return;
      }
      case 6: { // parte roja izquierda entrando
        if (!this.wait()) return;
        if (this.loc >= 0) {
          this.loc += 2;
          for (let c = 0; c < this.loc; c++) for (let r = 0; r < 28; r++) ov.set(c, r, TC_RED);
          if (this.loc === 0xE) this.loc = -1;
        }
        this.moveTowardsTarget();
        return;
      }
      case 8: case 0xA: case 0xC:
        if (!this.wait()) return;
        this.moveTowardsTarget();
        return;
      case 0xE: { // parte roja saliendo
        if (this.loc < 0) {
          g.tcBottom.routine = 0x10; g.tcBottom.loc = 0;
          this.deleteObject(); return;
        }
        // columnas: azul (20 filas) + amarillo (8 filas)
        for (let c = this.loc; c < this.loc + 4; c++) {
          for (let r = 0; r < 20; r++) ov.set(c, r, TC_BLUE);
          for (let r = 20; r < 28; r++) ov.set(c, r, TC_YELLOW);
        }
        this.loc -= 4;
        if (this.loc === -2) this.loc = 0;
        this.moveTowardsSource(0x20);
        return;
      }
      case 0x10: { // parte amarilla saliendo
        if (this.loc === 0x28) { g.tcBackground.routine = 0x12; this.deleteObject(); return; }
        for (let r = 20; r < 28; r++) for (let c = this.loc; c < this.loc + 4; c++) ov.set(c, r, TC_BLUE);
        this.loc += 4;
        this.moveTowardsSource(0x20);
        return;
      }
      case 0x12: this.routine = 0x14; this.loc = 0xF0; // fallthrough
      case 0x14: { // el fondo desaparece de abajo arriba
        const d0 = this.loc - 0x20;
        if (d0 === -0x30) { ov.active = false; this.deleteObject(); return; }
        this.loc = d0;
        // se redibujan dos filas de bloques del nivel en y = d0-16 .. d0+16
        for (let y = d0; y < d0 + 32; y += 8) {
          if (y < 0 || y >= 256) continue;
          for (let c = 0; c < 64; c++) ov.set(c, y >> 3, 0);
        }
        return;
      }
      case 0x16: { // espera y sale (nombre, "ZONE", número de acto)
        if (this.anim_frame_duration) { this.anim_frame_duration--; this.displaySprite(); return; }
        const x = this.x;
        if (x === this.xSource) { this.deleteObject(); return; }
        this.x += x > this.xSource ? -0x20 : 0x20;
        if (u16(this.x) > 0x200) { this.deleteObject(); return; }
        this.displaySprite();
        return;
      }
    }
  }

  drawYellow(loc) {
    const ov = this.game.titleOverlay;
    for (let c = loc; c < 0x28; c++) for (let r = 20; r < 28; r++) ov.set(c, r, TC_YELLOW);
  }

  // Obj34_Wait: devuelve false mientras dura la espera inicial
  wait() {
    if (--this.anim_frame_duration !== 0) return false;
    this.anim_frame_duration = 1;
    return true;
  }

  moveTowardsTarget() {
    if (this.x !== this.xTarget) {
      this.x += this.x > this.xTarget ? -0x10 : 0x10;
      if (u16(this.x) > 0x200) return;
    }
    this.displaySprite();
  }

  moveTowardsSource(step) {
    if (this.x === this.xSource) return;
    this.x += this.x > this.xSource ? -step : step;
    if (u16(this.x) > 0x200) return;
    this.displaySprite();
  }
}

// Crea los seis objetos del cartel (Obj34_Init) con los datos de la ROM
function spawnTitleCard(g) {
  const rom = g.rom;
  const ov = g.titleOverlay;
  ov.cells.fill(0); ov.active = true;
  let a = rom.o.Obj34_TitleCardData;
  const objs = [];
  for (let i = 0; i < 6; i++, a += 10) {
    const o = g.spawn(Obj34, 0x02 + i);
    o.id = 0x34;
    o.routine = rom.u8(a);
    o.mappings = rom.o.MapUnc_TitleCards;
    o.mapping_frame = rom.u8(a + 1);
    o.width_pixels = rom.u8(a + 2);
    o.anim_frame_duration = rom.u8(a + 3);
    o.x = rom.s16(a + 4); o.xSource = o.x;
    o.xTarget = rom.s16(a + 6);
    o.y = rom.s16(a + 8);
    o.render_flags = 0; o.art_tile = 0; o.priority = 0;
    o.loc = 0;
    objs.push(o);
  }
  // el número de acto usa el frame $12 (acto 1); el nombre usa el frame de la zona (EHZ = 0)
  objs[2].mapping_frame = 0x12;
  g.tcZoneName = objs[0]; g.tcZone = objs[1]; g.tcAct = objs[2];
  g.tcBackground = objs[3]; g.tcBottom = objs[4]; g.tcLeft = objs[5];
  g.tcBottom.loc = 0x26;
}

// ------------------------------------------------------------------ Obj0D: cartel de fin de acto
class Obj0D extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = rom.o.Obj0D_MapUnc_195BE;
      this.art_tile = ART.Signpost;
      this.render_flags = RF_LEVEL;
      this.width_pixels = 0x18; this.priority = 4;
      this.spinframe = 0; this.sparkleframe = 0; this.sparkleTimer = 0; this.finalanim = 0;
    }
    if (g.updateHudTimer) {
      const d0 = s16(g.sonic.x - this.x);
      if (d0 >= 0 && d0 < 0x20) {
        g.audio.sfx('Signpost');
        g.updateHudTimer = false;
        this.anim = 1; this.prev_anim = 0;
        this.spinframe = 0;
        g.camMinX = g.camMaxX;
        this.routine_secondary = 2;
        if (!this.finalanim) this.finalanim = 3;
      }
    }
    switch (this.routine_secondary) {
      case 2: this.spin(); break;
      case 4: this.waitForSonic(); break;
    }
    this.animateSprite(rom.o.Ani_obj0D);
    this.markObjGone();
  }

  spin() {
    const g = this.game, rom = g.rom;
    if (--this.spinframe < 0) {
      this.spinframe = 60;
      if (++this.anim === 3) { this.routine_secondary = 4; this.anim = this.finalanim; }
    }
    if (--this.sparkleTimer >= 0) return;
    this.sparkleTimer = 0xB;
    const d0 = this.sparkleframe;
    this.sparkleframe = (this.sparkleframe + 2) & 0xE;
    const a2 = rom.o.Obj0D_RingSparklePositions + d0;
    const r = g.allocObject(RingSparkle);
    if (!r) return;
    r.id = 0x25; r.routine = 6;
    r.x = s16(this.x + rom.s8(a2)); r.y = s16(this.y + rom.s8(a2 + 1));
    r.mappings = rom.o.Obj25_MapUnc_12382;
    r.art_tile = ART.Ring | (1 << 13);
    r.render_flags = RF_LEVEL; r.priority = 2; r.width_pixels = 8;
  }

  waitForSonic() {
    const g = this.game, s = g.sonic;
    if (!(s.status & ST_AIR)) {
      g.controlLocked = true;
      g.ctrlHeld = BTN_RIGHT; g.ctrlPress = 0;
    }
    if (u16(s.x) < u16(g.camMaxX + 0x128)) return;
    this.routine_secondary = 0;
    g.loadEndOfAct();
  }
}

// Brillo de anillo (Obj25 en su rutina de destello)
class RingSparkle extends Obj {
  update() {
    this.animateSprite(this.game.rom.o.Ani_Ring);
    if (this.routine === 8) { this.deleteObject(); return; }
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj3A: resultados
class Obj3A extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    switch (this.routine) {
      case 0: {
        // crea las ocho partes (la primera ocupa la ranura de este objeto)
        let a = rom.o.Obj3A_SubObjectMetadata;
        for (let i = 0; i < 8; i++, a += 8) {
          const o = i === 0 ? this : g.allocObject(Obj3A);
          if (!o) break;
          o.id = 0x3A;
          o.x = rom.s16(a); o.xTarget = rom.s16(a + 2); o.y = rom.s16(a + 4);
          o.routine = rom.u8(a + 6); o.mapping_frame = rom.u8(a + 7);
          o.mappings = rom.o.MapUnc_EOLTitleCards;
          o.render_flags = 0; o.art_tile = 0; o.priority = 0;
        }
        return;
      }
      case 2:
        this.mapping_frame = 0;
        this.moveTowardsTarget();
        if (this.x === this.xTarget) { this.routine = 0xA; this.anim_frame_duration = 0xB4; }
        return;
      case 4: case 6: this.moveTowardsTarget(); return;
      case 8: this.mapping_frame = 6; this.moveTowardsTarget(); return; // acto 1 -> frame 6
      case 0xA: case 0xE:
        if (--this.anim_frame_duration === 0) this.routine += 2;
        this.displaySprite();
        return;
      case 0xC: {
        this.displaySprite();
        g.updateBonusScore = true;
        let d0 = 0;
        if (g.bonus[1]) { d0 += 10; g.bonus[1] -= 10; }
        if (g.bonus[2]) { d0 += 10; g.bonus[2] -= 10; }
        if (g.bonus[3]) { d0 += 10; g.bonus[3] -= 10; }
        g.bonus[0] += d0;
        if (d0) {
          g.addPoints(d0);
          if ((g.frame & 3) === 0) g.audio.sfx('Blip');
          return;
        }
        g.audio.sfx('TallyEnd');
        this.routine = 0xE;
        this.anim_frame_duration = g.bonus[0] >= 1000 ? 0x12C : 0xB4;
        return;
      }
      case 0x10:
        // EHZ acto 1 -> acto 2 en el original; aquí se vuelve a empezar el acto 1
        g.lastStarPole = 0;
        g.levelInactive = true;
        g.nextActPending = true;
        return;
      case 0x16:
        if (g.ringMgr.perfectLeft()) { this.deleteObject(); return; }
        this.moveTowardsTarget();
        return;
    }
  }

  moveTowardsTarget() {
    if (this.x !== this.xTarget) {
      this.x += this.x > this.xTarget ? -0x10 : 0x10;
      if (u16(this.x) > 0x200) return;
    }
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj79: poste de control
class Obj79 extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = rom.o.Obj79_MapUnc_1F424;
      this.art_tile = ART.Checkpoint;
      this.render_flags = RF_LEVEL | (this.render_flags & 3);
      this.width_pixels = 8; this.priority = 5;
      if (this.respawn_index) {
        const r = this.respawn_index;
        g.respawn[r] &= 0x7F;
        if ((g.respawn[r] & 1) || !((g.lastStarPole & 0x7F) < (this.subtype & 0x7F))) {
          g.respawn[r] |= 1;
          this.anim = 2;
        }
      }
    }
    if (this.routine === 2) {
      this.checkActivation();
      this.animateSprite(rom.o.Ani_obj79);
      this.markObjGone();
    } else if (this.routine === 6) this.dongle();
  }

  checkActivation() {
    const g = this.game, a3 = this.sonic;
    if ((g.lastStarPole & 0x7F) >= (this.subtype & 0x7F)) {
      if (!this.anim) this.anim = 2;
      return;
    }
    if (u16(a3.x - this.x + 8) >= 0x10) return;
    if (u16(a3.y - this.y + 0x40) >= 0x68) return;
    g.audio.sfx('Checkpoint');
    const d = g.allocObject(Obj79);
    if (d) {
      d.id = 0x79; d.routine = 6;
      d.cx = this.x; d.cy = s16(this.y - 0x14);
      d.mappings = this.mappings; d.art_tile = this.art_tile;
      d.render_flags = RF_LEVEL; d.width_pixels = 8; d.priority = 4;
      d.mapping_frame = 2; d.timer = 0x20; d.parentObj = this;
      d.x = d.cx; d.y = d.cy;
    }
    this.anim = 1;
    // Obj79_SaveData
    g.lastStarPole = this.subtype;
    g.checkpoint = {
      x: this.x, y: this.y, art_tile: a3.art_tile, top: a3.top_solid_bit, lrb: a3.lrb_solid_bit,
      timer: { ...g.timerParts }, camMaxY: g.camMaxY, camX: g.camX, camY: g.camY >> 16,
    };
    if (this.respawn_index) g.respawn[this.respawn_index] |= 1;
  }

  dongle() {
    if (--this.timer < 0) {
      const p = this.parentObj;
      if (p && !p.deleted) { p.anim = 2; p.mapping_frame = 0; }
      this.deleteObject();
      return;
    }
    const d0 = u8(this.angle - 0x40);
    this.angle = u8(this.angle - 0x10);
    const [sin, cos] = this.game.calcSine(d0);
    this.x = s16(((cos * 0xC00) >> 16) + this.cx);
    this.y = s16(((sin * 0xC00) >> 16) + this.cy);
    this.markObjGone();
  }
}

Object.assign(OBJ_CLASSES, { 0x0D: Obj0D, 0x79: Obj79 });
