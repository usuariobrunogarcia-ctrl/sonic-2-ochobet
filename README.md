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
También funciona con mando (Gamepad API).

## Estado

- [x] Carga de ROM (REV00/REV01, formato .smd) y descompresión Kosinski/Nemesis
- [x] Renderizado tipo VDP: planos, prioridades, scroll por línea, sprites
- [x] Fondo con parallax de EHZ (`SwScrl_EHZ`), arte animado y ciclo de paleta
- [x] Sonic (Obj01): física, spindash, rodar, pendientes, sensores, animaciones
- [x] Cámara (`ScrollHoriz`/`ScrollVerti`, retardo del spindash)
- [ ] Objetos del nivel: puentes, plataformas, muelles, pinchos, monitores…
- [ ] Enemigos (Buzzer, Masher, Coconuts), anillos, HUD, cartel final
- [ ] Sonido

## Estructura

- `js/offsets.js` — direcciones de datos en la ROM (generadas del listado del desensamblado)
- `js/rom.js` — carga de ROM y descompresores
- `js/vdp.js` — renderizador
- `js/level.js` — datos del nivel y colisión con el terreno (`FindFloor`, `FindWall`…)
- `js/sonic.js` — Obj01 (Sonic)
- `js/game.js` — bucle del nivel, cámara, fondo, animaciones
