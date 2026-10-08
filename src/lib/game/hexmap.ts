/**
 * Stylized world hex map. Pointy-top hexes in odd-r offset layout.
 * Land is sampled from a coarse hand-drawn equirectangular mask (80N .. 56S).
 */

export const MAP_COLS = 40;
export const MAP_ROWS = 18;

const SRC_COLS = 48;
const SRC_ROWS = 21;
// land ranges per source row [startCol, endCol] inclusive, 48 x 21 grid
const SRC: [number, number][][] = [
  [[17, 21], [35, 38]],
  [[8, 14], [16, 21], [30, 31], [35, 41]],
  [[1, 5], [7, 14], [16, 20], [24, 27], [29, 46]],
  [[1, 10], [13, 15], [18, 19], [21, 21], [24, 45]],
  [[3, 10], [12, 16], [22, 22], [24, 43], [45, 45]],
  [[3, 15], [23, 29], [31, 42], [44, 44]],
  [[4, 14], [22, 24], [26, 27], [29, 41], [43, 44]],
  [[5, 13], [23, 41], [43, 43]],
  [[6, 10], [13, 13], [21, 29], [31, 41]],
  [[7, 10], [13, 14], [21, 28], [30, 32], [34, 40]],
  [[9, 11], [21, 29], [31, 31], [34, 35], [37, 40], [42, 42]],
  [[11, 16], [22, 30], [35, 35], [38, 39], [42, 42]],
  [[12, 18], [24, 30], [37, 37], [39, 40]],
  [[12, 19], [25, 30], [37, 37], [39, 44]],
  [[13, 19], [25, 30], [38, 39], [41, 44]],
  [[14, 19], [25, 29], [31, 31], [39, 44]],
  [[15, 18], [25, 29], [31, 31], [39, 44]],
  [[15, 17], [26, 28], [39, 44]],
  [[15, 16], [27, 27], [40, 42], [46, 46]],
  [[15, 16], [43, 43], [46, 46]],
  [[15, 15]],
];

function srcLand(c: number, r: number): boolean {
  if (r < 0 || r >= SRC_ROWS) return false;
  for (const [a, b] of SRC[r]) if (c >= a && c <= b) return true;
  return false;
}

export interface Hex {
  id: number;
  col: number;
  row: number;
  /** axial q */
  q: number;
  /** axial r */
  r: number;
  lat: number;
  lon: number;
  region: string;
  /** pixel center in unit hex space (size = 1) */
  cx: number;
  cy: number;
}

const SQRT3 = 1.7320508075688772;

function regionOf(lat: number, lon: number): string {
  if (lon < -30) return lat > 12 ? "N.AMERICA" : "S.AMERICA";
  if (lon < 60 && lat < 35 && lat > -40) return lon > 40 && lat > 12 ? "ARABIA" : "AFRICA";
  if (lon < 45 && lat >= 35) return "EUROPE";
  if (lat < -8 && lon > 105) return "OCEANIA";
  if (lat < 8 && lon > 90) return "INDO-PACIFIC";
  return "ASIA";
}

function build(): { hexes: Hex[]; index: Map<string, number> } {
  const hexes: Hex[] = [];
  const index = new Map<string, number>();
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const fx = col + (row & 1) * 0.5 + 0.5;
      const sc = Math.floor((fx / MAP_COLS) * SRC_COLS);
      const sr = Math.floor(((row + 0.5) / MAP_ROWS) * SRC_ROWS);
      if (!srcLand(sc, sr)) continue;
      const lon = -180 + (fx / MAP_COLS) * 360;
      const lat = 80 - ((row + 0.5) / MAP_ROWS) * 136;
      const id = hexes.length;
      hexes.push({
        id,
        col,
        row,
        q: col - (row - (row & 1)) / 2,
        r: row,
        lat: Math.round(lat * 10) / 10,
        lon: Math.round(lon * 10) / 10,
        region: regionOf(lat, lon),
        cx: SQRT3 * (col + 0.5 * (row & 1)) + SQRT3 / 2,
        cy: 1.5 * row + 1,
      });
      index.set(`${col},${row}`, id);
    }
  }
  return { hexes, index };
}

const BUILT = build();
export const HEXES: Hex[] = BUILT.hexes;
export const HEX_COUNT = HEXES.length;
export const MAP_WIDTH = SQRT3 * (MAP_COLS + 0.5);
export const MAP_HEIGHT = 1.5 * (MAP_ROWS - 1) + 2;

const DIRS: [number, number][][] = [
  [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]],
  [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]],
];

export const NEIGHBORS: number[][] = HEXES.map((h) => {
  const out: number[] = [];
  for (const [dc, dr] of DIRS[h.row & 1]) {
    const id = BUILT.index.get(`${h.col + dc},${h.row + dr}`);
    if (id !== undefined) out.push(id);
  }
  return out;
});

export function hexDistance(a: number, b: number): number {
  const A = HEXES[a];
  const B = HEXES[b];
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function nearestHex(lat: number, lon: number, exclude?: Set<number>): number {
  let best = 0;
  let bd = Number.POSITIVE_INFINITY;
  for (const h of HEXES) {
    if (exclude?.has(h.id)) continue;
    const d = (h.lat - lat) ** 2 + ((h.lon - lon) * 0.8) ** 2;
    if (d < bd) {
      bd = d;
      best = h.id;
    }
  }
  return best;
}

/** SVG polygon points for a pointy-top hex at unit-space center, scaled. */
export function hexPoints(cx: number, cy: number, size: number, inset = 0): string {
  const s = size - inset;
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx * size + s * Math.cos(a)).toFixed(2)},${(cy * size + s * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export function formatCoord(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(1).padStart(4, "0")}${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lon).toFixed(1).padStart(5, "0")}${lon >= 0 ? "E" : "W"}`;
  return `${la} ${lo}`;
}

export function hexCode(id: number): string {
  const h = HEXES[id];
  if (!h) return "--";
  return `${String.fromCharCode(65 + (h.row % 26))}${String(h.col).padStart(2, "0")}`;
}
