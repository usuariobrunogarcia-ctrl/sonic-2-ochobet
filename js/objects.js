'use strict';
// Motor de objetos: gestor de objetos (ObjectsManager), rutinas comunes
// (SolidObject, PlatformObject, AnimateSprite, MarkObjGone...) y anillos.

const P1_STANDING = 0x08, P2_STANDING = 0x10, P1_PUSHING = 0x20, NO_BALANCING = 0x80;
const RF_ONSCREEN = 0x80, RF_MULTI = 0x40, RF_EXPLICIT_H = 0x10, RF_LEVEL = 4;
const TOUCH_SIDE = 1, TOUCH_BOTTOM = 4, TOUCH_TOP = 0x10;

// Posiciones de patrones en VRAM (ArtTile_*)
const ART = {
  Ring: 0x6BC, HUD: 0x6CA, LifeCounter: 0x7D4, Numbers: 0x4AC,
  Checkpoint: 0x47C, Powerups: 0x680, Shield: 0x4BE, InvStars: 0x4DE,
  Explosion: 0x5A4, Animal1: 0x580, Animal2: 0x592, Signpost: 0x434,
  Spikes: 0x434, DignlSprng: 0x43C, VrtclSprng: 0x45C, HrzntlSprng: 0x470,
  Waterfall: 0x39E, Bridge: 0x3B6, Buzzer: 0x3D2, Coconuts: 0x3EE, Masher: 0x414,
  BoltEnd: 0x43C, Dust: 0x49C, TitleCard: 0x580, ResultsText: 0x5B0,
  MiniSonic: 0x5F4, Perfect: 0x5C4,
};

class Obj extends GameObject {
  constructor(game) { super(); this.game = game; this.slot = -1; }
  get sonic() { return this.game.sonic; }
  get rom() { return this.game.rom; }
  update() {}

  displaySprite() { this.game.displaySprite(this); }
  deleteObject() { this.game.deleteObject(this); }

  outOfRange(x = this.x) {
    return u16((x & 0xFF80) - this.game.camXCoarse) > 0x280;
  }
  clearRespawn() {
    if (this.respawn_index) this.game.respawn[this.respawn_index] &= 0x7F;
  }
  markObjGone(x = this.x) {
    if (this.outOfRange(x)) { this.clearRespawn(); this.deleteObject(); return true; }
    this.displaySprite();
    return false;
  }
  markObjGone3() {
    if (this.outOfRange()) { this.clearRespawn(); this.deleteObject(); return true; }
    return false;
  }

  // AnimateSprite con los guiones de animación de la ROM
  animateSprite(table) {
    const rom = this.game.rom;
    let d0 = this.anim;
    if (d0 !== this.prev_anim) { this.prev_anim = d0; this.anim_frame = 0; this.anim_frame_duration = 0; }
    this.anim_frame_duration = u8(this.anim_frame_duration - 1);
    if (!(this.anim_frame_duration & 0x80)) return;
    const a1 = table + rom.s16(table + d0 * 2);
    this.anim_frame_duration = rom.u8(a1);
    let d1 = this.anim_frame;
    d0 = rom.u8(a1 + 1 + d1);
    if (d0 & 0x80) {
      if (d0 === 0xFF) { this.anim_frame = 0; d0 = rom.u8(a1 + 1); }
      else if (d0 === 0xFE) {
        const b = rom.u8(a1 + 2 + d1);
        this.anim_frame = u8(this.anim_frame - b);
        d0 = rom.u8(a1 + 1 + u8(d1 - b));
      } else if (d0 === 0xFD) { this.anim = rom.u8(a1 + 2 + d1); return; }
      else if (d0 === 0xFC) { this.routine += 2; this.anim_frame_duration = 0; this.anim_frame = u8(this.anim_frame + 1); return; }
      else if (d0 === 0xFB) { this.anim_frame = 0; this.routine_secondary = 0; return; }
      else if (d0 === 0xFA) { this.routine_secondary += 2; return; }
      else return;
    }
    this.mapping_frame = d0 & 0x7F;
    this.render_flags = (this.render_flags & ~3) | (this.status & 3);
    this.anim_frame = u8(this.anim_frame + 1);
  }

  // ------------------------------------------------------------ sólidos
  // SolidObject (d1 = ancho/2, d2 = alto/2 saltando, d3 = alto/2 andando, d4 = x anterior)
  solidObject(d1, d2, d3, d4, always = false) {
    const a1 = this.sonic;
    if (this.status & P1_STANDING) {
      const w = d1 * 2;
      if (!(a1.status & ST_AIR)) {
        const d0 = s16(a1.x - this.x + d1);
        if (d0 >= 0 && d0 < w) { this.mvSonicOnPtfm(d3, d4); return 0; }
      }
      a1.status &= ~ST_ONOBJ; a1.status |= ST_AIR; this.status &= ~P1_STANDING;
      return 0;
    }
    if (!always && !(this.render_flags & RF_ONSCREEN)) return this.solidTestClearPush();
    return this.solidObjectCont(d1, d2);
  }

  solidObjectCont(d1, d2) {
    const a1 = this.sonic;
    let d0 = s16(a1.x - this.x + d1);
    if (d0 < 0) return this.solidTestClearPush();
    let d3 = d1 * 2;
    if (u16(d0) > d3) return this.solidTestClearPush();
    d2 = d2 + s8(a1.y_radius);
    d3 = s16(a1.y - this.y + 4 + d2);
    if (d3 < 0) return this.solidTestClearPush();
    d3 &= 0x7FF;
    const d4 = d2 * 2;
    if (d3 >= d4) return this.solidTestClearPush();
    return this.solidChkBounds(d0, d1, d2, d3, d4);
  }

  solidChkBounds(d0, d1, d2, d3, d4) {
    const a1 = this.sonic;
    if (a1.obj_control & 0x80) return this.solidTestClearPush();
    if (a1.routine >= 6) return 0;
    let d5 = d0;
    if (!(u16(d1) >= u16(d0))) { d0 = s16(d0 - d1 * 2); d5 = -d0; }
    let d1b = d3;
    if (!(u16(d2) >= u16(d3))) { d3 = s16(d3 - 4 - d4); d1b = -d3; }
    if (u16(d5) > u16(d1b)) return this.solidTopBottom(d0, d3);
    return this.solidLeftRight(d0, d1b);
  }

  solidLeftRight(d0, d1) {
    const a1 = this.sonic;
    if (u16(d1) <= 4) return this.solidSideAir();
    if (d0 !== 0) {
      if (d0 > 0) { if (a1.x_vel >= 0) { a1.inertia = 0; a1.x_vel = 0; } }
      else { if (a1.x_vel < 0) { a1.inertia = 0; a1.x_vel = 0; } }
    }
    a1.x = s16(a1.x - d0);
    if (a1.status & ST_AIR) return this.solidSideAir();
    this.status |= P1_PUSHING;
    a1.status |= ST_PUSH;
    this.touch |= TOUCH_SIDE;
    return 1;
  }

  solidSideAir() {
    this.solidNotPushing();
    this.touch |= TOUCH_SIDE;
    return 1;
  }

  solidTestClearPush() {
    const a1 = this.sonic;
    if (!(this.status & P1_PUSHING)) return 0;
    if (a1.anim !== ANI.Roll) { a1.anim = ANI.Walk; a1.prev_anim = ANI.Run; }
    this.solidNotPushing();
    return 0;
  }

  solidNotPushing() {
    this.status &= ~P1_PUSHING;
    this.sonic.status &= ~ST_PUSH;
  }

  solidTopBottom(d0, d3) {
    const a1 = this.sonic;
    if (d3 < 0) {
      // SolidObject_InsideBottom
      if (a1.y_vel === 0) {
        // SolidObject_Squash
        if (!(a1.status & ST_AIR)) {
          if (Math.abs(d0) < 0x10) return this.solidLeftRight(d0, Math.abs(d3));
          this.game.killCharacter(a1, this);
          this.touch |= TOUCH_BOTTOM;
          return -2;
        }
      } else if (a1.y_vel < 0) {
        a1.y = s16(a1.y - d3);
        a1.y_vel = 0;
      }
      this.touch |= TOUCH_BOTTOM;
      return -2;
    }
    if (d3 >= 0x10) return this.solidTestClearPush();
    // SolidObject_Landed
    d3 -= 4;
    let d1 = this.width_pixels;
    const d2 = d1 * 2;
    d1 = s16(d1 + a1.x - this.x);
    if (d1 < 0 || d1 >= d2) return 0;
    if (a1.y_vel < 0) return 0;
    a1.y = s16(a1.y - d3 - 1);
    this.rideObjectSetRide();
    this.touch |= TOUCH_TOP;
    return -1;
  }

  mvSonicOnPtfm(d3, d4) {
    const a1 = this.sonic;
    if (a1.obj_control & 0x80) return;
    if (a1.routine >= 6) return;
    a1.y = s16(this.y - d3 - a1.y_radius);
    a1.x = s16(a1.x - (d4 - this.x));
  }

  // PlatformObject (d1 = ancho/2, d3 = alto/2, d4 = x anterior)
  platformObject(d1, d3, d4) {
    const a1 = this.sonic;
    if (this.status & P1_STANDING) {
      const w = d1 * 2;
      if (!(a1.status & ST_AIR)) {
        const d0 = s16(a1.x - this.x + d1);
        if (d0 >= 0 && d0 < w) { this.mvSonicOnPtfm(d3, d4); return 0; }
      }
      a1.status &= ~ST_ONOBJ; a1.status |= ST_AIR; this.status &= ~P1_STANDING;
      return 0;
    }
    if (a1.y_vel < 0) return 0;
    const d0 = s16(a1.x - this.x + d1);
    if (d0 < 0 || d0 >= d1 * 2) return 0;
    return this.platformChkYRange(s16(this.y - d3));
  }

  platformChkYRange(d0) {
    const a1 = this.sonic;
    let d2 = a1.y;
    const d1 = s16(d2 + s8(a1.y_radius) + 4);
    d0 = s16(d0 - d1);
    if (d0 > 0) return 0;
    if (u16(d0) < u16(-0x10)) return 0;
    if (a1.obj_control & 0x80) return 0;
    if (a1.routine >= 6) return 0;
    a1.y = s16(d2 + d0 + 3);
    this.rideObjectSetRide();
    return 0;
  }

  rideObjectSetRide() {
    const a1 = this.sonic;
    if ((a1.status & ST_ONOBJ) && a1.interact && a1.interact !== this) a1.interact.status &= ~P1_STANDING;
    a1.interact = this;
    a1.angle = 0;
    a1.y_vel = 0;
    a1.inertia = a1.x_vel;
    if (a1.status & ST_AIR) a1.resetOnFloorPart2();
    a1.status |= ST_ONOBJ;
    a1.status &= ~ST_AIR;
    this.status |= P1_STANDING;
  }

  // SlopedPlatform (a2 = dirección de la tabla de alturas en la ROM)
  slopedPlatform(d1, d3, d4, a2) {
    const a1 = this.sonic, rom = this.game.rom;
    if (this.status & P1_STANDING) {
      const w = d1 * 2;
      if (!(a1.status & ST_AIR)) {
        let d0 = s16(a1.x - this.x + d1);
        if (d0 >= 0 && d0 < w) {
          // MvSonicOnSlope
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
    if (a1.y_vel < 0) return 0;
    let d0 = s16(a1.x - this.x + d1);
    if (d0 < 0) return 0;
    const w = d1 * 2;
    if (d0 >= w) return 0;
    if (this.render_flags & 1) d0 = s16(~d0 + w);
    d0 = u16(d0) >> 1;
    const h = rom.s8(a2 + d0);
    return this.platformChkYRange(s16(this.y - h));
  }
}

// ------------------------------------------------------------------ Obj03: cambio de plano
class Obj03 extends Obj {
  update() {
    if (this.routine === 0) {
      this.routine = 2;
      this.width_pixels = 0x10; this.priority = 5; this.render_flags |= RF_LEVEL;
      const d0 = this.subtype;
      const radii = [0x20, 0x40, 0x80, 0x100];
      if (d0 & 4) {
        this.routine = 4;
        this.mapping_frame = d0 & 7;
        this.radius = radii[d0 & 3];
        this.p1flag = u16(this.y) < u16(this.sonic.y) ? 1 : 0;
      } else {
        this.mapping_frame = d0 & 3;
        this.radius = radii[d0 & 3];
        this.p1flag = u16(this.x) < u16(this.sonic.x) ? 1 : 0;
      }
    }
    const a1 = this.sonic;
    const horiz = this.routine === 2;
    const d1 = horiz ? this.x : this.y;
    const pos = horiz ? a1.x : a1.y;
    const other = horiz ? a1.y : a1.x;
    const center = horiz ? this.y : this.x;
    let bitSolid, bitPrio;
    if (!this.p1flag) {
      if (u16(d1) > u16(pos)) return this.markObjGone3();
      this.p1flag = 1; bitSolid = 8; bitPrio = 0x20;
    } else {
      if (u16(d1) <= u16(pos)) return this.markObjGone3();
      this.p1flag = 0; bitSolid = 0x10; bitPrio = 0x40;
    }
    const d2 = s16(center - this.radius), d3 = s16(center + this.radius);
    if (other < d2 || other >= d3) return this.markObjGone3();
    const d0 = this.subtype;
    if ((d0 & 0x80) && (a1.status & ST_AIR)) return this.markObjGone3();
    if (!(this.render_flags & 1)) {
      a1.top_solid_bit = 0xC; a1.lrb_solid_bit = 0xD;
      if (d0 & bitSolid) { a1.top_solid_bit = 0xE; a1.lrb_solid_bit = 0xF; }
    }
    a1.art_tile &= 0x7FFF;
    if (d0 & bitPrio) a1.art_tile |= 0x8000;
    this.markObjGone3();
  }
}

// ------------------------------------------------------------------ Obj11: puente de troncos (EHZ)
class Obj11 extends Obj {
  update() {
    if (this.render_flags & RF_MULTI) { this.game.displayLists[3].push(this); return; }
    if (this.routine === 0) this.init();
    this.main();
  }

  init() {
    const g = this.game;
    this.routine = 2;
    this.mappings = g.rom.o.Obj11_MapUnc_FC70;
    this.art_tile = ART.Bridge | (2 << 13);
    this.priority = 3;
    this.render_flags = RF_LEVEL | (this.render_flags & 3);
    this.width_pixels = 0x80;
    this.baseY = this.y;
    this.v3E = 0; this.v3F = 0;
    let d3 = s16(this.x - ((this.subtype >> 1) << 4));
    const n = this.subtype;
    const mk = (count) => {
      const c = g.allocObjectAfter(this, Obj11);
      if (!c) return null;
      c.id = 0x11;
      c.x = this.x; c.y = this.y;
      c.mappings = this.mappings; c.art_tile = this.art_tile;
      c.render_flags = this.render_flags | RF_MULTI;
      c.mainspr_width = 0x40; c.mainspr_mapframe = 0;
      c.children = [];
      for (let i = 0; i < count; i++) { c.children.push({ x: d3, y: this.y, frame: 0 }); d3 += 0x10; }
      return c;
    };
    const c1 = mk(8);
    c1.x = c1.children[4].x - 8; // sub6_x_pos - 8
    this.child1 = c1;
    this.child2 = null;
    if (n > 8) {
      const c2 = mk(n - 8);
      c2.x = c2.children[Math.floor((n - 8) / 2)].x - 8;
      this.child2 = c2;
    }
  }

  log(i) { return i < 8 ? this.child1.children[i] : this.child2.children[i - 8]; }

  main() {
    const standing = this.status & (P1_STANDING | P2_STANDING);
    let depress = true;
    if (!standing) {
      if (this.v3E) this.v3E -= 4; else depress = false;
    } else if (this.v3E !== 0x40) this.v3E += 4;
    if (depress) this.depress();
    let d1 = this.subtype << 3;
    const d2 = d1 * 2;
    d1 += 8;
    this.standOn(d1, d2, 8);
    // Obj11_Unload
    if (u16((this.x & 0xFF80) - this.game.camXCoarse) > 0x280) {
      this.game.deleteObject(this.child1);
      if (this.child2) this.game.deleteObject(this.child2);
      this.deleteObject();
    }
  }

  // sub_F872 (solo jugador 1)
  standOn(d1, d2, d3) {
    const a1 = this.sonic;
    if (this.status & P1_STANDING) {
      let ok = false, d0 = 0;
      if (!(a1.status & ST_AIR)) {
        d0 = s16(a1.x - this.x + d1);
        if (d0 >= 0 && d0 < d2) ok = true;
      }
      if (!ok) { a1.status &= ~ST_ONOBJ; this.status &= ~P1_STANDING; return; }
      d0 >>= 4;
      this.v3F = d0 & 0xFF;
      const y = this.log(d0).y;
      a1.y = s16(y - 8 - a1.y_radius);
      return;
    }
    // PlatformObject11_cont
    if (a1.y_vel < 0) return;
    let d0 = s16(a1.x - this.x + d1);
    if (d0 < 0 || d0 >= d2) return;
    this.platformChkYRange(s16(this.y - d3));
    if (this.status & P1_STANDING) {
      d0 = s16(a1.x - this.x + d1);
      this.v3F = (u16(d0) >> 4) & 0xFF;
    }
  }

  depress() {
    const g = this.game, rom = g.rom;
    const [d4] = g.calcSine(this.v3E);
    const a4 = rom.o.byte_FB28;
    const d0 = this.subtype << 4;
    let d3 = this.v3F;
    let d2 = d3;
    d3 += d0;
    const d5 = rom.u8(rom.o.Obj11_DepressionOffsets - 0x80 + d3);
    d3 = (d3 & 0xF) << 4;
    let a3 = a4 + d3;
    let idx = 0;
    for (let i = 0; i <= d2; i++) {
      const v = ((rom.u8(a3++) + 1) * d5 * u16(d4)) >>> 16;
      this.log(idx++).y = s16(v + this.baseY);
    }
    let e = u8(-(u8(this.v3F + 1 - this.subtype)));
    if (e & 0x80) return;
    let d2b = e;
    a3 = a4 + (e << 4) + d2b;
    for (let i = 0; i < d2b; i++) {
      const v = ((rom.u8(--a3) + 1) * d5 * u16(d4)) >>> 16;
      this.log(idx++).y = s16(v + this.baseY);
    }
  }
}

// ------------------------------------------------------------------ Obj18: plataforma
class Obj18 extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      const idx = ((this.subtype >> 3) & 0xE) >> 1;
      const init = [[0x20, 0], [0x20, 1], [0x20, 2], [0x40, 3], [0x30, 4]][idx];
      this.width_pixels = init[0]; this.mapping_frame = init[1];
      this.mappings = g.rom.o.Obj18_MapUnc_107F6;
      this.art_tile = 2 << 13;
      this.render_flags |= RF_LEVEL;
      this.priority = 4;
      this.yActual = this.y; this.yActualSub = 0;
      this.yOrigin = this.y; this.xOrigin = this.x;
      this.angle = 0; // move.w #$80,angle escribe 0 en el byte del ángulo
      this.yOffset = 0; this.delay = 0;
      if (this.subtype & 0x80) {
        this.routine = 8;
        this.subtype &= 0xF;
        this.y_radius = 0x30;
        this.render_flags |= RF_EXPLICIT_H;
      } else this.subtype &= 0xF;
    }
    switch (this.routine) {
      case 2: this.solidMode(false); break;
      case 4: this.deleteObject(); break;
      case 6: this.move(); this.nudge(); this.despawn(); break;
      case 8: this.solidMode(true); break;
    }
  }

  solidMode(full) {
    if (!(this.status & (P1_STANDING | P2_STANDING))) { if (this.yOffset) this.yOffset -= 4; }
    else if (this.yOffset !== 0x40) this.yOffset += 4;
    const x0 = this.x;
    this.move();
    this.nudge();
    if (this.routine === 4) { this.deleteObject(); return; }
    if (full) {
      this.touch = 0;
      this.solidObject(this.width_pixels + 0xB, this.y_radius, this.y_radius + 1, x0);
    } else this.platformObject(this.width_pixels, 8, x0);
    this.despawn();
  }

  despawn() {
    if (u16((this.xOrigin & 0xFF80) - this.game.camXCoarse) > 0x280) { this.deleteObject(); return; }
    this.displaySprite();
  }

  nudge() {
    const [sin] = this.game.calcSine(this.yOffset);
    this.y = s16(((sin * 0x400) >> 16) + this.yActual);
  }

  move() {
    const g = this.game, osc = (o) => g.oscByte(o);
    switch (this.subtype & 0xF) {
      case 1: this.x = s16(this.xOrigin + s8(this.angle - 0x40)); this.angle = osc(0x18); break;
      case 5: this.x = s16(this.xOrigin + s8(u8(-this.angle) + 0x40)); this.angle = osc(0x18); break;
      case 2: this.yActual = s16(this.yOrigin + s8(this.angle - 0x40)); this.angle = osc(0x18); break;
      case 6: this.yActual = s16(this.yOrigin + s8(u8(-this.angle) + 0x40)); this.angle = osc(0x18); break;
      case 0xC: this.yActual = s16(this.yOrigin + s8(osc(0xC) - 0x30)); this.angle = osc(0x18); break;
      case 0xD: this.yActual = s16(this.yOrigin + s8(u8(-osc(0xC)) + 0x30)); this.angle = osc(0x18); break;
      case 0xA: this.yActual = s16(this.yOrigin + (s8(this.angle - 0x40) >> 1)); this.angle = osc(0x18); break;
      case 0xB: this.yActual = s16(this.yOrigin + (s8(u8(-this.angle) + 0x40) >> 1)); this.angle = osc(0x18); break;
      case 3:
        if (!this.delay) { if (this.status & (P1_STANDING | P2_STANDING)) this.delay = 30; }
        else if (--this.delay === 0) { this.delay = 0x20; this.subtype++; }
        break;
      case 4: {
        if (this.delay) {
          if (--this.delay === 0) {
            if (this.status & P1_STANDING) {
              this.status &= ~P1_STANDING;
              const a1 = this.sonic;
              a1.status |= ST_AIR; a1.status &= ~ST_ONOBJ; a1.routine = 2; a1.y_vel = this.y_vel;
            }
            this.routine = 6;
          }
        }
        let f = ((this.yActual << 16) | this.yActualSub) + (this.y_vel << 8);
        this.yActual = f >> 16; this.yActualSub = f & 0xFFFF;
        this.y_vel = s16(this.y_vel + 0x38);
        if (!(u16(g.camMaxY + 224 + 0x40) >= u16(this.yActual))) this.routine = 4;
        break;
      }
      case 8:
        this.yActual -= 2;
        if (this.yActual === this.yOrigin - 0x200) this.subtype = 0;
        break;
    }
  }
}

// ------------------------------------------------------------------ Obj1C: decorados (poste del puente)
class Obj1C extends Obj {
  update() {
    if (this.routine === 0) {
      const rom = this.game.rom;
      this.routine = 2;
      const a = rom.o.Obj1C_InitData + this.subtype * 8;
      this.mapping_frame = rom.u8(a);
      this.mappings = rom.u32(a) & 0xFFFFFF;
      this.art_tile = rom.u16(a + 4);
      this.render_flags |= RF_LEVEL;
      this.width_pixels = rom.u8(a + 6);
      this.priority = rom.u8(a + 7);
    }
    this.markObjGone();
  }
}

// ------------------------------------------------------------------ Obj49: cascada
class Obj49 extends Obj {
  update() {
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = this.game.rom.o.Obj49_MapUnc_20C50;
      this.art_tile = ART.Waterfall | (1 << 13);
      this.render_flags = RF_LEVEL | RF_EXPLICIT_H | (this.render_flags & 3);
      this.width_pixels = 0x20; this.priority = 0; this.y_radius = 0x80;
    }
    if (u16((this.x & 0xFF80) - this.game.camXCoarse) > 0x280) { this.deleteObject(); return; }
    const d1 = u16(this.x - 0x40), d2 = u16(this.x + 0x40);
    const sx = u16(this.sonic.x);
    this.mapping_frame = 0;
    if (sx >= d1 && sx < d2) this.mapping_frame = 1;
    this.mapping_frame += this.subtype;
    this.displaySprite();
  }
}

const OBJ_CLASSES = { 0x03: Obj03, 0x11: Obj11, 0x18: Obj18, 0x1C: Obj1C, 0x49: Obj49 };

// ------------------------------------------------------------------ anillos del nivel
class RingManager {
  constructor(game) {
    this.game = game;
    const rom = game.rom;
    const rings = [];
    let a = rom.o.Rings_EHZ_1;
    for (;;) {
      const x = rom.u16(a);
      if (x & 0x8000) break;
      const w = rom.u16(a + 2); a += 4;
      const n = (w >> 12) & 7, y = w & 0xFFF;
      const col = (w & 0x8000) !== 0;
      for (let i = 0; i <= n; i++) rings.push({ x: col ? x : x + i * 0x18, y: col ? y + i * 0x18 : y, state: 0 });
    }
    // ordenación por X (estable, como el bucle de burbuja del original)
    rings.sort((p, q) => p.x - q.x);
    this.rings = rings;
    this.total = rings.length;
    this.perfect = rings.length;
    this.consuming = [];
    this.animFrame = 0; this.animCounter = 0;
    this.start = 0; this.end = 0;
    this.updateWindow();
  }

  updateWindow() {
    let d4 = this.game.camX - 8;
    if (d4 <= 0) d4 = 1;
    const r = this.rings;
    let s = 0; while (s < r.length && u16(r[s].x) < d4) s++;
    let e = s; const d5 = d4 + 320 + 16; while (e < r.length && u16(r[e].x) < d5) e++;
    this.start = s; this.end = e;
  }

  update() {
    for (let i = this.consuming.length - 1; i >= 0; i--) {
      const ring = this.consuming[i];
      if (--ring.timer === 0) {
        ring.timer = 6;
        if (++ring.frame === 8) { ring.state = -1; this.consuming.splice(i, 1); }
      }
    }
    this.updateWindow();
  }

  perfectLeft() { return this.perfect; }

  changeFrame() {
    if (--this.animCounter < 0) { this.animCounter = 7; this.animFrame = (this.animFrame + 1) & 3; }
  }

  touch(s) {
    if (this.start === this.end) return;
    if (s.invulnerable_time >= 0x5A) return;
    const d2 = s16(s.x - 8);
    let d5 = s8(s.y_radius) - 3;
    let d3 = s16(s.y - d5);
    if (s.mapping_frame === 0x4D) { d3 += 0xC; d5 = 0xA; }
    d5 *= 2;
    for (let i = this.start; i < this.end; i++) {
      const ring = this.rings[i];
      if (ring.state) continue;
      const dx = s16(ring.x - 6 - d2);
      if (dx < -12 || dx > 16) continue;
      const dy = s16(ring.y - 6 - d3);
      if (dy < -12 || dy > d5) continue;
      ring.state = 1; ring.timer = 6; ring.frame = 4;
      this.perfect--;
      this.consuming.push(ring);
      this.game.collectRing();
    }
  }

  // MapUnc_Rings: una sola pieza por frame, sin contador (y, tamaño, patrón, patrón 2P, x)
  piece(map, frame) {
    this.cache = this.cache || [];
    if (!this.cache[frame]) {
      const rom = this.game.rom;
      const a = map + rom.s16(map + frame * 2);
      this.cache[frame] = [{ y: rom.s8(a), size: rom.u8(a + 1), tile: rom.u16(a + 2), x: rom.s16(a + 6) }];
    }
    return this.cache[frame];
  }

  build() {
    const g = this.game, vdp = g.vdp;
    const camY = g.camY >> 16;
    const map = g.rom.o.MapUnc_Rings;
    for (let i = this.start; i < this.end; i++) {
      const ring = this.rings[i];
      if (ring.state < 0) continue;
      const sx = ring.x - g.camX;
      let sy = ((ring.y - camY) & 0x7FF) + 8;
      if (sy >= 224 + 16) continue;
      sy -= 8;
      const frame = ring.state ? ring.frame : this.animFrame;
      vdp.addSprite(this.piece(map, frame), sx, sy, ART.Ring | (1 << 13), 0);
    }
  }
}
