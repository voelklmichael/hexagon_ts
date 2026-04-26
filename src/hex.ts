// Flat-top hexagon geometry.
// Edges numbered 0–5 clockwise starting from the top-right vertex pair:
//
//      5   0
//    4       1
//      3   2

import { Rng } from "./random_number_generator.js";

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
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    [a[0] + (b[0] - a[0]) * (1 - t), a[1] + (b[1] - a[1]) * (1 - t)],
  ];
}

export interface HexCell {
  q: number;
  r: number;
}

// Connectors are numbered 0–11, two per edge in clockwise order:
//   Edge 0 → 0, 1  |  Edge 1 → 2, 3  |  Edge 2 → 4,  5
//   Edge 3 → 6, 7  |  Edge 4 → 8, 9  |  Edge 5 → 10, 11
export type ConnectorId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type ConnectorPair = [ConnectorId, ConnectorId];

// A tile holds 6 paths. Each path connects two distinct connectors.
// Every connector 1–12 appears in exactly one path.
export interface HexagonTile {
  paths: [
    ConnectorPair, ConnectorPair, ConnectorPair,
    ConnectorPair, ConnectorPair, ConnectorPair,
  ];
}

// Pixel position of a connector by its id (0–11), on a hex centered at (cx, cy).
export function connectorPosition(cx: number, cy: number, size: number, id: ConnectorId): [number, number] {
  const edge = Math.floor(id / 2);
  const [cA, cB] = edgeConnectors(cx, cy, size, edge);
  return id % 2 === 0 ? cA : cB;
}



// Returns a tile with a random perfect matching over connectors 0–11.
export function randomHexagonTile(rng: Rng): HexagonTile {
  const ids: ConnectorId[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  // Fisher-Yates shuffle
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }

  return {
    paths: [
      [ids[0]!, ids[1]!],
      [ids[2]!, ids[3]!],
      [ids[4]!, ids[5]!],
      [ids[6]!, ids[7]!],
      [ids[8]!, ids[9]!],
      [ids[10]!, ids[11]!],
    ],
  };
}

// Axial neighbor offset for each edge (flat-top, clockwise from lower-right):
//   edge 0 → (+1, 0)   edge 1 → (0, +1)   edge 2 → (-1, +1)
//   edge 3 → (-1, 0)   edge 4 → (0, -1)   edge 5 → (+1, -1)
export const EDGE_NEIGHBOR: readonly [number, number][] = [
  [+1, 0], [0, +1], [-1, +1],
  [-1, 0], [0, -1], [+1, -1],
];

// Given a tile and an entry connector, return the connector at the other end of the path.
export function followPath(tile: HexagonTile, entry: ConnectorId): ConnectorId {
  for (const [a, b] of tile.paths) {
    if (a === entry) return b;
    if (b === entry) return a;
  }
  throw new Error(`connector ${entry} not found in tile`);
}

// When crossing a shared edge, the connector on the neighbour is mirrored:
// edge e → opposite edge (e+3)%6, and the within-edge index flips (0↔1).
export function mirrorConnector(id: ConnectorId): ConnectorId {
  const edge = Math.floor(id / 2);
  const idx = id % 2;
  return (((edge + 3) % 6) * 2 + (1 - idx)) as ConnectorId;
}

// Rotate a tile by `steps` increments of 60° (positive = clockwise).
// Each step shifts all connector ids by +2 mod 12.
export function rotateTile(tile: HexagonTile, steps: number): HexagonTile {
  const shift = (((steps % 6) * 2) + 12 * 6) % 12;
  return {
    paths: tile.paths.map(([a, b]) => [
      ((a + shift) % 12) as ConnectorId,
      ((b + shift) % 12) as ConnectorId,
    ]) as HexagonTile["paths"],
  };
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
