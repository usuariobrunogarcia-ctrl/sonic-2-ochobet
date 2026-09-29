'use strict';
// Enemigos nuevos con sprites de Dolphman ("STH2 (8-bit) Badniks - Genesis Style"):
// Meleon (sustituye a Coconuts, Obj9D), Crabmeat y sus proyectiles.

// Distancia al suelo desde (x, y) hacia abajo con la colisión principal (ObjCheckFloorDist)
function objFloorDist(g, x, y) {
  const L = g.level, col = L.colAddr, a4 = L.a4, pa = L.primaryAngle, sa = L.secondaryAngle;
  L.colAddr = L.colP; L.a4 = 0;
  const d = L.findFloor(s16(y), s16(x), 0xC, 0, 0x10);
  L.colAddr = col; L.a4 = a4; L.primaryAngle = pa; L.secondaryAngle = sa;
  return d;
}

// ------------------------------------------------------------------ proyectil de los badniks nuevos
// frames: [a, b] del juego "props" (parpadeo); gravity: añade gravedad ($38 como ObjectMoveAndFall)
class ObjBadnikShot extends Obj {
  update() {
    const g = this.game;
    if (this.routine === 0) {
      this.routine = 2;
      this.frames = g.newArt.frames('props');
      this.render_flags |= RF_LEVEL;
      this.priority = 3;
      this.width_pixels = 8;
      this.collision_flags = 0x80 | 1; // daña al tocarlo
      this.touchW = 4; this.touchH = 4;
      this.life = 0;
    }
    if (this.gravity) objectMoveAndFall(this); else objectMove(this);
    this.life++;
    this.mapping_frame = this.shotFrames[(this.life >> 2) & 1];
    // se borra lejos de la cámara (horizontal o verticalmente)
    const sy = this.y - (g.camY >> 16);
    if (sy < -0x60 || sy > 224 + 0x60 || this.outOfRange()) { this.deleteObject(); return; }
    this.displaySprite();
  }
}

function spawnShot(parent, x, y, xv, yv, frames, gravity) {
  const g = parent.game;
  const s = g.allocObjectAfter(parent, ObjBadnikShot);
  if (!s) return null;
  s.id = 0x98;
  s.x = s16(x); s.y = s16(y);
  s.x_vel = xv; s.y_vel = yv;
  s.shotFrames = frames; s.gravity = gravity;
  return s;
}

// ------------------------------------------------------------------ Meleon (camaleón de las paredes)
// Está escondido en la pared (o en el tronco donde estaba Coconuts). Cuando Sonic se
// acerca aparece parpadeando, abre la boca, escupe un proyectil dirigido a Sonic y
// vuelve a desaparecer. Solo se le puede destruir mientras es visible.
// subtype $80: pared a su derecha (mira a la izquierda); $81: pared a su izquierda
// (mira a la derecha); cualquier otro valor: en un tronco, mira hacia Sonic.
const MELEON_HIDDEN = 2, MELEON_APPEAR = 4, MELEON_SHOOT = 6, MELEON_VANISH = 8;

class ObjMeleon extends Obj {
  update() {
    const g = this.game, s = this.sonic;
    if (this.routine === 0) {
      this.routine = MELEON_HIDDEN;
      this.frames = g.newArt.frames('meleon');
      this.art_tile = 0x8000; // prioridad alta: por delante de troncos y paredes del plano A
      this.render_flags = RF_LEVEL | (this.render_flags & 3);
      this.priority = 4;
      this.width_pixels = 0x18;
      this.touchW = 0x0E; this.touchH = 0x10;
      this.homeX = this.x;
      this.timer = 0;
      this.wall = this.subtype === 0x80 ? -1 : this.subtype === 0x81 ? 1 : 0;
    }
    const dx = s16(s.x - this.homeX), dy = s16(s.y - this.y);
    switch (this.routine) {
      case MELEON_HIDDEN:
        this.collision_flags = 0;
        if (this.timer) { this.timer--; break; }
        if (s.routine >= 6) break;
        if (Math.abs(dx) >= 0xA0 || Math.abs(dy) >= 0x70) break;
        // en una pared solo ve a Sonic si está por delante de ella
        if (this.wall && Math.sign(dx) !== this.wall) break;
        this.face(dx);
        this.routine = MELEON_APPEAR; this.timer = 24; this.mapping_frame = 0;
        break;
      case MELEON_APPEAR:
        if (--this.timer <= 0) { this.routine = MELEON_SHOOT; this.timer = 0; this.collision_flags = 1; }
        break;
      case MELEON_SHOOT: {
        this.collision_flags = 1;
        const t = ++this.timer;
        if (t < 28) this.face(dx);
        // cierra (0), entreabre (1), abre y dispara (2), entreabre, cierra
        this.mapping_frame = t < 24 ? 0 : t < 30 ? 1 : t < 50 ? 2 : t < 56 ? 1 : 0;
        if (t === 30) this.shoot();
        if (t >= 72) { this.routine = MELEON_VANISH; this.timer = 24; this.collision_flags = 0; }
        break;
      }
      case MELEON_VANISH:
        this.collision_flags = 0;
        if (--this.timer <= 0) { this.routine = MELEON_HIDDEN; this.timer = 120; }
        break;
    }
    if (this.markObjGone3()) return;
    // aparece y desaparece parpadeando (como el camuflaje de un camaleón)
    if (this.routine === MELEON_SHOOT || ((this.routine === MELEON_APPEAR || this.routine === MELEON_VANISH) && (this.timer & 2))) this.displaySprite();
  }

  // mira hacia Sonic (o hacia fuera de la pared) y se pega a su lado del tronco
  face(dx) {
    const right = this.wall ? this.wall > 0 : dx >= 0;
    this.render_flags = (this.render_flags & ~1) | (right ? 0 : 1);
    this.status = (this.status & ~1) | (right ? 0 : 1);
    this.x = s16(this.homeX + (this.wall ? 0 : right ? 6 : -6));
  }

  shoot() {
    const g = this.game, s = this.sonic;
    const flip = this.render_flags & 1;
    const mx = s16(this.x + (flip ? -15 : 15)), my = s16(this.y - 4);
    // proyectil dirigido hacia Sonic
    const ang = g.calcAngle(s16(s.x - mx), s16(s.y - my));
    const [sin, cos] = g.calcSine(ang);
    spawnShot(this, mx, my, (cos * 0x280) >> 8, (sin * 0x280) >> 8, [5, 6], false);
    g.audio.sfx('Gloop');
  }
}

// ------------------------------------------------------------------ Crabmeat
// Como el de Sonic 1 (Obj1F): anda un rato, se para y, una de cada dos veces,
// levanta las pinzas y lanza dos bolas en arco, una a cada lado.
// frames: 0-3 andando, 4 pinzas arriba (disparo)
class ObjCrabmeat extends Obj {
  update() {
    const g = this.game;
    switch (this.routine) {
      case 0: {
        this.routine = 2;
        this.frames = g.newArt.frames('crabmeat');
        this.render_flags = RF_LEVEL | (this.render_flags & 3);
        this.priority = 3;
        this.width_pixels = 0x18;
        this.y_radius = 0xC;
        this.collision_flags = 1;
        this.touchW = 0x10; this.touchH = 0x0C;
        this.timer = 0; this.mode = 0; this.walkFrame = 0;
        // se coloca sobre el suelo
        for (let i = 0; i < 4; i++) {
          const d = objFloorDist(g, this.x, this.y + this.y_radius);
          this.y = s16(this.y + d);
          if (Math.abs(d) < 2) break;
        }
        break;
      }
      case 2: this.waitToFire(); break;
      case 4: this.walkOnFloor(); break;
    }
    this.markObjGone();
  }

  waitToFire() {
    if (--this.timer >= 0) return;
    if ((this.render_flags & RF_ONSCREEN) && (this.mode ^= 2) & 2) { this.fire(); return; }
    // echa a andar, cada vez en un sentido
    this.routine = 4;
    this.timer = 127;
    this.status ^= 1;
    this.render_flags = (this.render_flags & ~1) | (this.status & 1);
    this.x_vel = (this.status & 1) ? 0x80 : -0x80;
    this.mapping_frame = 0;
  }

  fire() {
    this.game.audio.sfx('LavaBall');
    this.timer = 59;
    this.mapping_frame = 4;
    for (const side of [-1, 1]) {
      spawnShot(this, this.x + side * 0x10, this.y - 0x0E, side * 0x100, -0x400, [3, 4], true);
    }
  }

  walkOnFloor() {
    const g = this.game;
    if (--this.timer < 0) { this.stop(); return; }
    objectMove(this);
    this.mode ^= 1;
    if (this.mode & 1) {
      // mira si hay suelo delante (se da la vuelta en bordes y paredes)
      const ahead = s16(this.x + (this.x_vel > 0 ? 0x10 : -0x10));
      const d = objFloorDist(g, ahead, this.y + this.y_radius);
      if (d < -8 || d >= 0xC) { this.stop(); return; }
    } else {
      this.y = s16(this.y + objFloorDist(g, this.x, this.y + this.y_radius));
    }
    if ((g.frame & 7) === 0) this.walkFrame = (this.walkFrame + 1) & 3;
    this.mapping_frame = this.walkFrame;
  }

  stop() {
    this.routine = 2;
    this.timer = 59;
    this.x_vel = 0;
    this.mapping_frame = 0;
  }
}

Object.assign(OBJ_CLASSES, { 0x9D: ObjMeleon, 0xF0: ObjCrabmeat });
