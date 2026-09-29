# Sonic 2 — Emerald Hill Zone (HTML + JavaScript)

Recreación jugable del primer nivel de *Sonic the Hedgehog 2* (Mega Drive) en
JavaScript, portando el código del desensamblado
[sonicretro/s2disasm](https://github.com/sonicretro/s2disasm).

Los gráficos, paletas, bloques, chunks, layout del nivel, colisiones, mappings
de sprites y guiones de animación **se leen de tu ROM** en tiempo de ejecución
(descompresores Kosinski y Nemesis incluidos). La ROM no se incluye.

## Cómo jugar

1. Abre `index.html` en el navegador (funciona directamente desde el disco).
2. Pulsa **Cargar ROM** y elige *Sonic The Hedgehog 2 (World)* REV00 o REV01
   (`.bin`, `.md`, `.gen` o `.smd`).

Controles: flechas para moverte, `Z`/`X`/`C` = A/B/C (saltar), `Enter` = Start (pausa).
También funciona con mando (Gamepad API) y, en móviles, con los controles táctiles en pantalla.

## Estado

- [x] Carga de ROM (REV00/REV01, formato .smd) y descompresión Kosinski/Nemesis
- [x] Renderizado tipo VDP: planos, prioridades, scroll por línea, sprites
- [x] Fondo con parallax de EHZ (`SwScrl_EHZ`), arte animado y ciclo de paleta
- [x] Sonic (Obj01): física, spindash, rodar, pendientes, sensores, animaciones
- [x] Cámara (`ScrollHoriz`/`ScrollVerti`, retardo del spindash)
- [x] Objetos del nivel: puentes, plataformas, cambio de plano, muelles, pinchos, monitores,
      cascadas, sacacorchos, poste de control
- [x] Enemigos (Buzzer, Masher, Coconuts), anillos (y anillos perdidos), HUD
- [x] Cartel de título, cartel de fin de acto y pantalla de resultados
- [x] Sonido: emulación de Z80 + YM2612 + PSG ejecutando el driver de sonido original
      de la ROM (música y efectos idénticos)

## Estructura

- `js/offsets.js` — direcciones de datos en la ROM (generadas del listado del desensamblado)
- `js/rom.js` — carga de ROM y descompresores
- `js/vdp.js` — renderizador
- `js/level.js` — datos del nivel y colisión con el terreno (`FindFloor`, `FindWall`…)
- `js/sonic.js` — Obj01 (Sonic)
- `js/objects*.js`, `js/enemies.js`, `js/titlecard.js`, `js/hud.js` — objetos del nivel
- `js/game.js` — bucle del nivel, cámara, fondo, animaciones, gestor de objetos
- `js/z80.js`, `js/ym2612.js`, `js/psg.js`, `js/sound.js` — hardware de sonido del Mega Drive

El Z80 pasa la batería ZEXDOC completa y la salida del YM2612 se ha contrastado con
Nuked-OPN2 (emulador exacto a nivel de ciclo) usando la música de Emerald Hill.

## Diferencias con el original

- Se juega con Sonic solo (la opción "Sonic alone" del juego); Tails no está portado.
- Al terminar los resultados se vuelve a empezar el acto 1 (el original pasa al acto 2).
- Se conservan los bugs del juego original que afectan a la jugabilidad (por ejemplo
  el derrape asimétrico de `Sonic_TurnLeft`/`Sonic_TurnRight`), igual que con `fixBugs = 0`
  en el desensamblado.
