'use strict';
// Objeto 01 - Sonic. Port directo de Obj01 de s2.asm.

// Bits de los mandos (Ctrl_1)
const BTN_UP = 1, BTN_DOWN = 2, BTN_LEFT = 4, BTN_RIGHT = 8, BTN_B = 0x10, BTN_C = 0x20, BTN_A = 0x40, BTN_START = 0x80;
const BTN_ABC = BTN_A | BTN_B | BTN_C;

// status (jugador)
const ST_XFLIP = 1, ST_AIR = 2, ST_ROLL = 4, ST_ONOBJ = 8, ST_ROLLJUMP = 0x10, ST_PUSH = 0x20, ST_UNDERWATER = 0x40;
// status_secondary
const ST2_SHIELD = 1, ST2_INVINC = 2, ST2_SHOES = 4, ST2_SLIDING = 0x80;

// IDs de animación de Sonic
const ANI = {
  Walk: 0, Run: 1, Roll: 2, Roll2: 3, Push: 4, Wait: 5, Balance: 6, LookUp: 7, Duck: 8, Spindash: 9,
  Blink: 0xA, GetUp: 0xB, Balance2: 0xC, Stop: 0xD, Float: 0xE, Float2: 0xF, Spring: 0x10, Hang: 0x11,
  Dash2: 0x12, Dash3: 0x13, Hang2: 0x14, Bubble: 0x15, DeathBW: 0x16, Drown: 0x17, Death: 0x18,
  Hurt: 0x19, Hurt2: 0x1A, Slide: 0x1B, Blank: 0x1C, Balance3: 0x1D, Balance4: 0x1E,
};

const SpindashSpeeds = [0x800, 0x880, 0x900, 0x980, 0xA00, 0xA80, 0xB00, 0xB80, 0xC00];

class GameObject {
  constructor() { this.reset(); }
  reset() {
    this.id = 0; this.routine = 0; this.routine_secondary = 0;
    this.x = 0; this.xs = 0; this.y = 0; this.ys = 0;
    this.x_vel = 0; this.y_vel = 0; this.inertia = 0;
    this.x_radius = 0; this.y_radius = 0;
    this.width_pixels = 0; this.priority = 0;
    this.render_flags = 0; this.status = 0;
    this.angle = 0; this.subtype = 0;
    this.art_tile = 0; this.mappings = null;
    this.mapping_frame = 0; this.anim = 0; this.prev_anim = 0;
    this.anim_frame = 0; this.anim_frame_duration = 0;
    this.collision_flags = 0; this.collision_property = 0;
    this.respawn_index = 0;
    this.onScreen = false;
    this.v = {}; // variables propias de cada objeto (objoff_XX)
  }
}

// Mueve un objeto según su velocidad (ObjectMove)
function objectMove(o) {
  let fx = ((o.x << 16) | o.xs) + (o.x_vel << 8);
  let fy = ((o.y << 16) | o.ys) + (o.y_vel << 8);
  o.x = fx >> 16; o.xs = fx & 0xFFFF;
  o.y = fy >> 16; o.ys = fy & 0xFFFF;
}

// ObjectMoveAndFall: igual pero añade gravedad ($38) después de usar la velocidad vieja
function objectMoveAndFall(o) {
  const yv = o.y_vel;
  o.y_vel = s16(o.y_vel + 0x38);
  let fx = ((o.x << 16) | o.xs) + (o.x_vel << 8);
  let fy = ((o.y << 16) | o.ys) + (yv << 8);
  o.x = fx >> 16; o.xs = fx & 0xFFFF;
  o.y = fy >> 16; o.ys = fy & 0xFFFF;
}

class Sonic extends GameObject {
  constructor(game) {
    super();
    this.game = game;
    this.id = 1;
  }

  get level() { return this.game.level; }

  init() {
    const g = this.game;
    this.routine = 2;
    this.y_radius = 0x13; this.x_radius = 9;
    this.priority = 2; this.width_pixels = 0x18;
    this.render_flags = 4;
    g.sonicTopSpeed = 0x600; g.sonicAccel = 0xC; g.sonicDecel = 0x80;
    this.art_tile = 0x780;
    this.top_solid_bit = 0xC; this.lrb_solid_bit = 0xD;
    this.status_secondary = 0;
    this.obj_control = 0; this.move_lock = 0; this.jumping = 0;
    this.spindash_flag = 0; this.spindash_counter = 0;
    this.stick_to_convex = 0; this.interact = null;
    this.flip_angle = 0; this.flip_turned = 0; this.flips_remaining = 0; this.flip_speed = 4;
    this.next_tilt = 0; this.tilt = 0;
    this.invulnerable_time = 0; this.invincibility_time = 0; this.speedshoes_time = 0;
    this.restart_countdown = 0;
    this.air_left = 30;
    this.lastDPLC = -1;
    g.posRecordIndex = 0;
    g.posRecordBuf.fill(0);
    // Obj01_Init_Continued rellena el buffer con la posición desplazada (-$20,+4)
    const sx = this.x, sy = this.y;
    this.x = s16(sx - 0x20); this.y = s16(sy + 4);
    for (let i = 0; i < 64; i++) { this.recordPos(); }
    this.x = sx; this.y = sy;
  }

  update() {
    switch (this.routine) {
      case 0: this.init(); this.control(); break;
      case 2: this.control(); break;
      case 4: this.hurt(); break;
      case 6: this.dead(); break;
      case 8: this.gone(); break;
    }
  }

  // Obj01_Control
  control() {
    const g = this.game;
    if (!g.controlLocked) { g.ctrlHeld = g.padHeld; g.ctrlPress = g.padPress; }
    if (!(this.obj_control & 1)) {
      switch (this.status & (ST_AIR | ST_ROLL)) {
        case 0: this.mdNormalChecks(); break;
        case ST_AIR: this.mdAir(); break;
        case ST_ROLL: this.mdRoll(); break;
        default: this.mdAir(); break; // Obj01_MdJump es idéntico a Obj01_MdAir
      }
    }
    this.display();
    this.recordPos();
    this.next_tilt = this.level.primaryAngle;
    this.tilt = this.level.secondaryAngle;
    this.animate();
    if (!(this.obj_control & 0x80)) g.touchResponse(this);
    this.loadDPLC();
  }

  display() {
    let visible = true;
    if (this.invulnerable_time) {
      const d0 = this.invulnerable_time;
      this.invulnerable_time--;
      if (!((d0 >> 2) & 1)) visible = false; // lsr.w #3 -> carry = bit 2
    }
    if (visible) this.game.displaySprite(this);
    if ((this.status_secondary & ST2_INVINC) && this.invincibility_time) {
      if (--this.invincibility_time === 0) {
        this.game.audio.restoreLevelMusic();
        this.status_secondary &= ~ST2_INVINC;
      }
    }
    if ((this.status_secondary & ST2_SHOES) && this.speedshoes_time) {
      if (--this.speedshoes_time === 0) {
        const g = this.game;
        g.sonicTopSpeed = 0x600; g.sonicAccel = 0xC; g.sonicDecel = 0x80;
        this.status_secondary &= ~ST2_SHOES;
        g.audio.setTempo(false);
      }
    }
  }

  recordPos() {
    const g = this.game;
    const i = g.posRecordIndex >> 1;
    g.posRecordBuf[i] = this.x & 0xFFFF;
    g.posRecordBuf[i + 1] = this.y & 0xFFFF;
    g.statRecordBuf[i] = g.ctrlHeld;
    g.statRecordBuf[i + 1] = this.status;
    g.posRecordIndex = (g.posRecordIndex + 4) & 0xFF;
  }

  // ------------------------------------------------------------------ modos
  mdNormalChecks() {
    const g = this.game;
    if (!(g.ctrlPress & BTN_ABC)) {
      if (this.anim === ANI.Blink || this.anim === ANI.GetUp) { return; }
      if (this.anim === ANI.Wait && this.anim_frame >= 0x1E) {
        if (!(g.ctrlHeld & 0x7F)) return;
        this.anim = ANI.Blink;
        if (this.anim_frame >= 0xAC) this.anim = ANI.GetUp;
        return;
      }
    }
    this.mdNormal();
  }

  mdNormal() {
    if (this.checkSpindash()) return;
    if (this.jump()) return;
    this.slopeResist();
    this.move();
    this.roll();
    this.levelBound();
    objectMove(this);
    this.anglePos();
    this.slopeRepel();
  }

  mdAir() {
    this.jumpHeight();
    this.chgJumpDir();
    this.levelBound();
    objectMoveAndFall(this);
    if (this.status & ST_UNDERWATER) this.y_vel = s16(this.y_vel - 0x28);
    this.jumpAngle();
    this.doLevelCollision();
  }

  mdRoll() {
    if (!this.spindash_flag) { if (this.jump()) return; }
    this.rollRepel();
    this.rollSpeed();
    this.levelBound();
    objectMove(this);
    this.anglePos();
    this.slopeRepel();
  }

  // ------------------------------------------------------------------ Sonic_Move
  move() {
    const g = this.game;
    const d6 = g.sonicTopSpeed, d5 = g.sonicAccel, d4 = g.sonicDecel;
    if (this.status_secondary & ST2_SLIDING) { this.traction(); return; }
    if (this.move_lock) { this.resetScr(d5); return; }
    if (g.ctrlHeld & BTN_LEFT) this.moveLeft(d4, d5, d6);
    if (g.ctrlHeld & BTN_RIGHT) this.moveRight(d4, d5, d6);
    if ((u8(this.angle + 0x20) & 0xC0) || this.inertia) { this.resetScr(d5); return; }
    this.status &= ~ST_PUSH;
    this.anim = ANI.Wait;
    if (this.status & ST_ONOBJ) {
      const a1 = this.interact;
      if (a1 && (a1.status & 0x80)) { this.lookup(d5); return; }
      if (a1) {
        let d1 = a1.width_pixels;
        let d2 = d1 * 2 - 2;
        d1 = s16(d1 + this.x - a1.x);
        if (d1 < 2) {
          // borde izquierdo del objeto
          if (this.status & ST_XFLIP) {
            this.anim = ANI.Balance;
            if (d1 < -4) this.anim = ANI.Balance2;
          } else {
            this.anim = ANI.Balance3;
            if (d1 < -4) { this.anim = ANI.Balance4; this.status |= ST_XFLIP; }
          }
          this.resetScr(d5); return;
        } else if (d1 >= d2) {
          if (!(this.status & ST_XFLIP)) {
            this.anim = ANI.Balance;
            if (d1 >= d2 + 6) this.anim = ANI.Balance2;
          } else {
            this.anim = ANI.Balance3;
            if (d1 >= d2 + 6) { this.anim = ANI.Balance4; this.status &= ~ST_XFLIP; }
          }
          this.resetScr(d5); return;
        }
        this.lookup(d5); return;
      }
    }
    // Sonic_Balance (borde de terreno)
    if (this.chkFloorEdge(this.x) >= 0xC) {
      if (this.next_tilt === 3) {
        if (!(this.status & ST_XFLIP)) {
          this.anim = ANI.Balance;
          if (this.chkFloorEdge(s16(this.x - 6)) >= 0xC) this.anim = ANI.Balance2;
        } else {
          this.anim = ANI.Balance3;
          if (this.chkFloorEdge(s16(this.x - 6)) >= 0xC) { this.anim = ANI.Balance4; this.status &= ~ST_XFLIP; }
        }
        this.resetScr(d5); return;
      }
      if (this.tilt === 3) {
        if (this.status & ST_XFLIP) {
          this.anim = ANI.Balance;
          if (this.chkFloorEdge(s16(this.x + 6)) >= 0xC) this.anim = ANI.Balance2;
        } else {
          this.anim = ANI.Balance3;
          if (this.chkFloorEdge(s16(this.x + 6)) >= 0xC) { this.anim = ANI.Balance4; this.status |= ST_XFLIP; }
        }
        this.resetScr(d5); return;
      }
    }
    this.lookup(d5);
  }

  lookup(d5) {
    const g = this.game;
    if (g.ctrlHeld & BTN_UP) {
      this.anim = ANI.LookUp;
      if (++g.lookDelay < 0x78) { this.resetScrPart2(d5); return; }
      g.lookDelay = 0x78;
      if (g.camYBias !== 0xC8) g.camYBias += 2;
      this.updateSpeedOnGround(d5); return;
    }
    if (g.ctrlHeld & BTN_DOWN) {
      this.anim = ANI.Duck;
      if (++g.lookDelay < 0x78) { this.resetScrPart2(d5); return; }
      g.lookDelay = 0x78;
      if (g.camYBias !== 8) g.camYBias -= 2;
      this.updateSpeedOnGround(d5); return;
    }
    this.resetScr(d5);
  }

  resetScr(d5) { this.game.lookDelay = 0; this.resetScrPart2(d5); }
  resetScrPart2(d5) {
    this.game.resetCamBias();
    this.updateSpeedOnGround(d5);
  }

  updateSpeedOnGround(d5) {
    const g = this.game;
    if (!(g.ctrlHeld & (BTN_LEFT | BTN_RIGHT))) {
      let d0 = this.inertia;
      if (d0 > 0) { d0 -= d5; if (d0 < 0) d0 = 0; this.inertia = d0; }
      else if (d0 < 0) { d0 += d5; if (d0 >= 0) d0 = 0; this.inertia = d0; }
    }
    this.traction();
  }

  traction() {
    const [sin, cos] = this.game.calcSine(this.angle);
    this.x_vel = s16((cos * this.inertia) >> 8);
    this.y_vel = s16((sin * this.inertia) >> 8);
    this.checkWallsOnGround();
  }

  checkWallsOnGround() {
    if (u8(this.angle + 0x40) & 0x80) return;
    if (!this.inertia) return;
    const d1 = this.inertia < 0 ? 0x40 : 0xC0; // $40 o -$40
    const d0 = u8(this.angle + d1);
    let dist = this.calcRoomInFront(d0);
    if (dist >= 0) return;
    dist = s16(dist << 8);
    switch (u8(d0 + 0x20) & 0xC0) {
      case 0x00: this.y_vel = s16(this.y_vel + dist); break;
      case 0x40: this.x_vel = s16(this.x_vel - dist); this.status |= ST_PUSH; this.inertia = 0; break;
      case 0x80: this.y_vel = s16(this.y_vel - dist); break;
      case 0xC0: this.x_vel = s16(this.x_vel + dist); this.status |= ST_PUSH; this.inertia = 0; break;
    }
  }

  moveLeft(d4, d5, d6) {
    let d0 = this.inertia;
    if (d0 > 0) { // Sonic_TurnLeft
      d0 -= d4;
      if (d0 < 0) d0 = -0x80;
      this.inertia = d0;
      // bug original: el ángulo sobrescribe el byte bajo de d0
      const a = u8(this.angle + 0x20) & 0xC0;
      if (a) return;
      if (s16((d0 & 0xFF00) | a) < 0x400) return;
      this.skid(false);
      return;
    }
    if (!(this.status & ST_XFLIP)) {
      this.status |= ST_XFLIP;
      this.status &= ~ST_PUSH;
      this.prev_anim = ANI.Run;
    }
    d0 -= d5;
    const d1 = -d6;
    if (d0 <= d1) { d0 += d5; if (d0 > d1) d0 = d1; }
    this.inertia = s16(d0);
    this.anim = ANI.Walk;
  }

  moveRight(d4, d5, d6) {
    let d0 = this.inertia;
    if (d0 < 0) { // Sonic_TurnRight
      d0 += d4;
      if (d0 >= 0) d0 = 0x80;
      this.inertia = d0;
      const a = u8(this.angle + 0x20) & 0xC0;
      if (a) return;
      if (s16((d0 & 0xFF00) | a) > -0x400) return;
      this.skid(true);
      return;
    }
    if (this.status & ST_XFLIP) {
      this.status &= ~ST_XFLIP;
      this.status &= ~ST_PUSH;
      this.prev_anim = ANI.Run;
    }
    d0 += d5;
    if (d0 >= d6) { d0 -= d5; if (d0 < d6) d0 = d6; }
    this.inertia = s16(d0);
    this.anim = ANI.Walk;
  }

  skid(faceLeft) {
    this.anim = ANI.Stop;
    if (faceLeft) this.status |= ST_XFLIP; else this.status &= ~ST_XFLIP;
    this.game.audio.sfx('Skidding');
    if (this.air_left >= 12) this.game.dust.startSkid();
  }

  // ------------------------------------------------------------------ rodar
  rollSpeed() {
    const g = this.game;
    const d6 = g.sonicTopSpeed * 2;
    const d5 = g.sonicAccel >> 1;
    const d4 = 0x20;
    if (!(this.status_secondary & ST2_SLIDING)) {
      if (!this.move_lock) {
        if (g.ctrlHeld & BTN_LEFT) this.rollLeft(d4);
        if (g.ctrlHeld & BTN_RIGHT) this.rollRight(d4);
      }
      let d0 = this.inertia;
      if (d0 > 0) { d0 -= d5; if (d0 < 0) d0 = 0; this.inertia = d0; }
      else if (d0 < 0) { d0 += d5; if (d0 >= 0) d0 = 0; this.inertia = d0; }
      if (this.inertia === 0) {
        if (this.spindash_flag) {
          this.inertia = (this.status & ST_XFLIP) ? -0x400 : 0x400;
        } else {
          this.status &= ~ST_ROLL;
          this.y_radius = 0x13; this.x_radius = 9;
          this.anim = ANI.Wait;
          this.y = s16(this.y - 5);
        }
      }
    }
    g.resetCamBias();
    const [sin, cos] = g.calcSine(this.angle);
    this.y_vel = s16((sin * this.inertia) >> 8);
    let d1 = (cos * this.inertia) >> 8;
    if (d1 > 0x1000) d1 = 0x1000;
    if (d1 < -0x1000) d1 = -0x1000;
    this.x_vel = s16(d1);
    this.checkWallsOnGround();
  }

  rollLeft(d4) {
    let d0 = this.inertia;
    if (d0 > 0) { d0 -= d4; if (d0 < 0) d0 = -0x80; this.inertia = d0; return; }
    this.status |= ST_XFLIP;
    this.anim = ANI.Roll;
  }

  rollRight(d4) {
    let d0 = this.inertia;
    if (d0 < 0) { d0 += d4; if (d0 >= 0) d0 = 0x80; this.inertia = d0; return; }
    this.status &= ~ST_XFLIP;
    this.anim = ANI.Roll;
  }

  // ------------------------------------------------------------------ aire
  chgJumpDir() {
    const g = this.game;
    const d6 = g.sonicTopSpeed, d5 = g.sonicAccel * 2;
    if (!(this.status & ST_ROLLJUMP)) {
      let d0 = this.x_vel;
      if (g.ctrlHeld & BTN_LEFT) {
        this.status |= ST_XFLIP;
        d0 -= d5;
        if (d0 <= -d6) d0 = -d6;
      }
      if (g.ctrlHeld & BTN_RIGHT) {
        this.status &= ~ST_XFLIP;
        d0 += d5;
        if (d0 >= d6) d0 = d6;
      }
      this.x_vel = s16(d0);
    }
    g.resetCamBias();
    // Sonic_JumpPeakDecelerate
    if (u16(this.y_vel) < u16(-0x400)) return; // blo (sin signo)
    let d0 = this.x_vel;
    const d1 = d0 >> 5;
    if (d1 === 0) return;
    if (d1 > 0) { d0 -= d1; if (d0 < 0) d0 = 0; }
    else { d0 -= d1; if (d0 >= 0) d0 = 0; }
    this.x_vel = s16(d0);
  }

  levelBound() {
    const g = this.game;
    const d1 = u16((((this.x << 16) | this.xs) + (this.x_vel << 8)) >> 16);
    let d0 = u16(g.camMinX + 0x10);
    let hit = false;
    if (d0 > d1) hit = true;
    else {
      d0 = u16(g.camMaxX + 320 - 24 + (g.bossActive ? 0 : 0x40));
      if (d0 <= d1) hit = true;
    }
    if (hit) {
      this.x = s16(d0); this.xs = 0; this.x_vel = 0; this.inertia = 0;
    }
    if (s16(g.camMaxY + 224) < this.y) g.killCharacter(this);
  }

  roll() {
    if (this.status_secondary & ST2_SLIDING) return;
    if (Math.abs(this.inertia) < 0x80) return;
    const g = this.game;
    if (g.ctrlHeld & (BTN_LEFT | BTN_RIGHT)) return;
    if (!(g.ctrlHeld & BTN_DOWN)) return;
    if (this.status & ST_ROLL) return;
    this.status |= ST_ROLL;
    this.y_radius = 0xE; this.x_radius = 7;
    this.anim = ANI.Roll;
    this.y = s16(this.y + 5);
    g.audio.sfx('Roll');
    if (this.inertia === 0) this.inertia = 0x200;
  }

  // devuelve true si hay que abandonar la rutina del modo (addq.l #4,sp)
  jump() {
    const g = this.game;
    if (!(g.ctrlPress & BTN_ABC)) return false;
    if (this.calcRoomOverHead(u8(this.angle + 0x80)) < 6) return false;
    let d2 = 0x680;
    if (this.status & ST_UNDERWATER) d2 = 0x380;
    const [sin, cos] = g.calcSine(u8(this.angle - 0x40));
    this.x_vel = s16(this.x_vel + ((cos * d2) >> 8));
    this.y_vel = s16(this.y_vel + ((sin * d2) >> 8));
    this.status |= ST_AIR;
    this.status &= ~ST_PUSH;
    this.jumping = 1;
    this.stick_to_convex = 0;
    g.audio.sfx('Jump');
    this.y_radius = 0x13; this.x_radius = 9;
    if (this.status & ST_ROLL) {
      this.status |= ST_ROLLJUMP;
    } else {
      this.y_radius = 0xE; this.x_radius = 7;
      this.anim = ANI.Roll;
      this.status |= ST_ROLL;
      this.y = s16(this.y + 5);
    }
    return true;
  }

  jumpHeight() {
    const g = this.game;
    if (this.jumping) {
      const d1 = (this.status & ST_UNDERWATER) ? -0x200 : -0x400;
      if (d1 > this.y_vel && !(g.ctrlHeld & BTN_ABC)) this.y_vel = d1;
      return;
    }
    if (this.spindash_flag) return;
    if (this.y_vel < -0xFC0) this.y_vel = -0xFC0;
  }

  // ------------------------------------------------------------------ spindash
  checkSpindash() {
    const g = this.game;
    if (this.spindash_flag) return this.updateSpindash();
    if (this.anim !== ANI.Duck) return false;
    if (!(g.ctrlPress & BTN_ABC)) return false;
    this.anim = ANI.Spindash;
    g.audio.sfx('SpindashRev');
    this.spindash_flag = 1;
    this.spindash_counter = 0;
    if (this.air_left >= 12) g.dust.startSpindash();
    this.levelBound();
    this.anglePos();
    return true;
  }

  updateSpindash() {
    const g = this.game;
    if (!(g.ctrlHeld & BTN_DOWN)) {
      this.y_radius = 0xE; this.x_radius = 7;
      this.anim = ANI.Roll;
      this.y = s16(this.y + 5);
      this.spindash_flag = 0;
      this.inertia = SpindashSpeeds[(this.spindash_counter >> 8) & 0xFF] | 0;
      // retraso de cámara
      let d0 = this.inertia - 0x800;
      d0 = (d0 * 2) & 0x1F00;
      g.horizScrollDelay = u16(-d0 + 0x2000);
      if (this.status & ST_XFLIP) this.inertia = s16(-this.inertia);
      this.status |= ST_ROLL;
      g.dust.stopSpindash();
      g.audio.sfx('SpindashRelease');
    } else {
      if (this.spindash_counter) {
        const d0 = this.spindash_counter >> 5;
        this.spindash_counter -= d0;
        if (this.spindash_counter < 0) this.spindash_counter = 0;
      }
      if (g.ctrlPress & BTN_ABC) {
        this.anim = ANI.Spindash; this.prev_anim = ANI.Walk;
        g.audio.sfx('SpindashRev');
        this.spindash_counter += 0x200;
        if (this.spindash_counter >= 0x800) this.spindash_counter = 0x800;
      }
    }
    g.resetCamBias();
    this.levelBound();
    this.anglePos();
    return true;
  }

  // ------------------------------------------------------------------ pendientes
  slopeResist() {
    if (u8(this.angle + 0x60) >= 0xC0) return;
    const [sin] = this.game.calcSine(this.angle);
    const d0 = (sin * 0x20) >> 8;
    if (!this.inertia) return;
    this.inertia = s16(this.inertia + d0);
  }

  rollRepel() {
    if (u8(this.angle + 0x60) >= 0xC0) return;
    const [sin] = this.game.calcSine(this.angle);
    let d0 = (sin * 0x50) >> 8;
    if (this.inertia >= 0) { if (d0 < 0) d0 >>= 2; }
    else { if (d0 >= 0) d0 >>= 2; }
    this.inertia = s16(this.inertia + d0);
  }

  slopeRepel() {
    if (this.stick_to_convex) return;
    if (this.move_lock) { this.move_lock--; return; }
    if (!(u8(this.angle + 0x20) & 0xC0)) return;
    if (Math.abs(this.inertia) >= 0x280) return;
    this.inertia = 0;
    this.status |= ST_AIR;
    this.move_lock = 0x1E;
  }

  jumpAngle() {
    let d0 = this.angle;
    if (d0 !== 0) {
      if (d0 & 0x80) { d0 += 2; if (d0 > 0xFF) d0 = 0; }
      else { d0 -= 2; if (d0 < 0) d0 = 0; }
      this.angle = d0;
    }
    // Sonic_JumpFlip
    d0 = this.flip_angle;
    if (!d0) return;
    if (this.inertia < 0 && !this.flip_turned) {
      d0 -= this.flip_speed;
      if (d0 < 0) { d0 &= 0xFF; if (--this.flips_remaining < 0) { this.flips_remaining = 0; d0 = 0; } }
    } else {
      d0 += this.flip_speed;
      if (d0 > 0xFF) { d0 &= 0xFF; if (--this.flips_remaining < 0) { this.flips_remaining = 0; d0 = 0; } }
    }
    this.flip_angle = d0;
  }

  // ------------------------------------------------------------------ colisión aire
  doLevelCollision() {
    const L = this.level;
    L.colAddr = this.top_solid_bit === 0xC ? L.colP : L.colS;
    const quad = u8(this.game.calcAngle(this.x_vel, this.y_vel) - 0x20) & 0xC0;
    if (quad === 0x40) return this.hitLeftWall();
    if (quad === 0x80) return this.hitCeilingAndWalls();
    if (quad === 0xC0) return this.hitRightWall();
    let r = this.checkLeftWallDist();
    if (r.d1 < 0) { this.x = s16(this.x - r.d1); this.x_vel = 0; }
    r = this.checkRightWallDist();
    if (r.d1 < 0) { this.x = s16(this.x + r.d1); this.x_vel = 0; }
    r = this.checkFloor();
    if (r.d1 >= 0) return;
    const d2 = s8(-(u8(u8(this.y_vel >> 8) + 8)));
    if (!(s8(r.d1) >= d2) && s8(r.d0) < d2) return;
    this.y = s16(this.y + r.d1);
    this.angle = r.d3;
    this.resetOnFloor();
    if (u8(r.d3 + 0x20) & 0x40) {
      this.x_vel = 0;
      if (this.y_vel > 0xFC0) this.y_vel = 0xFC0;
    } else if (u8(r.d3 + 0x10) & 0x20) {
      this.y_vel >>= 1;
    } else {
      this.y_vel = 0;
      this.inertia = this.x_vel;
      return;
    }
    this.inertia = this.y_vel;
    if (r.d3 & 0x80) this.inertia = s16(-this.inertia);
  }

  hitLeftWall() {
    const r = this.checkLeftWallDist();
    if (r.d1 < 0) {
      this.x = s16(this.x - r.d1); this.x_vel = 0; this.inertia = this.y_vel;
      return;
    }
    this.hitCeiling();
  }

  hitCeiling() {
    const r = this.checkCeiling();
    if (r.d1 < 0) {
      this.y = s16(this.y - r.d1);
      if (this.y_vel < 0) this.y_vel = 0;
      return;
    }
    this.hitFloor();
  }

  hitFloor() {
    if (this.y_vel < 0) return;
    const r = this.checkFloor();
    if (r.d1 >= 0) return;
    this.y = s16(this.y + r.d1);
    this.angle = r.d3;
    this.resetOnFloor();
    this.y_vel = 0;
    this.inertia = this.x_vel;
  }

  hitCeilingAndWalls() {
    let r = this.checkLeftWallDist();
    if (r.d1 < 0) { this.x = s16(this.x - r.d1); this.x_vel = 0; }
    r = this.checkRightWallDist();
    if (r.d1 < 0) { this.x = s16(this.x + r.d1); this.x_vel = 0; }
    r = this.checkCeiling();
    if (r.d1 >= 0) return;
    this.y = s16(this.y - r.d1);
    if (!(u8(r.d3 + 0x20) & 0x40)) { this.y_vel = 0; return; }
    this.angle = r.d3;
    this.resetOnFloor();
    this.inertia = this.y_vel;
    if (r.d3 & 0x80) this.inertia = s16(-this.inertia);
  }

  hitRightWall() {
    const r = this.checkRightWallDist();
    if (r.d1 < 0) {
      this.x = s16(this.x + r.d1); this.x_vel = 0; this.inertia = this.y_vel;
      return;
    }
    this.hitCeiling();
  }

  resetOnFloor() {
    if (!this.spindash_flag) {
      this.anim = ANI.Walk;
      this.resetOnFloorPart2();
      return;
    }
    this.resetOnFloorPart3();
  }

  resetOnFloorPart2() {
    if (this.status & ST_ROLL) {
      this.status &= ~ST_ROLL;
      this.y_radius = 0x13; this.x_radius = 9;
      this.anim = ANI.Walk;
      this.y = s16(this.y - 5);
    }
    this.resetOnFloorPart3();
  }

  resetOnFloorPart3() {
    this.status &= ~(ST_AIR | ST_PUSH | ST_ROLLJUMP);
    this.jumping = 0;
    this.game.chainBonus = 0;
    this.flip_angle = 0; this.flip_turned = 0; this.flips_remaining = 0;
    this.game.lookDelay = 0;
    if (this.anim === ANI.Hang2) this.anim = ANI.Walk;
  }

  // ------------------------------------------------------------------ daño / muerte
  hurt() {
    objectMove(this);
    this.y_vel = s16(this.y_vel + 0x30);
    if (this.status & ST_UNDERWATER) this.y_vel = s16(this.y_vel - 0x20);
    this.hurtStop();
    this.levelBound();
    this.recordPos();
    this.animate();
    this.loadDPLC();
    this.game.displaySprite(this);
  }

  hurtStop() {
    const g = this.game;
    if (s16(g.camMaxY + 224) < this.y) { g.killCharacter(this); return; }
    this.doLevelCollision();
    if (this.status & ST_AIR) return;
    this.y_vel = 0; this.x_vel = 0; this.inertia = 0;
    this.obj_control = 0;
    this.anim = ANI.Walk;
    this.routine = 2;
    this.invulnerable_time = 0x78;
    this.spindash_flag = 0;
  }

  dead() {
    const g = this.game;
    // CheckGameOver
    g.scrollLock = true;
    this.spindash_flag = 0;
    if (s16(g.camMaxY + 0x100) < this.y) {
      this.routine = 8;
      this.restart_countdown = 60;
      g.lives--;
      if (g.lives <= 0) {
        this.restart_countdown = 0;
        g.gameOver();
      } else if (g.timeOver) {
        this.restart_countdown = 0;
        g.showTimeOver();
      }
    }
    objectMoveAndFall(this);
    this.recordPos();
    this.animate();
    this.loadDPLC();
    g.displaySprite(this);
  }

  gone() {
    if (this.restart_countdown) {
      if (--this.restart_countdown === 0) this.game.levelInactive = true;
    }
  }

  // ------------------------------------------------------------------ animación
  animate() {
    const rom = this.game.rom;
    const base = rom.o.SonicAniData;
    let d0 = this.anim;
    if (d0 !== this.prev_anim) {
      this.prev_anim = d0;
      this.anim_frame = 0;
      this.anim_frame_duration = 0;
      this.status &= ~ST_PUSH;
    }
    let a1 = base + rom.s16(base + d0 * 2);
    const first = rom.u8(a1);
    if (!(first & 0x80)) {
      this.render_flags = (this.render_flags & ~3) | (this.status & ST_XFLIP);
      this.anim_frame_duration = u8(this.anim_frame_duration - 1);
      if (!(this.anim_frame_duration & 0x80)) return;
      this.anim_frame_duration = first;
      this.animDo2(a1);
      return;
    }
    // SAnim_WalkRun
    if (first === 0xFF) {
      if (this.flip_angle) { this.animTumble(); return; }
      let ang = this.angle;
      if (ang !== 0 && !(ang & 0x80)) ang = ang - 1;
      let d2 = this.status & ST_XFLIP;
      if (!d2) ang = u8(~ang);
      ang = u8(ang + 0x10);
      let d1 = 0;
      if (ang & 0x80) d1 = 3;
      this.render_flags = (this.render_flags & ~3) | (d2 ^ d1);
      if (this.status & ST_PUSH) { this.animPush(); return; }
      let q = (ang >> 4) & 6;
      let spd = Math.abs(this.inertia);
      if (this.status_secondary & ST2_SLIDING) spd *= 2;
      let script;
      if (spd >= 0x600) script = base + rom.s16(base + ANI.Run * 2);
      else { script = base + rom.s16(base + ANI.Walk * 2); q *= 2; }
      q = u8(q * 2);
      let f = rom.u8(script + 1 + this.anim_frame);
      if (f === 0xFF) { this.anim_frame = 0; f = rom.u8(script + 1); }
      this.mapping_frame = u8(f + q);
      this.anim_frame_duration = u8(this.anim_frame_duration - 1);
      if (!(this.anim_frame_duration & 0x80)) return;
      let dur = -spd + 0x800;
      if (dur < 0) dur = 0;
      this.anim_frame_duration = (dur >> 8) & 0xFF;
      this.anim_frame = u8(this.anim_frame + 1);
      return;
    }
    // SAnim_Roll
    this.anim_frame_duration = u8(this.anim_frame_duration - 1);
    if (!(this.anim_frame_duration & 0x80)) return;
    if (first === 0xFE) {
      const spd = Math.abs(this.inertia);
      const script = base + rom.s16(base + (spd >= 0x600 ? ANI.Roll2 : ANI.Roll) * 2);
      let dur = -spd + 0x400;
      if (dur < 0) dur = 0;
      this.anim_frame_duration = (dur >> 8) & 0xFF;
      this.render_flags = (this.render_flags & ~3) | (this.status & ST_XFLIP);
      this.animDo2(script);
      return;
    }
    this.animPush();
  }

  animPush() {
    const rom = this.game.rom, base = rom.o.SonicAniData;
    this.anim_frame_duration = u8(this.anim_frame_duration - 1);
    if (!(this.anim_frame_duration & 0x80)) return;
    let d2 = this.inertia;
    if (d2 >= 0) d2 = -d2;
    d2 += 0x800;
    if (d2 < 0) d2 = 0;
    this.anim_frame_duration = (d2 >> 6) & 0xFF;
    this.render_flags = (this.render_flags & ~3) | (this.status & ST_XFLIP);
    this.animDo2(base + rom.s16(base + ANI.Push * 2));
  }

  animDo2(a1) {
    const rom = this.game.rom;
    const d1 = this.anim_frame;
    let d0 = rom.u8(a1 + 1 + d1);
    if (d0 >= 0xF0) {
      if (d0 === 0xFF) { this.anim_frame = 0; d0 = rom.u8(a1 + 1); }
      else if (d0 === 0xFE) {
        const back = rom.u8(a1 + 2 + d1);
        this.anim_frame = u8(this.anim_frame - back);
        d0 = rom.u8(a1 + 1 + u8(d1 - back));
      } else if (d0 === 0xFD) { this.anim = rom.u8(a1 + 2 + d1); return; }
      else return;
    }
    this.mapping_frame = d0;
    this.anim_frame = u8(this.anim_frame + 1);
  }

  animTumble() {
    let d0 = this.flip_angle;
    this.render_flags &= ~3;
    if (!(this.status & ST_XFLIP)) {
      d0 = d0 + 0xB;
    } else if (this.flip_turned) {
      this.render_flags |= 1;
      d0 = d0 + 0xB;
    } else {
      this.render_flags |= 3;
      d0 = u8(-d0) + 0x8F;
    }
    d0 &= 0xFF;
    this.mapping_frame = u8(Math.floor(d0 / 0x16) + 0x5F);
    this.anim_frame_duration = 0;
  }

  // LoadSonicDynPLC: copia a VRAM ($780) los patrones del frame actual
  loadDPLC() {
    const f = this.mapping_frame;
    if (f === this.lastDPLC) return;
    this.lastDPLC = f;
    const rom = this.game.rom, vdp = this.game.vdp;
    const base = rom.o.MapRUnc_Sonic;
    let a2 = base + rom.s16(base + f * 2);
    let n = rom.u16(a2); a2 += 2;
    let dst = 0x780;
    const art = rom.o.ArtUnc_Sonic;
    for (let i = 0; i < n; i++) {
      const w = rom.u16(a2); a2 += 2;
      const cnt = ((w >> 12) & 0xF) + 1;
      const src = art + (w & 0xFFF) * 32;
      vdp.loadTiles(rom.b.subarray(src, src + cnt * 32), dst);
      dst += cnt;
    }
  }

  // ------------------------------------------------------------------ colisión (sensores)
  setCol() { const L = this.level; L.colAddr = this.top_solid_bit === 0xC ? L.colP : L.colS; }

  anglePos() {
    const L = this.level;
    this.setCol();
    const d5 = this.top_solid_bit;
    if (this.status & ST_ONOBJ) { L.primaryAngle = 0; L.secondaryAngle = 0; return; }
    L.primaryAngle = 3; L.secondaryAngle = 3;
    let d0;
    if (!(u8(this.angle + 0x20) & 0x80)) {
      d0 = this.angle;
      if (d0 & 0x80) d0 = u8(d0 + 1);
      d0 = u8(d0 + 0x1F);
    } else {
      d0 = this.angle;
      if (d0 & 0x80) d0 = u8(d0 - 1);
      d0 = u8(d0 + 0x20);
    }
    d0 &= 0xC0;
    const yr = s8(this.y_radius), xr = s8(this.x_radius);
    if (d0 === 0x40) return this.walkVertL(d5, yr, xr);
    if (d0 === 0x80) return this.walkCeiling(d5, yr, xr);
    if (d0 === 0xC0) return this.walkVertR(d5, yr, xr);
    L.a4 = 0;
    const r0 = L.findFloor(s16(this.y + yr), s16(this.x + xr), d5, 0, 0x10);
    L.a4 = 1;
    const r1 = L.findFloor(s16(this.y + yr), s16(this.x - xr), d5, 0, 0x10);
    const d1 = this.sonicAngle(r0, r1);
    if (d1 === 0) return;
    if (d1 < 0) { if (d1 >= -0xE) this.y = s16(this.y + d1); return; }
    let lim = Math.min(u8(Math.abs(s8(this.x_vel >> 8)) + 4), 0xE);
    if (s8(d1) > lim && !this.stick_to_convex) { this.leaveGround(); return; }
    this.y = s16(this.y + d1);
  }

  walkVertR(d5, yr, xr) {
    const L = this.level;
    L.a4 = 0;
    const r0 = L.findWall(s16(this.y - xr), s16(this.x + yr), d5, 0, 0x10);
    L.a4 = 1;
    const r1 = L.findWall(s16(this.y + xr), s16(this.x + yr), d5, 0, 0x10);
    const d1 = this.sonicAngle(r0, r1);
    if (d1 === 0) return;
    if (d1 < 0) { if (d1 >= -0xE) this.x = s16(this.x + d1); return; }
    let lim = Math.min(u8(Math.abs(s8(this.y_vel >> 8)) + 4), 0xE);
    if (s8(d1) > lim && !this.stick_to_convex) { this.leaveGround(); return; }
    this.x = s16(this.x + d1);
  }

  walkCeiling(d5, yr, xr) {
    const L = this.level;
    L.a4 = 0;
    const r0 = L.findFloor(s16(this.y - yr) ^ 0xF, s16(this.x + xr), d5, 0x800, -0x10);
    L.a4 = 1;
    const r1 = L.findFloor(s16(this.y - yr) ^ 0xF, s16(this.x - xr), d5, 0x800, -0x10);
    const d1 = this.sonicAngle(r0, r1);
    if (d1 === 0) return;
    if (d1 < 0) { if (d1 >= -0xE) this.y = s16(this.y - d1); return; }
    let lim = Math.min(u8(Math.abs(s8(this.x_vel >> 8)) + 4), 0xE);
    if (s8(d1) > lim && !this.stick_to_convex) { this.leaveGround(); return; }
    this.y = s16(this.y - d1);
  }

  walkVertL(d5, yr, xr) {
    const L = this.level;
    L.a4 = 0;
    const r0 = L.findWall(s16(this.y - xr), s16(this.x - yr) ^ 0xF, d5, 0x400, -0x10);
    L.a4 = 1;
    const r1 = L.findWall(s16(this.y + xr), s16(this.x - yr) ^ 0xF, d5, 0x400, -0x10);
    const d1 = this.sonicAngle(r0, r1);
    if (d1 === 0) return;
    if (d1 < 0) { if (d1 >= -0xE) this.x = s16(this.x - d1); return; }
    let lim = Math.min(u8(Math.abs(s8(this.y_vel >> 8)) + 4), 0xE);
    if (s8(d1) > lim && !this.stick_to_convex) { this.leaveGround(); return; }
    this.x = s16(this.x - d1);
  }

  leaveGround() {
    this.status |= ST_AIR;
    this.status &= ~ST_PUSH;
    this.prev_anim = ANI.Run;
  }

  // Sonic_Angle: d0 = distancia sensor primario, d1 = secundario; devuelve la menor
  sonicAngle(d0, d1) {
    const L = this.level;
    let d2 = L.secondaryAngle;
    if (!(d1 <= d0)) { d2 = L.primaryAngle; d1 = d0; }
    if (!(d2 & 1)) {
      let diff = u8(d2 - this.angle);
      if (diff & 0x80) diff = u8(-diff);
      if (diff < 0x20) { this.angle = d2; return d1; }
    }
    this.angle = u8(this.angle + 0x20) & 0xC0;
    return d1;
  }

  // loc_1ECC6: elige el sensor más cercano; d2 = ángulo por defecto si es impar
  pickSensor(d0, d1, d2) {
    const L = this.level;
    let d3 = L.secondaryAngle;
    if (!(d1 <= d0)) { d3 = L.primaryAngle; const t = d0; d0 = d1; d1 = t; }
    if (d3 & 1) d3 = d2;
    return { d0, d1, d3 };
  }

  checkFloor() {
    const L = this.level;
    this.setCol();
    const d5 = this.top_solid_bit;
    const yr = s8(this.y_radius), xr = s8(this.x_radius);
    L.a4 = 0;
    const r0 = L.findFloor(s16(this.y + yr), s16(this.x + xr), d5, 0, 0x10);
    L.a4 = 1;
    const r1 = L.findFloor(s16(this.y + yr), s16(this.x - xr), d5, 0, 0x10);
    return this.pickSensor(r0, r1, 0);
  }

  checkCeiling() {
    const L = this.level;
    const d5 = this.lrb_solid_bit;
    const yr = s8(this.y_radius), xr = s8(this.x_radius);
    L.a4 = 0;
    const r0 = L.findFloor(s16(this.y - yr) ^ 0xF, s16(this.x + xr), d5, 0x800, -0x10);
    L.a4 = 1;
    const r1 = L.findFloor(s16(this.y - yr) ^ 0xF, s16(this.x - xr), d5, 0x800, -0x10);
    return this.pickSensor(r0, r1, 0x80);
  }

  checkRightCeiling() {
    const L = this.level;
    const d5 = this.lrb_solid_bit;
    const yr = s8(this.y_radius), xr = s8(this.x_radius);
    L.a4 = 0;
    const r0 = L.findWall(s16(this.y - xr), s16(this.x + yr), d5, 0, 0x10);
    L.a4 = 1;
    const r1 = L.findWall(s16(this.y + xr), s16(this.x + yr), d5, 0, 0x10);
    return this.pickSensor(r0, r1, 0xC0);
  }

  checkLeftCeiling() {
    const L = this.level;
    const d5 = this.lrb_solid_bit;
    const yr = s8(this.y_radius), xr = s8(this.x_radius);
    L.a4 = 0;
    const r0 = L.findWall(s16(this.y - xr), s16(this.x - yr) ^ 0xF, d5, 0x400, -0x10);
    L.a4 = 1;
    const r1 = L.findWall(s16(this.y + xr), s16(this.x - yr) ^ 0xF, d5, 0x400, -0x10);
    return this.pickSensor(r0, r1, 0x40);
  }

  // loc_1ECFE: un solo sensor (Primary_Angle), ángulo por defecto d2 si es impar
  single(d1, d2) {
    let d3 = this.level.primaryAngle;
    if (d3 & 1) d3 = d2;
    return { d1, d3 };
  }

  checkRightWallDist(y = this.y, x = this.x) {
    const L = this.level; L.a4 = 0;
    const d1 = L.findWall(y, s16(x + 0xA), this.lrb_solid_bit, 0, 0x10);
    return this.single(d1, 0xC0);
  }

  checkLeftWallDist(y = this.y, x = this.x) {
    const L = this.level; L.a4 = 0;
    const d1 = L.findWall(y, s16(x - 0xA) ^ 0xF, this.lrb_solid_bit, 0x400, -0x10);
    return this.single(d1, 0x40);
  }

  checkFloorDistPart2(y, x) {
    const L = this.level; L.a4 = 0;
    const d1 = L.findFloor(s16(y + 0xA), x, this.lrb_solid_bit, 0, 0x10);
    return this.single(d1, 0);
  }

  checkCeilingDistPart2(y, x) {
    const L = this.level; L.a4 = 0;
    const d1 = L.findFloor(s16(y - 0xA) ^ 0xF, x, this.lrb_solid_bit, 0x800, -0x10);
    return this.single(d1, 0x80);
  }

  // CalcRoomInFront: predice la posición del siguiente frame y mide la pared
  calcRoomInFront(d0) {
    const L = this.level;
    this.setCol();
    const d3 = (((this.x << 16) | this.xs) + (this.x_vel << 8)) >> 16;
    let d2 = (((this.y << 16) | this.ys) + (this.y_vel << 8)) >> 16;
    L.primaryAngle = d0; L.secondaryAngle = d0;
    const d1 = d0;
    let q;
    if (!(u8(d0 + 0x20) & 0x80)) { q = d1; if (q & 0x80) q = u8(q + 1); q = u8(q + 0x1F); }
    else { q = d1; if (q & 0x80) q = u8(q - 1); q = u8(q + 0x20); }
    q &= 0xC0;
    if (q === 0) return this.checkFloorDistPart2(s16(d2), s16(d3)).d1;
    if (q === 0x80) return this.checkCeilingDistPart2(s16(d2), s16(d3)).d1;
    if (!(d1 & 0x38)) d2 += 8;
    if (q === 0x40) return this.checkLeftWallDist(s16(d2), s16(d3)).d1;
    return this.checkRightWallDist(s16(d2), s16(d3)).d1;
  }

  calcRoomOverHead(d0) {
    const L = this.level;
    this.setCol();
    L.primaryAngle = d0; L.secondaryAngle = d0;
    switch (u8(d0 + 0x20) & 0xC0) {
      case 0x40: return this.checkLeftCeiling().d1;
      case 0x80: return this.checkCeiling().d1;
      case 0xC0: return this.checkRightCeiling().d1;
    }
    // ángulo 0: continúa con Sonic_CheckFloor (caída en el código original)
    return this.checkFloor().d1;
  }

  chkFloorEdge(x) {
    const L = this.level;
    this.setCol();
    L.a4 = 0; L.primaryAngle = 0;
    return L.findFloor(s16(this.y + s8(this.y_radius)), x, this.top_solid_bit, 0, 0x10);
  }
}
