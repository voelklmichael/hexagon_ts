import type {
  GameBoard, BoardPosition, BoardConnector,
  OuterRimConnector, TileTileConnector, LongMovement,
  Player, TileEntry, ConnectorId,
} from "./types.js";
import type { StandardGameOptions } from "./standardGameOptions.js";
import { generateGrid, randomHexagonTile, mirrorConnector, EDGE_NEIGHBOR, hexToPixel, HEX_SIZE } from "./hex.js";
import { Rng } from "./random_number_generator.js";

const DEFAULT_COLORS = ["#00e676", "#ff6b6b", "#ffd93d", "#6bceff", "#c77dff", "#ff9f1c"];

export function createStandardGameBoard(options: StandardGameOptions, rng: Rng): GameBoard {
  const cells = generateGrid(options.boardSize);

  const cellSet = new Set(cells.map(c => `${c.q},${c.r}`));
  const isInGrid = (q: number, r: number) => cellSet.has(`${q},${r}`);

  const tiles: TileEntry[] = cells.map(cell => ({
    coord: { q: cell.q, r: cell.r },
    tile: { kind: "empty" },
  }));

  const connectors: BoardConnector[] = [];
  const processedEdges = new Set<string>();
  const rimEdges: { q: number; r: number; edge: number }[] = [];

  for (const cell of cells) {
    for (let edge = 0; edge < 6; edge++) {
      const [dq, dr] = EDGE_NEIGHBOR[edge]!;
      const nq = cell.q + dq;
      const nr = cell.r + dr;

      if (isInGrid(nq, nr)) {
        // Skip if already added from the neighbour's side.
        const reverseKey = `${nq},${nr},${(edge + 3) % 6}`;
        if (processedEdges.has(reverseKey)) continue;
        processedEdges.add(`${cell.q},${cell.r},${edge}`);

        const cA = (edge * 2) as ConnectorId;
        const cB = (edge * 2 + 1) as ConnectorId;

        const link = (self: ConnectorId): TileTileConnector => ({
          kind: "tile_tile",
          a: { coord: { q: cell.q, r: cell.r }, connectorId: self },
          b: { coord: { q: nq, r: nr }, connectorId: mirrorConnector(self) },
        });
        connectors.push(link(cA), link(cB));
      } else {
        if (options.outerConnectors === "All") {
          const cA = (edge * 2) as ConnectorId;
          const cB = (edge * 2 + 1) as ConnectorId;
          const rim = (id: ConnectorId): OuterRimConnector => ({
            kind: "outer_rim",
            position: { coord: { q: cell.q, r: cell.r }, connectorId: id },
          });
          connectors.push(rim(cA), rim(cB));
        } else {
          rimEdges.push({ q: cell.q, r: cell.r, edge });
        }
      }
    }
  }

  if (options.outerConnectors === "Reduced") {
    const sorted = rimEdges.map(re => {
      const [cx, cy] = hexToPixel(re.q, re.r, HEX_SIZE);
      const edgeAngle = (re.edge * 60) * (Math.PI / 180);
      const midX = cx + Math.cos(edgeAngle) * (HEX_SIZE * 0.8);
      const midY = cy + Math.sin(edgeAngle) * (HEX_SIZE * 0.8);
      return { ...re, angle: Math.atan2(midY, midX) };
    }).sort((a, b) => a.angle - b.angle);

    const len = sorted.length;
    for (let i = 0; i < len; i++) {
      const curr = sorted[i]!;
      const next = sorted[(i + 1) % len]!;

      const currRight = (curr.edge * 2 + 1) as ConnectorId;
      const nextLeft = (next.edge * 2) as ConnectorId;

      if (curr.q === next.q && curr.r === next.r) {
        const diff = Math.abs(curr.edge - next.edge);
        // Adjacency check: edges must be consecutive (diff 1) or the 0-5 wrap.
        if (diff !== 1 && diff !== 5) throw new Error(`Panic: Perimeter edges on same hex must be consecutive. Found ${curr.edge} and ${next.edge}`);
      }

      if (curr.q !== next.q || curr.r !== next.r) {
        // Hex-to-Hex junction: Bridge the rightmost of the current to the leftmost of the next
        connectors.push({
          kind: "long_movement",
          from: { coord: { q: curr.q, r: curr.r }, connectorId: currRight },
          to: { coord: { q: next.q, r: next.r }, connectorId: nextLeft },
          steps: 1
        });
      } else {
        // Internal hex corner: both adjacent connectors remain as standard outer rim exits
        connectors.push({ kind: "outer_rim", position: { coord: { q: curr.q, r: curr.r }, connectorId: currRight } });
        connectors.push({ kind: "outer_rim", position: { coord: { q: next.q, r: next.r }, connectorId: nextLeft } });
      }
    }
  }

  // Shuffle outer-rim positions to pick distinct player starts.
  const outerRim: BoardPosition[] = (connectors as OuterRimConnector[])
    .filter(c => c.kind === "outer_rim")
    .map(c => c.position);

  if (outerRim.length < options.playerCount) {
    throw new Error(
      `Not enough starting positions: board has ${outerRim.length} outer-rim connectors but ${options.playerCount} players are required.`
    );
  }

  for (let i = outerRim.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [outerRim[i], outerRim[j]] = [outerRim[j]!, outerRim[i]!];
  }

  const players: Player[] = Array.from({ length: options.playerCount }, (_, i) => {
    const startPosition = outerRim[i]!;
    const hand = Array.from({ length: options.handSize }, () => {
      const { paths } = randomHexagonTile(rng);
      return { kind: "connector" as const, connections: paths };
    });
    return {
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]!,
      isAlive: true,
      canTakeActions: true,
      position: startPosition,
      hand,
      history: { startPosition, turns: [] },
      index: i
    };
  });

  return { tiles, players, connectors };
}
