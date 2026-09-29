'use strict';
// Sacacorchos de EHZ (Obj06), escudo (Obj38), estrellas de invencibilidad (Obj35)
// y polvo del spindash / derrape (Obj08).

// ------------------------------------------------------------------ Obj06: sacacorchos
class Obj06 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) { this.routine = 2; this.width_pixels = 0xD0; }
    this.spiral();
    if (u16((this.x & 0xFF80) - g.camXCoarse) > 0x280) this.deleteObject();
  }

  spiral() {
    const g = this.game, rom = g.rom, a1 = this.sonic;
    if (this.status & P1_STANDING) {
      let d0 = Math.abs(a1.inertia);
      let falls = d0 < 0x600 || (a1.status & ST_AIR);
      if (!falls) {
        d0 = s16(a1.x - this.x + 0xD0);
        if (d0 < 0 || d0 >= 0x1A0) falls = true;
        else {
          if (!(a1.status & ST_ONOBJ)) return;
          const d1 = rom.s8(rom.o.Obj06_CosineTable + d0);
          a1.y = s16(this.y + d1 - (a1.y_radius - 0x13));
          a1.flip_angle = rom.u8(rom.o.Obj06_FlipAngleTable + ((d0 >> 3) & 0x3F));
          return;
        }
      }
      a1.status &= ~ST_ONOBJ;
      this.status &= ~P1_STANDING;
      a1.flips_remaining = 0;
      a1.flip_speed = 4;
      return;
    }
    if (a1.status & ST_AIR) return;
    const d0 = s16(a1.x - this.x);
    const lo = (a1.status & ST_ONOBJ) ? 0xB0 : 0xC0, hi = lo + 0x10;
    if (a1.x_vel >= 0) { if (d0 > -lo || d0 < -hi) return; }
    else if (d0 < lo || d0 > hi) return;
    const d1 = s16(a1.y - this.y - 0x10);
    if (u16(d1) >= 0x30) return;
    if (!(a1.status & ST_ONOBJ) && a1.obj_control) return;
    this.rideObjectSetRide();
  }
}

// ------------------------------------------------------------------ Obj38: escudo
class Obj38 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = g.rom.o.Obj38_MapUnc_1DBE4;
      this.render_flags = RF_LEVEL; this.priority = 1; this.width_pixels = 0x18;
      this.art_tile = ART.Shield;
    }
    const a2 = this.parent;
    if (a2.status_secondary & ST2_INVINC) return;
    if (!(a2.status_secondary & ST2_SHIELD)) { this.deleteObject(); return; }
    this.x = a2.x; this.y = a2.y;
    this.status = a2.status;
    this.art_tile = (this.art_tile & 0x7FFF) | (a2.art_tile & 0x8000);
    this.animateSprite(g.rom.o.Ani_obj38);
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj35: estrellas de invencibilidad
class Obj35 extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    if (this.routine === 0) {
      // Obj35_Main: crea las capas 1..3 en las ranuras siguientes
      const frames = [0, rom.o.Obj35_Layer1Frames1, rom.o.Obj35_Layer2Frames1, rom.o.Obj35_Layer3Frames1];
      const tableOff = [0, 0, 22, 44];
      const f2 = [0, 11, 13, 13]; // Obj35_LayerNFrames2 - Obj35_LayerNFrames1
      for (let i = 0; i < 4; i++) {
        const o = i === 0 ? this : (g.slots[this.slot + i] ? null : g.spawn(Obj35, this.slot + i));
        if (!o) continue;
        o.id = 0x35;
        o.routine = 4;
        o.mappings = rom.o.Obj35_MapUnc_1DCBC;
        o.art_tile = ART.InvStars;
        o.render_flags = RF_LEVEL | RF_MULTI;
        o.mainspr_width = 0x10; o.mainspr_mapframe = 0;
        o.children = [{ x: 0, y: 0, frame: 0 }, { x: 0, y: 0, frame: 0 }];
        o.parent = this.parent;
        o.layer = i;
        o.framesAddr = frames[i];
        o.tableOffset = tableOff[i];
        o.frames2 = f2[i];
        o.frameIndex = 0;
      }
      this.routine = 2;
      this.tableOffset = 4;
    }
    const a1 = this.parent;
    if (!(a1.status_secondary & ST2_INVINC)) { this.deleteObject(); return; }
    let x0, y0;
    const table = rom.o.Obj35_PositionOffsetTable;
    const param = (d6) => { d6 &= 0x3E; return [s16(rom.s8(table + d6) + x0), s16(rom.s8(table + d6 + 1) + y0)]; };
    if (this.routine === 2) {
      x0 = a1.x; y0 = a1.y;
      this.x = x0; this.y = y0;
      let d5 = rom.u8(rom.o.Obj35_Layer0Frames + this.frameIndex);
      if (d5 & 0x80) { this.frameIndex = 0; d5 = rom.u8(rom.o.Obj35_Layer0Frames); }
      this.frameIndex++;
      const d6 = this.tableOffset;
      [this.children[0].x, this.children[0].y] = param(d6); this.children[0].frame = d5;
      [this.children[1].x, this.children[1].y] = param(d6 + 32); this.children[1].frame = d5;
      this.tableOffset = u8(this.tableOffset + ((a1.status & ST_XFLIP) ? -18 : 18));
    } else {
      // capas retrasadas: usan posiciones anteriores de Sonic
      const idx = u8(g.posRecordIndex - this.layer * 12);
      x0 = s16(g.posRecordBuf[idx >> 1]); y0 = s16(g.posRecordBuf[(idx >> 1) + 1]);
      this.x = x0; this.y = y0;
      let d2 = this.frameIndex;
      let f1 = rom.u8(this.framesAddr + d2);
      if (f1 & 0x80) { this.frameIndex = d2 = 0; f1 = rom.u8(this.framesAddr); }
      const f2 = rom.u8(this.framesAddr + d2 + this.frames2);
      this.frameIndex++;
      const d6 = this.tableOffset;
      [this.children[0].x, this.children[0].y] = param(d6); this.children[0].frame = f2;
      [this.children[1].x, this.children[1].y] = param(d6 + 32); this.children[1].frame = f1;
      this.tableOffset = u8(this.tableOffset + ((a1.status & ST_XFLIP) ? -2 : 2));
    }
    g.displayLists[1].push(this);
  }
}

// ------------------------------------------------------------------ Obj08: polvo del spindash y del derrape
class Obj08 extends Obj {
  constructor(game) { super(game); this.prevFrame = -1; this.dustTimer = 0; }

  startSpindash() { this.anim = 2; }
  stopSpindash() { this.anim = 0; }
  startSkid() { this.routine = 6; this.mapping_frame = 0x15; }

  update() {
    const g = this.game, rom = g.rom;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = rom.o.Obj08_MapUnc_1DF5E;
      this.render_flags |= RF_LEVEL; this.priority = 1; this.width_pixels = 0x10;
      this.art_tile = ART.Dust;
      this.parent = this.parent || g.sonic;
    }
    const a2 = this.parent;
    switch (this.routine) {
      case 2:
        if (this.anim === 2) {
          if (a2.air_left < 12 || a2.routine >= 4 || !a2.spindash_flag) { this.anim = 0; return; }
          this.x = a2.x; this.y = a2.y;
          this.status = a2.status & 1;
          if (!this.prev_anim) this.art_tile = (this.art_tile & 0x7FFF) | (a2.art_tile & 0x8000);
        } else if (this.anim === 3) {
          if (a2.air_left < 12) { this.anim = 0; return; }
        }
        this.animateSprite(rom.o.Ani_obj08);
        this.loadArt();
        if (this.routine === 4) { this.deleteObject(); return; }
        this.displaySprite();
        return;
      case 4: this.deleteObject(); return;
      case 6: {
        if (a2.anim !== ANI.Stop) { this.routine = 2; this.dustTimer = 0; return; }
        if (--this.dustTimer < 0) {
          this.dustTimer = 3;
          const d = g.allocObject(Obj08);
          if (d) {
            d.id = 8; d.routine = 2; d.anim = 3;
            d.x = a2.x; d.y = s16(a2.y + 0x10);
            d.status = 0;
            d.mappings = this.mappings; d.render_flags = this.render_flags & ~RF_ONSCREEN;
            d.priority = 1; d.width_pixels = 4;
            d.art_tile = (this.art_tile & 0x7FFF) | (a2.art_tile & 0x8000);
            d.parent = a2;
            d.shareArt = true;
          }
        }
        this.loadArt();
        return;
      }
    }
  }

  // Obj08_LoadDustOrSplashArt: carga dinámica de patrones (DPLC)
  loadArt() {
    const f = this.mapping_frame;
    if (f === this.prevFrame) return;
    this.prevFrame = f;
    const rom = this.game.rom, base = rom.o.Obj08_MapRUnc_1E074;
    let a2 = base + rom.s16(base + f * 2);
    const n = rom.u16(a2); a2 += 2;
    let dst = ART.Dust;
    for (let i = 0; i < n; i++, a2 += 2) {
      const w = rom.u16(a2);
      const cnt = ((w >> 12) & 0xF) + 1;
      const src = rom.o.ArtUnc_SplashAndDust + (w & 0xFFF) * 32;
      this.game.vdp.loadTiles(rom.b.subarray(src, src + cnt * 32), dst);
      dst += cnt;
    }
  }
}

Object.assign(OBJ_CLASSES, { 0x06: Obj06 });
