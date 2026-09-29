'use strict';
// Vías de mina y carrito: en algunos suelos hay railes y un carrito al que Sonic se
// puede subir. El carrito avanza solo siguiendo la vía hasta el tope del final
// (un límite fijo); al chocar con él, Sonic sale despedido.
//
// La vía sigue la superficie del suelo (colisión principal del nivel), así que no
// cambia ni el layout ni las colisiones: los railes son sprites dibujados encima.

// Vías de EHZ acto 1: x0..x1 (el tope está en x1), yHint = una Y por encima del suelo
// en x0, cartX = posición inicial del carrito, launch = velocidad con la que sale Sonic,
// high = la vía va por un túnel detrás de la pared (se dibuja con prioridad alta)
const MINE_TRACKS_EHZ1 = [
  { x0: 0x0A0, x1: 0x340, yHint: 0x280, cartX: 0x0D0, launch: [0x200, -0x800] },
  { x0: 0xCE0, x1: 0xE80, yHint: 0x1E0, cartX: 0xD10, launch: [0x300, -0x500] },
];

const RAIL_SEG = 0x100;          // ancho de cada objeto de vía
const CART_MAX_SPEED = 0x600;
const CART_ACCEL = 0x10;

// Perfil de la vía: superficie del suelo para cada x de x0 a x1 (último píxel libre sobre él)
function trackProfile(g, t) {
  if (t.surf) return t.surf;
  const n = t.x1 - t.x0 + 1;
  t.surf = new Int16Array(n);
  let y = t.yHint;
  for (let i = 0; i < n; i++) {
    // se sigue la superficie desde la altura anterior (el suelo cambia poco entre píxeles)
    for (let k = 0; k < 4; k++) {
      const d = objFloorDist(g, t.x0 + i, y);
      y = s16(y + d);
      if (Math.abs(d) < 0x10) break;
    }
    t.surf[i] = y;
  }
  return t.surf;
}

function trackSurface(t, x) {
  const i = Math.max(0, Math.min(t.surf.length - 1, x - t.x0));
  return t.surf[i];
}

// Crabmeat de EHZ 1 (x, y por encima del suelo) en tramos más o menos llanos
const CRABMEAT_EHZ1 = [[0x7D0, 0x2F8], [0xA82, 0x270], [0x15CC, 0x230], [0x2148, 0x230], [0x2620, 0x330]];

// Meleon pegados a paredes: x, y, subtype ($80: pared a su derecha, $81: a su izquierda)
const MELEON_WALLS_EHZ1 = [[0x374, 0x256, 0x80]];

// Objetos que se añaden al layout: vías, carritos, Crabmeat y Meleon en paredes.
// Por defecto los de EHZ 1; un diseño de nivel nuevo trae los suyos en level.extras.
function extraObjects(g, extras = { tracks: MINE_TRACKS_EHZ1, crabs: CRABMEAT_EHZ1, walls: MELEON_WALLS_EHZ1 }) {
  const list = [];
  // respawn: 0x8000 en yw (los enemigos destruidos no vuelven a aparecer)
  const add = (x, y, id, subtype, extra, respawn = true) => list.push({ x, yw: (y & 0xFFF) | (respawn ? 0x8000 : 0), id, subtype, extra });
  extras.tracks.forEach((t, ti) => {
    const surf = trackProfile(g, t);
    for (let sx = t.x0; sx <= t.x1; sx += RAIL_SEG) {
      const ex = Math.min(t.x1, sx + RAIL_SEG - 1);
      const cx = (sx + ex) >> 1;
      add(cx, surf[cx - t.x0], 0xF2, ti, { segX0: sx, segX1: ex, track: t }, false);
    }
    add(t.cartX, trackSurface(t, t.cartX) - 0x10, 0xF1, ti, { track: t });
  });
  for (const [x, y] of extras.crabs) add(x, y, 0xF0, 0);
  // Meleon en paredes (además de los troncos donde estaban los Coconuts)
  for (const [x, y, sub] of extras.walls) add(x, y, 0x9D, sub);
  return list;
}

// ------------------------------------------------------------------ vía (railes y tope)
class ObjMineRail extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      const t = this.track;
      const props = g.newArt.frames('props');
      const rails = [props[1][0], props[7][0]], stopper = props[2];
      // un solo "frame" con todas las piezas del tramo, relativas a (x, y):
      // un patrón de carril cada 8 px (traviesa cada 16) a la altura del suelo
      const pieces = [];
      for (let x = this.segX0; x <= this.segX1 - 7; x += 8) {
        const y = trackSurface(t, x + 4) - 2;
        const r = rails[((x - t.x0) >> 3) & 1];
        pieces.push({ x: x - this.x, y: y - this.y, size: r.size, tile: r.tile });
      }
      if (this.segX1 === t.x1) {
        const y = trackSurface(t, t.x1);
        for (const p of stopper) pieces.unshift({ x: p.x + t.x1 - this.x, y: p.y + y + 3 - this.y, size: p.size, tile: p.tile });
      }
      this.frames = [pieces];
      this.mapping_frame = 0;
      if (t.high) this.art_tile = 0x8000; // vía de un túnel: por delante de la pared
      this.render_flags = RF_LEVEL | RF_EXPLICIT_H;
      this.width_pixels = 0x90;
      this.y_radius = 0x60;
      this.priority = 5;
    }
    this.markObjGone();
  }
}

// ------------------------------------------------------------------ carrito de mina
const CART_IDLE = 2, CART_RIDE = 4, CART_COAST = 6, CART_DONE = 8;

class ObjMineCart extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = CART_IDLE;
      this.frames = g.newArt.frames('props');
      this.mapping_frame = 0;
      this.render_flags = RF_LEVEL;
      this.priority = 3;
      this.width_pixels = 0x18;
      this.y_radius = 0x0C;
      this.speed = 0;
      this.x = this.track.cartX;
      this.limit = this.track.x1 - 0x20; // se para contra el tope
      this.snap();
      if (this.track.high) this.art_tile = 0x8000;
    }
    const x0 = this.x;
    switch (this.routine) {
      case CART_IDLE:
      case CART_DONE:
        this.touch = 0;
        this.solidObject(0x18 + 0xB, 0xC, 0xC, x0);
        if (this.routine === CART_IDLE && (this.status & P1_STANDING) && !(this.sonic.status & ST_AIR)) this.board();
        break;
      case CART_RIDE: this.ride(); break;
      case CART_COAST:
        this.roll();
        this.touch = 0;
        this.solidObject(0x18 + 0xB, 0xC, 0xC, x0);
        if (this.routine === CART_COAST && (this.status & P1_STANDING) && !(this.sonic.status & ST_AIR)) this.board();
        break;
    }
    this.priority = this.routine === CART_RIDE ? 1 : 3; // Sonic va dentro: el carrito le tapa las piernas
    // el carrito vuelve a su sitio si la cámara se aleja (salvo con Sonic dentro)
    if (this.routine !== CART_RIDE) this.markObjGone(); else this.displaySprite();
  }

  snap() { this.y = s16(trackSurface(this.track, this.x) - 0x0F); }

  // Sonic se sube: el carrito toma el control (obj_control) y lo lleva dentro
  board() {
    const s = this.sonic;
    this.routine = CART_RIDE;
    s.obj_control = 1;
    s.status |= ST_ONOBJ; s.status &= ~(ST_AIR | ST_ROLL | ST_PUSH);
    s.status &= ~ST_XFLIP; // mira hacia donde va el carrito
    s.interact = this;
    s.y_radius = 0x13; s.x_radius = 9;
    s.anim = ANI.Wait;
    s.spindash_flag = 0;
    this.game.audio.sfx('CNZLaunch');
    this.holdSonic();
  }

  holdSonic() {
    const s = this.sonic;
    s.x = this.x; s.xs = 0;
    s.y = s16(this.y - 0x0F); s.ys = 0;
    s.x_vel = this.speed; s.inertia = this.speed; s.y_vel = 0;
    s.angle = 0;
  }

  release() {
    const s = this.sonic;
    s.obj_control = 0;
    s.status &= ~ST_ONOBJ;
    this.status &= ~P1_STANDING;
  }

  // avanza por la vía; devuelve true al llegar al tope
  roll() {
    if (this.speed < CART_MAX_SPEED) this.speed = Math.min(CART_MAX_SPEED, this.speed + CART_ACCEL);
    const fx = ((this.x << 16) | this.xs) + (this.speed << 8);
    this.x = fx >> 16; this.xs = fx & 0xFFFF;
    let hit = false;
    if (this.x >= this.limit) {
      this.x = this.limit; this.xs = 0;
      hit = true;
      this.routine = CART_DONE;
      this.game.audio.sfx('DoorSlam');
    }
    this.snap();
    return hit;
  }

  // con Sonic dentro, el carrito rompe los monitores y destruye los badniks que encuentra
  smash() {
    const g = this.game, s = this.sonic;
    const ahead = s16(this.x + 0x10), reach = 0x18 + 0x10;
    for (let i = 0x10; i < 0x80; i++) {
      const o = g.slots[i];
      if (!o || o === this || Math.abs(s16(o.x - ahead)) > reach || Math.abs(s16(o.y - this.y)) > 0x28) continue;
      if (o.id === 0x26 && o.routine === 2) { o.routine = 4; o.parent = s; continue; }
      if (o.collision_flags && !(o.collision_flags & 0xC0)) {
        g.addPoints(100); o.pointsFrame = 6;
        g.becomeExplosion(o);
      }
    }
  }

  ride() {
    const g = this.game, s = this.sonic;
    // si a Sonic le hacen daño (o muere) se cae del carrito
    if (s.routine !== 2 || !(s.obj_control & 1)) { this.release(); this.routine = CART_COAST; this.roll(); return; }
    if (g.ctrlPress & BTN_ABC) {
      // salto desde el carrito, conservando su velocidad
      this.release();
      this.routine = CART_COAST;
      this.holdSonic();
      if (!s.jump()) { s.status |= ST_AIR; s.y_vel = -0x680; }
      this.roll();
      return;
    }
    this.smash();
    if (this.roll()) {
      // choque con el tope: Sonic sale despedido hecho una bola
      this.release();
      const [lx, ly] = this.track.launch;
      s.x_vel = lx; s.inertia = lx; s.y_vel = ly;
      s.status |= ST_AIR | ST_ROLL; s.status &= ~ST_XFLIP;
      s.y_radius = 0xE; s.x_radius = 7;
      s.anim = ANI.Roll;
      s.jumping = 0;
      return;
    }
    this.holdSonic();
    s.anim = ANI.Wait;
  }
}

Object.assign(OBJ_CLASSES, { 0xF1: ObjMineCart, 0xF2: ObjMineRail });
