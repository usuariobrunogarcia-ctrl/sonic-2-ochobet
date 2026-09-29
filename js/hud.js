'use strict';
// HUD (BuildHUD / HudUpdate / Hud_Base): los dígitos se copian desde Art_Hud y
// Art_LivesNums (ROM) a las posiciones de VRAM que usan las mappings del HUD.

const HUD_SCORE_E = ART.HUD + 0x18, HUD_SCORE = HUD_SCORE_E + 2;
const HUD_RINGS = ART.HUD + 0x30, HUD_MINUTES = ART.HUD + 0x28, HUD_SECONDS = HUD_MINUTES + 4;
const HUD_LIVES = ART.LifeCounter + 9;

class HUD {
  constructor(game) {
    this.game = game;
    const rom = game.rom;
    this.art = rom.b.subarray(rom.o.Art_Hud, rom.o.Art_Hud + 0x18 * 32);
    this.livesArt = rom.b.subarray(rom.o.Art_LivesNums, rom.o.Art_LivesNums + 10 * 32);
    this.blank = new Uint8Array(64);
  }

  // Hud_Base: "E      0" + "0:00" + "  0"
  base() {
    const s = 'E      00:00  0';
    const code = { ' ': -1, ':': 0x14, 'E': 0x16 };
    let t = HUD_SCORE_E;
    for (const ch of s) {
      const c = ch in code ? code[ch] : (ch.charCodeAt(0) - 48) * 2;
      this.putChar(t, c);
      t += 2;
    }
    this.lives();
    this.lastScore = -1; this.lastRings = -1;
  }

  putChar(tile, c) {
    const vdp = this.game.vdp;
    if (c < 0) vdp.loadTiles(this.blank, tile);
    else vdp.loadTiles(this.art.subarray(c * 32, c * 32 + 64), tile);
  }

  // Dibuja un número dígito a dígito como Hud_LoadArt (los ceros a la izquierda no se dibujan)
  number(tile, value, digits, leading) {
    let div = Math.pow(10, digits - 1), started = false;
    for (let i = 0; i < digits; i++, div /= 10) {
      const d = Math.floor(value / div) % 10;
      if (d) started = true;
      if (started || leading) this.putChar(tile, d * 2);
      tile += 2;
    }
  }

  lives() {
    const g = this.game, vdp = g.vdp;
    let v = Math.min(g.lives, 99);
    const tens = Math.floor(v / 10), ones = v % 10;
    if (tens) vdp.loadTiles(this.livesArt.subarray(tens * 32, tens * 32 + 32), HUD_LIVES);
    else vdp.loadTiles(this.blank.subarray(0, 32), HUD_LIVES);
    vdp.loadTiles(this.livesArt.subarray(ones * 32, ones * 32 + 32), HUD_LIVES + 1);
    this.lastLives = g.lives;
  }

  // HudUpdate (se llama una vez por frame)
  update() {
    const g = this.game;
    if (g.score !== this.lastScore) { this.number(HUD_SCORE, g.score, 6, false); this.lastScore = g.score; }
    if (g.rings !== this.lastRings) {
      if (g.rings < this.lastRings || this.lastRings < 0) { this.putChar(HUD_RINGS, -1); this.putChar(HUD_RINGS + 2, -1); this.putChar(HUD_RINGS + 4, 0); }
      this.number(HUD_RINGS, g.rings, 3, false);
      this.lastRings = g.rings;
    }
    if (g.updateHudTimer) {
      const t = g.timerParts;
      if (t.min === 9 && t.sec === 59 && t.frame === 59) {
        g.updateHudTimer = false;
        g.timeOver = true;
        g.killCharacter(g.sonic, null);
      } else {
        if (++t.frame >= 60) {
          t.frame = 0;
          if (++t.sec >= 60) { t.sec = 0; if (++t.min >= 9) t.min = 9; }
          this.number(HUD_MINUTES, t.min, 1, true);
          this.number(HUD_SECONDS, t.sec, 2, true);
        }
      }
    }
    if (g.lives !== this.lastLives) this.lives();
  }

  // BuildHUD: el contador de anillos parpadea a 0 y el tiempo a partir de 9:00
  build() {
    const g = this.game;
    let d1 = 0;
    const blink = !((g.frame >> 3) & 1);
    if (g.rings === 0) { if (blink) { d1 = 1; if (g.timerParts.min === 9) d1 += 2; } }
    else if (blink && g.timerParts.min === 9) d1 = 2;
    g.vdp.addSprite(g.getMapping(g.rom.o.HUD_MapUnc_40A9A, d1), 16, 136, ART.HUD | 0x8000, 0);
  }
}
