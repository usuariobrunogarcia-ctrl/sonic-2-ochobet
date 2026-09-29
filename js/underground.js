'use strict';
// Underground Zone: diseño de nivel nuevo basado en Emerald Hill 1, con el doble de largo.
//
// El nivel se monta con secciones de columnas de chunks (128 px) del original,
// reordenadas y repetidas. Los cortes se hicieron sólo donde el perfil del terreno
// (todas las superficies de la columna, de arriba abajo, con ±4 px) coincide a ambos
// lados, para que los caminos de arriba y de abajo sigan conectados sin trampas.
// Los objetos, anillos, vías, carritos y enemigos nuevos de cada sección viajan con ella.
//
// El layout usa el formato ancho de S3K (8 filas de chunks x 256 columnas) en lugar
// del de S2 (16 x 128): ocupa la misma memoria y permite un nivel de 165 columnas.

// [primera columna, última + 1] de EHZ 1 para cada sección, en orden
const UNDERGROUND_SECTIONS = [
  [0, 21],   // salida, primer carrito y bloque elevado
  [34, 67],  // cascadas, puentes y los dos rizos
  [62, 84],  // segundo tramo de rizos y colinas (sin el cartel final)
  [15, 36],  // colinas con el segundo carrito
  [38, 49],  // cuesta larga y tramo inferior
  [48, 69],  // palmeras, rizos y sacacorchos
  [33, 42],  // plataformas sobre el agua
  [21, 35],  // tercer carrito y palmeras
  [71, 84],  // cascada final y cartel
];

function buildUnderground(L, rom) {
  const cols = [], sections = [];
  UNDERGROUND_SECTIONS.forEach(([s, e], i) => {
    const last = i === UNDERGROUND_SECTIONS.length - 1;
    // la última sección se queda también con lo que hay más allá del borde (el cartel final)
    sections.push({ x0: s * 128, x1: last ? 0x8000 : e * 128, off: (cols.length - s) * 128, last });
    for (let c = s; c < e; c++) {
      const col = [];
      for (let r = 0; r < LEVEL_ROWS; r++) col.push(L.layout[r * 256 + c]);
      cols.push(col);
    }
  });
  // más allá del final (donde Sonic sigue andando tras el cartel) va lo mismo que en el original
  const playable = cols.length;
  for (let c = 84; c < 128 && cols.length < LEVEL_COLS; c++) {
    const col = [];
    for (let r = 0; r < LEVEL_ROWS; r++) col.push(L.layout[r * 256 + c]);
    cols.push(col);
  }
  L.setForeground(cols, playable * 128);
  // posiciones nuevas de algo que en el original estaba en x (una por cada copia de su sección)
  const place = (x) => sections.filter((m) => x >= m.x0 && x < m.x1);

  // objetos: el cartel final sólo en la última sección; los postes de control se numeran de nuevo
  const objects = [];
  for (const e of readObjectsEHZ1(rom)) {
    for (const m of place(e.x)) {
      if (e.id === 0x0D && !m.last) continue;
      // un muelle horizontal pegado al comienzo de una sección empujaría hacia atrás al
      // llegar desde otra sección distinta de la original
      if (e.id === 0x41 && (e.subtype & 0xF0) === 0x10 && e.x - m.x0 < 0x10 && m.x0 + m.off > 0) continue;
      objects.push({ ...e, x: e.x + m.off });
    }
  }
  // en cada unión, Sonic vuelve a la capa de colisión principal (el cambiador de capa que la
  // restauraba en el original puede haberse quedado en otra sección)
  for (const m of sections) if (m.x0 + m.off > 0) objects.push({ x: m.x0 + m.off, yw: 0, id: 0xF3, subtype: 0 });
  objects.sort((p, q) => p.x - q.x);
  let star = 0;
  for (const e of objects) if (e.id === 0x79) e.subtype = (e.subtype & 0x80) | ++star;
  L.objects = objects;

  const rings = [];
  for (const [x, y] of readRingsEHZ1(rom)) for (const m of place(x)) rings.push([x + m.off, y]);
  L.rings = rings;

  // vías (enteras dentro de una sección), Crabmeat y Meleon en paredes
  const tracks = [];
  for (const t of MINE_TRACKS_EHZ1) {
    for (const m of place(t.x0)) {
      if (t.x1 >= m.x1) continue;
      tracks.push({ ...t, x0: t.x0 + m.off, x1: t.x1 + m.off, cartX: t.cartX + m.off, surf: null });
    }
  }
  const crabs = [], walls = [];
  for (const [x, y] of CRABMEAT_EHZ1) for (const m of place(x)) crabs.push([x + m.off, y]);
  for (const [x, y, sub] of MELEON_WALLS_EHZ1) for (const m of place(x)) walls.push([x + m.off, y, sub]);
  for (const [x, y, sub] of UNDERGROUND_EXTRA.walls) walls.push([x, y, sub]);
  for (const [x, y] of UNDERGROUND_EXTRA.crabs) crabs.push([x, y]);
  for (const t of UNDERGROUND_EXTRA.tracks) tracks.push({ ...t });
  L.extras = { tracks, crabs, walls };
  L.zoneName = 'UNDERGROUND';
}

// Añadidos propios del nivel nuevo (coordenadas del nivel nuevo)
const UNDERGROUND_EXTRA = {
  // vías largas por los túneles de abajo (bajo los rizos): el carrito rompe monitores.
  // high: el túnel pasa por detrás de la pared, así que vía y carrito van con prioridad alta
  tracks: [
    { x0: 0x1700, x1: 0x1DE0, yHint: 0x2C0, cartX: 0x1730, launch: [0x400, -0x400], high: true },
    { x0: 0x3B80, x1: 0x3FE0, yHint: 0x2C0, cartX: 0x3BB0, launch: [0x400, -0x400], high: true },
  ],
  crabs: [],
  walls: [],
};

// Unión entre secciones: al cruzarla (en cualquier sentido) Sonic pasa a la capa principal
class ObjLayerReset extends Obj {
  update() {
    const s = this.sonic;
    const side = s.x >= this.x;
    if (this.routine === 0) { this.routine = 2; this.side = side; }
    if (side !== this.side) {
      this.side = side;
      s.top_solid_bit = 0xC; s.lrb_solid_bit = 0xD;
    }
    this.markObjGone3();
  }
}

Object.assign(OBJ_CLASSES, { 0xF3: ObjLayerReset });
