'use strict';
// Enemigos de EHZ: Buzzer (Obj4B), Masher (Obj5C), Coconuts (Obj9D) y su coco (Obj98).

// LoadSubObject: mappings, patrón, render_flags, prioridad, ancho y colisión desde SubObjData_Index
function loadSubObject(o) {
  const rom = o.game.rom, base = rom.o.SubObjData_Index;
  const a = base + rom.s16(base + o.subtype);
  o.mappings = rom.u32(a) & 0xFFFFFF;
  o.art_tile = rom.u16(a + 4);
  o.render_flags |= rom.u8(a + 6);
  o.priority = rom.u8(a + 7);
  o.width_pixels = rom.u8(a + 8);
  o.collision_flags = rom.u8(a + 9);
  o.routine += 2;
}

// ------------------------------------------------------------------ Obj4B: Buzzer
class Obj4B extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    switch (this.routine) {
      case 0: this.init(); break;
      case 2:
        if (this.routine_secondary === 0) this.roaming(); else this.shooting();
        this.animateSprite(rom.o.Ani_obj4B);
        this.markObjGone();
        break;
      case 4: this.flame(); break;
      case 6:
        objectMove(this);
        this.animateSprite(rom.o.Ani_obj4B);
        this.markObjGone();
        break;
    }
  }

  init() {
    const g = this.game;
    this.mappings = g.rom.o.Obj4B_MapUnc_2D2EA;
    this.art_tile = ART.Buzzer;
    this.render_flags |= RF_LEVEL;
    this.collision_flags = 0xA;
    this.width_pixels = 0x10; this.y_radius = 0x10; this.x_radius = 0x18;
    this.priority = 3;
    this.routine = 2;
    this.turn_delay = 0; this.move_timer = 0; this.shooting_flag = 0; this.shot_timer = 0;
    const f = g.allocObjectAfter(this, Obj4B);
    if (!f) return;
    f.id = 0x4B; f.routine = 4;
    f.mappings = this.mappings; f.art_tile = ART.Buzzer;
    f.priority = 4; f.width_pixels = 0x10;
    f.status = this.status; f.render_flags = this.render_flags;
    f.anim = 1;
    f.parentObj = this; f.parentSlot = this.slot;
    f.x = this.x; f.y = this.y;
    this.move_timer = 0x100;
    this.x_vel = -0x100;
    if (this.render_flags & 1) this.x_vel = 0x100;
  }

  flame() {
    const g = this.game;
    // el original solo comprueba que la ranura del padre no esté vacía
    const occ = g.slots[this.parentSlot];
    if (!occ) { this.deleteObject(); return; }
    const p = this.parentObj;
    if (p.turn_delay >= 0) return;
    this.x = occ.x; this.y = occ.y;
    this.status = p.status; this.render_flags = (this.render_flags & RF_ONSCREEN) | (p.render_flags & ~RF_ONSCREEN);
    this.animateSprite(g.rom.o.Ani_obj4B);
    this.markObjGone();
  }

  roaming() {
    this.chkPlayers();
    this.turn_delay = s16(this.turn_delay - 1);
    const d0 = this.turn_delay;
    if (d0 === 0xF) {
      this.shooting_flag = 0;
      this.x_vel = s16(-this.x_vel);
      this.render_flags ^= 1; this.status ^= 1;
      this.move_timer = 0x100;
      return;
    }
    if (d0 >= 0) return;
    this.move_timer = s16(this.move_timer - 1);
    if (this.move_timer > 0) { objectMove(this); return; }
    this.turn_delay = 0x1E;
  }

  chkPlayers() {
    if (this.shooting_flag) return;
    const a1 = this.sonic; // en frames impares el original apunta a Tails
    if (this.game.frame & 1) return;
    let d0 = s16(this.x - a1.x);
    const d1 = d0;
    if (d0 < 0) d0 = -d0;
    if (d0 < 0x28 || d0 > 0x30) return;
    if (d1 >= 0) { if (this.render_flags & 1) return; }
    else if (!(this.render_flags & 1)) return;
    this.shooting_flag = 0xFF;
    this.routine_secondary = 2;
    this.anim = 3;
    this.shot_timer = 0x32;
  }

  shooting() {
    let d0 = this.shot_timer - 1;
    if (d0 < 0) { this.routine_secondary = 0; return; }
    this.shot_timer = d0;
    if (d0 !== 0x14) return;
    const g = this.game;
    const p = g.allocObjectAfter(this, Obj4B);
    if (!p) return;
    p.id = 0x4B; p.routine = 6;
    p.mappings = this.mappings; p.art_tile = ART.Buzzer;
    p.priority = 4; p.collision_flags = 0x98; p.width_pixels = 0x10;
    p.status = this.status; p.render_flags = this.render_flags & ~RF_ONSCREEN;
    p.anim = 2;
    p.x = this.x; p.y = s16(this.y + 0x18);
    let off = 0xD;
    p.y_vel = 0x180; p.x_vel = -0x180;
    if (p.render_flags & 1) { p.x_vel = 0x180; off = -off; }
    p.x = s16(p.x + off);
  }
}

// ------------------------------------------------------------------ Obj5C: Masher
class Obj5C extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      this.mappings = g.rom.o.Obj5C_MapUnc_2D442;
      this.art_tile = ART.Masher;
      this.render_flags = RF_LEVEL | (this.render_flags & 3);
      this.priority = 4; this.collision_flags = 9; this.width_pixels = 0x10;
      this.y_vel = -0x400;
      this.initialY = this.y;
    }
    this.animateSprite(g.rom.o.Ani_obj5C);
    objectMove(this);
    this.y_vel = s16(this.y_vel + 0x18);
    let d0 = this.initialY;
    if (!(u16(d0) >= u16(this.y))) { this.y = d0; this.y_vel = -0x500; }
    this.anim = 1;
    d0 = u16(d0 - 0xC0);
    if (!(d0 >= u16(this.y))) {
      this.anim = 0;
      if (this.y_vel >= 0) this.anim = 2;
    }
    this.markObjGone();
  }
}

// ------------------------------------------------------------------ Obj9D: Coconuts
class Obj9D extends Obj {
  update() {
    const g = this.game, rom = g.rom;
    switch (this.routine) {
      case 0:
        loadSubObject(this);
        this.timer = 0x10; this.climb_index = 0; this.attack_timer = 0;
        return;
      case 2: {
        const d2 = s16(this.x - this.sonic.x);
        this.render_flags &= ~1; this.status &= ~1;
        if (d2 < 0) { this.render_flags |= 1; this.status |= 1; }
        if (u16(d2 + 0x60) < 0xC0) {
          if (!this.attack_timer) {
            this.routine = 6; this.mapping_frame = 1; this.timer = 8; this.attack_timer = 0x20;
            this.markObjGone(); return;
          }
          this.attack_timer--;
        }
        this.timer = u8(this.timer - 1);
        if (this.timer & 0x80) { this.routine = 4; this.setClimbingDirection(); }
        this.markObjGone();
        return;
      }
      case 4:
        this.timer = u8(this.timer - 1);
        if (this.timer === 0) { this.routine = 2; this.timer = 0x10; this.markObjGone(); return; }
        objectMove(this);
        this.animateSprite(rom.o.Ani_obj09);
        this.markObjGone();
        return;
      case 6:
        this.timer = u8(this.timer - 1);
        if (this.timer & 0x80) {
          if (this.routine_secondary === 0) {
            this.routine_secondary = 2; this.timer = 8; this.mapping_frame = 2;
            this.createCoconut();
          } else {
            this.routine_secondary = 0; this.routine = 4; this.timer = 8;
            this.setClimbingDirection();
          }
        }
        this.markObjGone();
        return;
    }
  }

  setClimbingDirection() {
    const rom = this.game.rom;
    let d0 = this.climb_index;
    if (d0 >= 0xC) d0 = 0;
    const a = rom.o.Obj9D_ClimbData + d0;
    this.climb_index = d0 + 2;
    this.y_vel = (rom.s8(a) << 8) | (this.y_vel & 0xFF); // move.b al byte alto de y_vel
    this.y_vel = s16(this.y_vel);
    this.timer = rom.u8(a + 1);
  }

  createCoconut() {
    const g = this.game, rom = g.rom;
    const c = g.allocObject(Obj98);
    if (!c) return;
    c.id = 0x98; c.mapping_frame = 3; c.subtype = 0x20;
    c.x = this.x; c.y = s16(this.y - 0xD);
    const a = rom.o.Obj9D_ThrowData + ((this.render_flags & 1) ? 0 : 4);
    c.x = s16(c.x + rom.s16(a));
    c.x_vel = rom.s16(a + 2);
    c.y_vel = -0x100;
  }
}

// ------------------------------------------------------------------ Obj98: proyectil (coco)
class Obj98 extends Obj {
  update() {
    if (this.routine === 0) { loadSubObject(this); return; }
    if (!(this.render_flags & RF_ONSCREEN)) { this.deleteObject(); return; }
    this.y_vel = s16(this.y_vel + 0x20);
    objectMove(this);
    this.markObjGone();
  }
}

Object.assign(OBJ_CLASSES, { 0x4B: Obj4B, 0x5C: Obj5C, 0x9D: Obj9D });
