'use strict';
// Monitores, contenido, explosión, animales, puntos, anillos perdidos,
// muelles y pinchos (Obj26, Obj2E, Obj27, Obj28, Obj29, Obj37, Obj41, Obj36).

// ObjCheckFloorDist: distancia al suelo bajo el objeto (sólido superior primario)
function objCheckFloorDist(g, o) {
  const L = g.level;
  L.colAddr = L.colP;
  L.a4 = 0; L.primaryAngle = 0;
  const d1 = L.findFloor(s16(o.y + s8(o.y_radius)), o.x, 0xC, 0, 0x10);
  let d3 = L.primaryAngle; if (d3 & 1) d3 = 0;
  return d1;
}

// Touch_ChkHurt2: el objeto a0 hiere al personaje a1
function touchChkHurt2(g, a0, a1) {
  if (a1.status_secondary & ST2_INVINC) return;
  if (a1.invulnerable_time) return;
  if (a1.routine >= 4) return;
  let f = ((a1.y << 16) | a1.ys) - (a1.y_vel << 8);
  a1.y = f >> 16; a1.ys = f & 0xFFFF;
  g.hurtCharacter(a1, a0);
}

// ------------------------------------------------------------------ Obj26: monitor
class Obj26 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      this.y_radius = 0xE; this.x_radius = 0xE;
      this.mappings = g.rom.o.Obj26_MapUnc_12D36;
      this.art_tile = ART.Powerups;
      this.render_flags = RF_LEVEL | (this.render_flags & 3);
      this.priority = 3; this.width_pixels = 0xF;
      if (this.respawn_index) {
        g.respawn[this.respawn_index] &= 0x7F;
        if (g.respawn[this.respawn_index] & 1) { this.routine = 8; this.mapping_frame = 0xB; return; }
      }
      this.collision_flags = 0x46;
      this.anim = this.subtype;
    }
    switch (this.routine) {
      case 2: this.main(); break;
      case 4: this.break_(); break;
      case 6: this.animateSprite(g.rom.o.Ani_obj26); this.markObjGone(); break;
      case 8: this.markObjGone(); break;
    }
  }

  main() {
    const g = this.game;
    if (this.routine_secondary) {
      objectMoveAndFall(this);
      const d1 = objCheckFloorDist(g, this);
      if (d1 < 0) { this.y = s16(this.y + d1); this.y_vel = 0; this.routine_secondary = 0; }
    }
    // SolidObject_Monitor
    const a1 = this.sonic;
    const d1 = 0x1A, d2 = 0xF, d3 = 0x10, d4 = this.x;
    if (this.status & P1_STANDING) {
      let ok = false;
      if (!(a1.status & ST_AIR)) {
        const d0 = s16(a1.x - this.x + d1);
        ok = d0 >= 0 && d0 < d1 * 2;
      }
      if (ok) this.mvSonicOnPtfm(d3, d4);
      else { a1.status &= ~ST_ONOBJ; a1.status |= ST_AIR; this.status &= ~P1_STANDING; }
    } else if (a1.anim !== ANI.Roll) {
      this.touch = 0;
      this.solidObjectCont(d1, d2);
    }
    this.animateSprite(g.rom.o.Ani_obj26);
    this.markObjGone();
  }

  break_() {
    const g = this.game;
    if (this.status & (P1_STANDING | P1_PUSHING)) {
      const s = this.sonic;
      s.status &= ~(ST_ONOBJ | ST_PUSH);
      s.status |= ST_AIR;
    }
    this.status = 0;
    this.routine = 6;
    this.collision_flags = 0;
    const icon = g.allocObject(Obj2E);
    if (icon) { icon.id = 0x2E; icon.x = this.x; icon.y = this.y; icon.anim = this.anim; icon.parent = this.parent; }
    const smoke = g.allocObject(Obj27);
    if (smoke) { smoke.id = 0x27; smoke.routine = 2; smoke.x = this.x; smoke.y = this.y; }
    if (this.respawn_index) g.respawn[this.respawn_index] |= 1;
    this.anim = 0xA;
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj2E: contenido del monitor
class Obj2E extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      this.art_tile = ART.Powerups | 0x8000;
      this.render_flags = RF_LEVEL;
      this.priority = 3; this.width_pixels = 8;
      this.y_vel = -0x300;
      this.mapping_frame = this.anim + 1;
      this.mappings = g.rom.o.Obj26_MapUnc_12D36;
      this.singlePiece = true; // render_flags.static_mappings: solo la primera pieza
    }
    if (this.routine === 2) {
      if (this.y_vel < 0) { objectMove(this); this.y_vel += 0x18; }
      else {
        this.routine = 4;
        this.anim_frame_duration = 0x1D;
        this.give();
      }
      this.displaySprite();
    } else {
      if (--this.anim_frame_duration < 0) { this.deleteObject(); return; }
      this.displaySprite();
    }
  }

  give() {
    const g = this.game, a1 = this.parent || g.sonic;
    switch (this.anim) {
      case 0: case 2: case 3: touchChkHurt2(g, this, a1); break; // Robotnik
      case 1: g.lives++; g.audio.music('ExtraLife'); break;
      case 4: {
        g.rings = Math.min(999, g.rings + 10);
        if (g.rings >= 100 && !(g.extraLifeFlags & 2)) { g.extraLifeFlags |= 2; g.extraLife(); }
        else if (g.rings >= 200 && !(g.extraLifeFlags & 4)) { g.extraLifeFlags |= 4; g.extraLife(); }
        else g.audio.sfx('Ring');
        break;
      }
      case 5:
        a1.status_secondary |= ST2_SHOES;
        a1.speedshoes_time = 20 * 60;
        g.sonicTopSpeed = 0xC00; g.sonicAccel = 0x18; g.sonicDecel = 0x80;
        g.audio.setTempo(true);
        break;
      case 6:
        a1.status_secondary |= ST2_SHIELD;
        g.audio.sfx('Shield');
        g.spawnShield();
        break;
      case 7:
        a1.status_secondary |= ST2_INVINC;
        a1.invincibility_time = 20 * 60;
        g.audio.music('Invincible');
        g.spawnInvincibility();
        break;
    }
  }
}

// ------------------------------------------------------------------ Obj27: explosión
class Obj27 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      const an = g.allocObject(Obj28);
      if (an) { an.id = 0x28; an.x = this.x; an.y = this.y; an.pointsFrame = this.pointsFrame || 0; }
    }
    if (this.routine === 2) {
      this.routine = 4;
      this.mappings = g.rom.o.Obj27_MapUnc_21120;
      this.art_tile = ART.Explosion;
      this.render_flags = RF_LEVEL;
      this.priority = 1; this.collision_flags = 0; this.width_pixels = 0xC;
      this.anim_frame_duration = 3; this.mapping_frame = 0;
      g.audio.sfx('Explosion');
    }
    if (--this.anim_frame_duration < 0) {
      this.anim_frame_duration = 7;
      if (++this.mapping_frame === 5) { this.deleteObject(); return; }
    }
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj28: animal liberado
class Obj28 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      const r = g.randomNumber() & 1;
      this.art_tile = r ? 0x594 : 0x580;
      // EHZ: ardilla (base 6) o flicky (base 5)
      const props = r ? [-0x300, -0x400, g.rom.o.Obj28_MapUnc_11E1C, 5] : [-0x280, -0x380, g.rom.o.Obj28_MapUnc_11E40, 6];
      this.groundXVel = props[0]; this.groundYVel = props[1]; this.mappings = props[2]; this.routineBase = props[3];
      this.y_radius = 0xC;
      this.render_flags = RF_LEVEL | 1;
      this.priority = 6; this.width_pixels = 8;
      this.anim_frame_duration = 7; this.mapping_frame = 2;
      this.y_vel = -0x400;
      const pts = g.allocObject(Obj29);
      if (pts) { pts.id = 0x29; pts.x = this.x; pts.y = this.y; pts.mapping_frame = (this.pointsFrame || 0) >> 1; }
      this.displaySprite();
      return;
    }
    if (this.routine === 2) {
      if (!(this.render_flags & RF_ONSCREEN)) { this.deleteObject(); return; }
      objectMoveAndFall(this);
      if (this.y_vel >= 0) {
        const d1 = objCheckFloorDist(g, this);
        if (d1 < 0) {
          this.y = s16(this.y + d1);
          this.x_vel = this.groundXVel; this.y_vel = this.groundYVel;
          this.mapping_frame = 1;
          this.routine = this.routineBase * 2 + 4;
        }
      }
      this.displaySprite();
      return;
    }
    const fly = this.routine === 6 || this.routine === 0xE || this.routine === 0x12;
    if (!fly) {
      objectMoveAndFall(this);
      this.mapping_frame = 1;
      if (this.y_vel >= 0) {
        this.mapping_frame = 0;
        const d1 = objCheckFloorDist(g, this);
        if (d1 < 0) { this.y = s16(this.y + d1); this.y_vel = this.groundYVel; }
      }
    } else {
      objectMove(this);
      this.y_vel += 0x18;
      if (this.y_vel >= 0) {
        const d1 = objCheckFloorDist(g, this);
        if (d1 < 0) { this.y = s16(this.y + d1); this.y_vel = this.groundYVel; }
      }
      if (--this.anim_frame_duration < 0) { this.anim_frame_duration = 1; this.mapping_frame = (this.mapping_frame + 1) & 1; }
    }
    if (!(this.render_flags & RF_ONSCREEN)) { this.deleteObject(); return; }
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj29: puntos
class Obj29 extends Obj {
  update() {
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = this.game.rom.o.Obj29_MapUnc_11ED0;
      this.art_tile = ART.Numbers | 0x8000;
      this.render_flags = RF_LEVEL; this.priority = 1; this.width_pixels = 8;
      this.y_vel = -0x300;
    }
    if (this.y_vel >= 0) { this.deleteObject(); return; }
    objectMove(this);
    this.y_vel += 0x18;
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj37: anillos perdidos
class Obj37 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) { this.spill(); }
    switch (this.routine) {
      case 2: this.main(); break;
      case 4:
        this.routine = 6; this.collision_flags = 0; this.priority = 1;
        g.collectRing();
      // fallthrough
      case 6:
        this.animateSprite(g.rom.o.Ani_Ring);
        if (this.routine === 8) { this.deleteObject(); return; }
        this.displaySprite();
        break;
      case 8: this.deleteObject(); break;
    }
  }

  setupRing(r) {
    const g = this.game;
    r.id = 0x37; r.routine = 2;
    r.y_radius = 8; r.x_radius = 8;
    r.x = this.x; r.y = this.y;
    r.mappings = g.rom.o.Obj25_MapUnc_12382;
    r.art_tile = ART.Ring | (1 << 13);
    r.render_flags = RF_ONSCREEN | RF_LEVEL;
    r.priority = 3; r.collision_flags = 0x47; r.width_pixels = 8;
    g.ringSpillCounter = 0xFF;
  }

  spill() {
    const g = this.game;
    let d5 = Math.min(g.rings, 32) - 1;
    let d4 = 0x288;
    let a1 = this;
    let d2 = 0, d3 = 0;
    for (;;) {
      this.setupRing(a1);
      if (!(d4 & 0x8000)) {
        const [sin, cos] = g.calcSine(d4 & 0xFF);
        const sh = (d4 >> 8) & 0xFF;
        d2 = s16(sin << sh); d3 = s16(cos << sh);
        const lo = (d4 & 0xFF) + 0x10;
        let w = (d4 & 0xFF00) | (lo & 0xFF);
        if (lo > 0xFF) { if (w < 0x80) w = 0x288; else w -= 0x80; }
        d4 = w;
      }
      a1.x_vel = d2; a1.y_vel = d3;
      d2 = s16(-d2);
      d4 = u16(-d4);
      if (--d5 < 0) break;
      a1 = g.allocObject(Obj37);
      if (!a1) break;
    }
    g.audio.sfx('RingSpill');
    g.rings = 0;
    g.extraLifeFlags = 0;
  }

  main() {
    const g = this.game;
    this.mapping_frame = g.ringSpillFrame;
    objectMove(this);
    this.y_vel = s16(this.y_vel + 0x18);
    if (this.y_vel >= 0 && ((g.frame + (0x8F - this.slot)) & 7) === 0) {
      if (this.render_flags & RF_ONSCREEN) {
        const L = g.level;
        L.colAddr = L.colP; L.a4 = 0; L.primaryAngle = 0;
        const d1 = L.ringFindFloor(s16(this.y + s8(this.y_radius)), this.x, 0xC, 0, 0x10);
        if (d1 < 0) {
          this.y = s16(this.y + d1);
          const d0 = this.y_vel >> 2;
          this.y_vel = s16(-(this.y_vel - d0));
        }
      }
    }
    if (g.ringSpillCounter === 0) { this.deleteObject(); return; }
    if (u16(g.camMaxY + 224) < u16(this.y)) { this.deleteObject(); return; }
    this.displaySprite();
  }
}

// ------------------------------------------------------------------ Obj41: muelles
class Obj41 extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = rom.o.Obj41_MapUnc_1901C;
      this.art_tile = ART.VrtclSprng;
      this.render_flags |= RF_LEVEL;
      this.width_pixels = 0x10; this.priority = 4;
      switch ((this.subtype >> 3) & 0xE) {
        case 2: this.routine = 4; this.anim = 2; this.mapping_frame = 3; this.art_tile = ART.HrzntlSprng; this.width_pixels = 8; break;
        case 4: this.routine = 6; this.mapping_frame = 6; this.status |= 2; break;
        case 6: this.routine = 8; this.anim = 4; this.mapping_frame = 7; this.art_tile = ART.DignlSprng; break;
        case 8: this.routine = 0xA; this.anim = 4; this.mapping_frame = 0xA; this.art_tile = ART.DignlSprng; this.status |= 2; break;
      }
      const d0 = this.subtype & 2;
      this.strength = d0 ? -0xA00 : -0x1000;
      if (d0) { this.art_tile |= 1 << 13; this.mappings = rom.o.Obj41_MapUnc_19032; }
    }
    const a1 = this.sonic;
    this.touch = 0;
    switch (this.routine) {
      case 2:
        this.solidObject(0x1B, 8, 0x10, this.x, true);
        if (this.status & P1_STANDING) this.bounceUp();
        break;
      case 4: {
        this.solidObject(0x13, 0xE, 0xF, this.x, true);
        if (this.status & P1_PUSHING) {
          let d1 = this.status;
          if (!(u16(this.x) < u16(a1.x))) d1 ^= 1;
          if (!(d1 & 1)) this.bounceSide();
        }
        this.sideCheck();
        break;
      }
      case 6:
        if (this.solidObject(0x1B, 8, 0x10, this.x, true) === -2) this.bounceDown();
        break;
      case 8:
        this.slopedSolid(0x1B, 0x10, this.x, rom.o.Obj41_SlopeData_DiagUp);
        if (this.status & P1_STANDING) this.bounceDiag(false);
        break;
      case 0xA:
        if (this.slopedSolid(0x1B, 0x10, this.x, rom.o.Obj41_SlopeData_DiagDown) === -2) this.bounceDiag(true);
        break;
    }
    this.animateSprite(rom.o.Ani_obj41);
    this.markObjGone();
  }

  // SlopedSolid_SingleCharacter
  slopedSolid(d1, d2, d4, a2) {
    const a1 = this.sonic, rom = this.game.rom;
    if (this.status & P1_STANDING) {
      const w = d1 * 2;
      if (!(a1.status & ST_AIR)) {
        let d0 = s16(a1.x - this.x + d1);
        if (d0 >= 0 && d0 < w) {
          if (a1.status & ST_ONOBJ) {
            d0 = u16(d0) >> 1;
            if (this.render_flags & 1) d0 = s16(~d0 + d1);
            const h = rom.s8(a2 + d0);
            a1.y = s16(this.y - h - a1.y_radius);
            a1.x = s16(a1.x - (d4 - this.x));
          }
          return 0;
        }
      }
      a1.status &= ~ST_ONOBJ; a1.status |= ST_AIR; this.status &= ~P1_STANDING;
      return 0;
    }
    // SlopedSolid_cont
    let d0 = s16(a1.x - this.x + d1);
    if (d0 < 0) return this.solidTestClearPush();
    let d3 = d1 * 2;
    if (u16(d0) > d3) return this.solidTestClearPush();
    let d5 = d0;
    if (this.render_flags & 1) d5 = s16(~d5 + d3);
    d5 = u16(d5) >> 1;
    let h = s8(rom.u8(a2 + d5) - rom.u8(a2));
    const y0 = s16(this.y - h);
    d2 = d2 + s8(a1.y_radius);
    d3 = s16(a1.y - y0 + 4 + d2);
    if (d3 < 0) return this.solidTestClearPush();
    const d4b = d2 * 2;
    if (d3 >= d4b) return this.solidTestClearPush();
    return this.solidChkBounds(d0, d1, d2, d3, d4b);
  }

  flipAndLayer(a1, d0, horiz) {
    if (d0 & 1) {
      a1.inertia = 1; a1.flip_angle = 1; a1.anim = ANI.Walk;
      if (horiz) { a1.flips_remaining = 1; a1.flip_speed = 8; if (!(d0 & 2)) a1.flips_remaining = 3; }
      else { a1.flips_remaining = 0; a1.flip_speed = 4; if (!(d0 & 2)) a1.flips_remaining = 1; }
      if (a1.status & ST_XFLIP) { a1.flip_angle = u8(-a1.flip_angle); a1.inertia = -a1.inertia; }
    }
    const l = d0 & 0xC;
    if (l === 4) { a1.top_solid_bit = 0xC; a1.lrb_solid_bit = 0xD; }
    if (l === 8) { a1.top_solid_bit = 0xE; a1.lrb_solid_bit = 0xF; }
  }

  bounceUp() {
    const a1 = this.sonic;
    this.anim = 1; this.prev_anim = 0;
    a1.y = s16(a1.y + 8);
    a1.y_vel = this.strength;
    a1.status |= ST_AIR; a1.status &= ~ST_ONOBJ;
    a1.anim = ANI.Spring;
    a1.routine = 2;
    const d0 = this.subtype;
    if (d0 & 0x80) a1.x_vel = 0;
    this.flipAndLayer(a1, d0, false);
    this.game.audio.sfx('Spring');
  }

  bounceDown() {
    const a1 = this.sonic;
    this.anim = 1; this.prev_anim = 0;
    a1.y = s16(a1.y - 8);
    a1.y_vel = s16(-this.strength);
    const d0 = this.subtype;
    if (d0 & 0x80) a1.x_vel = 0;
    this.flipAndLayer(a1, d0, false);
    a1.status |= ST_AIR; a1.status &= ~ST_ONOBJ;
    a1.routine = 2;
    this.game.audio.sfx('Spring');
  }

  bounceSide() {
    const a1 = this.sonic;
    this.anim = 3; this.prev_anim = 0;
    a1.x_vel = this.strength;
    a1.x = s16(a1.x + 8);
    a1.status |= ST_XFLIP;
    if (!(this.status & 1)) {
      a1.status &= ~ST_XFLIP;
      a1.x = s16(a1.x - 0x10);
      a1.x_vel = s16(-a1.x_vel);
    }
    a1.move_lock = 0xF;
    a1.inertia = a1.x_vel;
    if (!(a1.status & ST_ROLL)) a1.anim = ANI.Walk;
    const d0 = this.subtype;
    if (d0 & 0x80) a1.y_vel = 0;
    this.flipAndLayer(a1, d0, true);
    this.status &= ~P1_PUSHING;
    a1.status &= ~ST_PUSH;
    this.game.audio.sfx('Spring');
  }

  // loc_18BC6: el muelle horizontal lanza a Sonic si corre hacia él sin tocarlo
  sideCheck() {
    if (this.anim === 3) return;
    const a1 = this.sonic;
    let d0 = this.x, d1 = u16(d0 + 0x28);
    if (this.status & 1) { d1 = d0; d0 = u16(d0 - 0x28); }
    const d2 = u16(this.y - 0x18), d3 = u16(this.y + 0x18);
    if (a1.status & ST_AIR) return;
    let d4 = a1.inertia;
    if (this.status & 1) d4 = -d4;
    if (d4 < 0) return;
    const x = u16(a1.x), y = u16(a1.y);
    if (x < d0 || x >= d1 || y < d2 || y >= d3) return;
    this.bounceSide();
  }

  bounceDiag(down) {
    const a1 = this.sonic;
    if (!down) {
      if (!(this.status & 1)) { if (!(u16(this.x - 4) < u16(a1.x))) return; }
      else { if (!(u16(this.x + 4) >= u16(a1.x))) return; }
    }
    this.anim = 5; this.prev_anim = 0;
    a1.y_vel = down ? s16(-this.strength) : this.strength;
    a1.x_vel = this.strength;
    a1.y = s16(a1.y + (down ? -6 : 6));
    a1.x = s16(a1.x + 6);
    a1.status |= ST_XFLIP;
    if (!(this.status & 1)) {
      a1.status &= ~ST_XFLIP;
      a1.x = s16(a1.x - 0xC);
      a1.x_vel = s16(-a1.x_vel);
    }
    a1.status |= ST_AIR; a1.status &= ~ST_ONOBJ;
    if (!down) a1.anim = ANI.Spring;
    a1.routine = 2;
    this.flipAndLayer(a1, this.subtype, true);
    this.game.audio.sfx('Spring');
  }
}

// ------------------------------------------------------------------ Obj36: pinchos
class Obj36 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = g.rom.o.Obj36_MapUnc_15B68;
      this.art_tile = ART.Spikes | (1 << 13);
      this.render_flags |= RF_LEVEL;
      this.priority = 4;
      let d0 = this.subtype & 0xF0;
      this.subtype &= 0xF;
      const init = [[0x10, 0x10], [0x20, 0x10], [0x30, 0x10], [0x40, 0x10], [0x10, 0x10], [0x10, 0x20], [0x10, 0x30], [0x10, 0x40]];
      const e = init[(d0 >> 4) & 7];
      this.width_pixels = e[0]; this.y_radius = e[1];
      d0 >>= 4;
      this.mapping_frame = d0;
      if (d0 >= 4) { this.routine = 4; this.art_tile = 0x42C | (1 << 13); }
      if (this.status & 2) this.routine = 6;
      this.baseX = this.x; this.baseY = this.y;
      this.retractOffset = 0; this.retractState = 0; this.retractTimer = 0;
    }
    const x0 = this.x;
    this.moveSpikes();
    this.touch = 0;
    const d1 = this.width_pixels + 0xB, d2 = this.y_radius, d3 = d2 + 1;
    const a1 = this.sonic;
    switch (this.routine) {
      case 2:
        this.solidObject(d1, d2, d3, this.x);
        if (this.status & P1_STANDING) touchChkHurt2(g, this, a1);
        break;
      case 4:
        this.solidObject(d1, d2, d3, x0);
        if (this.touch & TOUCH_SIDE) { touchChkHurt2(g, this, a1); this.status &= ~P1_PUSHING; }
        break;
      case 6:
        this.solidObject(d1, d2, d3, this.x);
        if (this.touch & TOUCH_BOTTOM) touchChkHurt2(g, this, a1);
        break;
    }
    this.markObjGone(this.baseX);
  }

  moveSpikes() {
    const t = this.subtype;
    if (t !== 1 && t !== 2) return;
    if (this.retractTimer) {
      if (--this.retractTimer === 0 && (this.render_flags & RF_ONSCREEN)) this.game.audio.sfx('SpikesMove');
    } else if (this.retractState) {
      this.retractOffset -= 0x800;
      if (this.retractOffset < 0) { this.retractOffset = 0; this.retractState = 0; this.retractTimer = 60; }
    } else {
      this.retractOffset += 0x800;
      if (this.retractOffset >= 0x2000) { this.retractOffset = 0x2000; this.retractState = 1; this.retractTimer = 60; }
    }
    const off = this.retractOffset >> 8;
    if (t === 1) this.y = s16(this.baseY + off); else this.x = s16(this.baseX + off);
  }
}

Object.assign(OBJ_CLASSES, { 0x26: Obj26, 0x36: Obj36, 0x41: Obj41 });
