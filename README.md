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
- [x] Enemigos (Buzzer, Masher, Meleon en lugar de Coconuts, Crabmeat), anillos (y anillos perdidos), HUD
- [x] Cartel de título, cartel de fin de acto y pantalla de resultados
- [x] Sonido: emulación de Z80 + YM2612 + PSG ejecutando el driver de sonido original
      de la ROM (música y efectos idénticos)

## Tema "Ruinas" (arte nuevo)

Opcional (casilla en la pantalla de carga o tecla `T` en cualquier momento): un
reskin del acto en pixel art propio — muros de ladrillo oliva, paneles tallados con
tachones dorados, hierba seca con raíces colgantes, postes de metal, flores otoñales
y un fondo nuevo (cielo turquesa, nubes, macizo anaranjado, lago y cordilleras granates).

Se conserva todo lo que define el nivel: layout, chunks, bloques, colisiones y el
código de scroll por línea (`SwScrl_EHZ`). Sólo cambian los píxeles de los patrones
y las paletas, dentro de los límites del Mega Drive: patrones de 8x8 a 16 colores,
4 líneas de paleta con color de 9 bits, volteos de patrón y los mismos índices de VRAM.
El fondo nuevo (512x256, un plano B de 64x32 celdas) se trocea en patrones con volteos
y se reduce hasta caber en los patrones del arte del nivel que el primer plano no usa.

El arte del primer plano se genera al vuelo a partir de los patrones de tu ROM: para
cada patrón se busca su colocación más habitual en el nivel y se pinta en coordenadas
de mundo usando el color original como mapa de materiales (roca → ladrillo 16x8 a soga
con juntas en la rejilla de 8 px, damero → paneles, hierba → hierba seca…).

## Enemigos nuevos y carritos de mina

- **Meleon** sustituye a Coconuts (el mono que lanza cocos): está escondido en los troncos
  (y en alguna pared); cuando Sonic se acerca aparece parpadeando, abre la boca, escupe un
  proyectil dirigido a Sonic y vuelve a desaparecer. Solo se le puede destruir mientras se ve.
- **Crabmeat** (como el de Sonic 1): anda, se para y lanza dos bolas en arco.
- **Vías y carritos de mina**: en algunos suelos hay railes con un carrito. Al subirte
  avanza solo siguiendo la vía; puedes saltar en marcha o dejar que choque con el tope
  del final, que te lanza por los aires.

Los sprites de Meleon y Crabmeat son de **Dolphman** ("STH2 (8-bit) Badniks - Genesis
Style"); el carrito, los railes y el tope son arte propio. Todo se convierte al vuelo en
patrones de 8x8 con las líneas de paleta 0 y 1 ya cargadas y se coloca en zonas de VRAM
libres en EHZ (la de Coconuts, la de enemigos de zona y la de Tails).

## Estructura

- `js/offsets.js` — direcciones de datos en la ROM (generadas del listado del desensamblado)
- `js/rom.js` — carga de ROM y descompresores
- `js/vdp.js` — renderizador
- `js/level.js` — datos del nivel y colisión con el terreno (`FindFloor`, `FindWall`…)
- `js/sonic.js` — Obj01 (Sonic)
- `js/objects*.js`, `js/enemies.js`, `js/titlecard.js`, `js/hud.js` — objetos del nivel
- `js/newart_data.js`, `js/newart.js` — sprites nuevos y su conversión a patrones/piezas
- `js/badniks.js` — Meleon y Crabmeat; `js/minecart.js` — vías y carritos de mina
- `js/theme.js` — tema "Ruinas": generación del arte nuevo y paletas
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
