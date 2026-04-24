// Flat-top hexagon geometry.
// Edges numbered 0–5 clockwise starting from the top-right vertex pair:
//
//      5   0
//    4       1
//      3   2

export const HEX_SIZE = 48;

export function hexVertices(cx: number, cy: number, size: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    verts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return verts;
}

// Center of a flat-top hex at axial coords (q, r)
export function hexToPixel(q: number, r: number, size: number): [number, number] {
  const x = size * (3 / 2) * q;
  const y = size * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r);
  return [x, y];
}

// Two connectors on edge e (0–5), offset 25% from each vertex toward the midpoint.
// Returns [connectorA, connectorB] where A is closer to vertex e, B closer to vertex e+1.
export function edgeConnectors(
  cx: number, cy: number, size: number, edge: number
): [[number, number], [number, number]] {
  const v = hexVertices(cx, cy, size);
  const a = v[edge]!;
  const b = v[(edge + 1) % 6]!;
  const t = 0.25;
  return [
    [a[0] + (b[0] - a[0]) * t,       a[1] + (b[1] - a[1]) * t],
    [a[0] + (b[0] - a[0]) * (1 - t), a[1] + (b[1] - a[1]) * (1 - t)],
  ];
}

export interface HexCell {
  q: number;
  r: number;
}

// Generate a circular hex grid of `radius` rings
export function generateGrid(radius: number): HexCell[] {
  const cells: HexCell[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      cells.push({ q, r });
    }
  }
  return cells;
}
