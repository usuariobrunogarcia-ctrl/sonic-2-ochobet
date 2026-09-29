'use strict';
// Arranque: carga de la ROM, teclado y bucle a 60 Hz fijos.

(() => {
  const KEYMAP = {
    ArrowUp: BTN_UP, ArrowDown: BTN_DOWN, ArrowLeft: BTN_LEFT, ArrowRight: BTN_RIGHT,
    KeyZ: BTN_A, KeyX: BTN_B, KeyC: BTN_C, KeyA: BTN_A, KeyS: BTN_B, KeyD: BTN_C,
    Enter: BTN_START,
  };
  let held = 0;
  window.addEventListener('keydown', (e) => { if (KEYMAP[e.code]) { held |= KEYMAP[e.code]; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) { held &= ~KEYMAP[e.code]; e.preventDefault(); } });

  // Controles táctiles
  let touchHeld = 0;
  const touchEl = document.getElementById('touch');
  if (touchEl && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    touchEl.classList.add('on');
    const active = new Map();
    const update = () => {
      touchHeld = 0;
      for (const b of active.values()) touchHeld |= b;
      for (const el of touchEl.querySelectorAll('button')) {
        el.classList.toggle('down', [...active.values()].includes(+el.dataset.b));
      }
    };
    const pick = (t) => {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      return el && el.dataset && el.dataset.b ? +el.dataset.b : 0;
    };
    const onTouch = (e) => {
      e.preventDefault();
      active.clear();
      for (const t of e.touches) { const b = pick(t); if (b) active.set(t.identifier, b); }
      update();
    };
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) touchEl.addEventListener(ev, onTouch, { passive: false });
  }

  function pollGamepad() {
    let g = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      if (b(12) || p.axes[1] < -0.5) g |= BTN_UP;
      if (b(13) || p.axes[1] > 0.5) g |= BTN_DOWN;
      if (b(14) || p.axes[0] < -0.5) g |= BTN_LEFT;
      if (b(15) || p.axes[0] > 0.5) g |= BTN_RIGHT;
      if (b(0)) g |= BTN_A;
      if (b(1)) g |= BTN_B;
      if (b(2) || b(3)) g |= BTN_C;
      if (b(9)) g |= BTN_START;
    }
    return g;
  }

  function start(bytes) {
    const rom = new Rom(bytes);
    const canvas = document.getElementById('screen');
    document.getElementById('loader').hidden = true;
    canvas.hidden = false;
    const audio = new GameAudio(rom);
    audio.start();
    const unlock = () => audio.start();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    const themeBox = document.getElementById('theme');
    const game = new Game(rom, canvas, audio, { theme: themeBox && themeBox.checked });
    const toggleTheme = () => {
      game.setTheme(!game.themeOn);
      try { localStorage.setItem('s2theme', game.themeOn ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    };
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyT') toggleTheme(); });
    const tb = document.getElementById('themebtn');
    if (tb) { tb.hidden = false; tb.addEventListener('click', toggleTheme); }
    window.game = game;
    let paused = false, prevStart = false;
    let last = performance.now(), acc = 0;
    const FRAME = 1000 / 60;
    function tick(now) {
      acc += Math.min(now - last, 100);
      last = now;
      while (acc >= FRAME) {
        const pad = held | touchHeld | pollGamepad();
        const st = (pad & BTN_START) !== 0;
        if (st && !prevStart) { paused = !paused; audio.pause(paused); }
        prevStart = st;
        if (!paused) { game.padHeld = pad & 0x7F; game.step(); }
        else audio.frame();
        acc -= FRAME;
      }
      game.render();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  try { const t = localStorage.getItem('s2theme'); if (t !== null) document.getElementById('theme').checked = t === '1'; } catch (e) { /* sin almacenamiento */ }

  document.getElementById('romfile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      start(new Uint8Array(await f.arrayBuffer()));
    } catch (err) {
      console.error(err);
      document.getElementById('err').textContent = err.message;
    }
  });
})();
