import type {
  GameBoard, BoardPosition, BoardConnector,
  OuterRimConnector, TileTileConnector, LongMovement,
  Player, TileEntry, ConnectorId,
  Rng,
} from "./types.js";
import type { StandardGameOptions } from "./standardGameOptions.js";
import { generateGrid, makeRng, randomHexagonTile, mirrorConnector, EDGE_NEIGHBOR } from "./hex.js";

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
        const cA = (edge * 2) as ConnectorId;
        const cB = (edge * 2 + 1) as ConnectorId;

        const rim = (id: ConnectorId): OuterRimConnector => ({
          kind: "outer_rim",
          position: { coord: { q: cell.q, r: cell.r }, connectorId: id },
        });
        connectors.push(rim(cA));
        if (options.outerConnectors === "All") connectors.push(rim(cB));
      }
    }
  }

  // In Reduced mode, connect each outer edge's left connector (edge*2) to the
  // next clockwise rim edge's right connector (nextEdge*2+1) via LongMovement.
  if (options.outerConnectors === "Reduced") {
    for (const cell of cells) {
      for (let edge = 0; edge < 6; edge++) {
        if (edge != 1 && edge != 5) { continue; }
        const [dq, dr] = EDGE_NEIGHBOR[edge]!;
        if (isInGrid(cell.q + dq, cell.r + dr)) continue;

        // Next outer edge clockwise: try same cell first, else cross to neighbour.
        const ep = (edge + 1) % 6;
        const [ndq, ndr] = EDGE_NEIGHBOR[ep]!;
        const nq = cell.q + ndq, nr = cell.r + ndr;
        const [nextQ, nextR, nextEdge] = isInGrid(nq, nr)
          ? [nq, nr, (edge + 5) % 6]
          : [cell.q, cell.r, ep];

        const lm: LongMovement = {
          kind: "long_movement",
          from: { coord: { q: cell.q, r: cell.r }, connectorId: (edge * 2) as ConnectorId },
          to: { coord: { q: nextQ, r: nextR }, connectorId: (nextEdge * 2 + 1) as ConnectorId },
          steps: 1,
        };
        connectors.push(lm);
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
    const j = Math.floor(rng() * (i + 1));
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
      history: { startPosition, steps: [] },
    };
  });

  return { tiles, players, connectors };
}
