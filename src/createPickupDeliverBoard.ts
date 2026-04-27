import type {
  GameBoard, BoardPosition, BoardConnector,
  OuterRimConnector, TileTileConnector, LongMovement,
  Player, TileEntry, ConnectorId, PickupDeliverTarget,
} from "./types.js";
import type { PickupDeliverOptions } from "./pickupDeliverOptions.js";
import { generateGrid, randomHexagonTile, mirrorConnector, EDGE_NEIGHBOR, hexToPixel, HEX_SIZE } from "./hex.js";
import { Rng } from "./random_number_generator.js";

const DEFAULT_COLORS = ["#00e676", "#ff6b6b", "#ffd93d", "#6bceff", "#c77dff", "#ff9f1c"];

export function createPickupDeliverBoard(
  options: PickupDeliverOptions,
  rng: Rng,
): { board: GameBoard; targets: PickupDeliverTarget[] } {
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

      if (curr.q !== next.q || curr.r !== next.r) {
        connectors.push({
          kind: "long_movement",
          from: { coord: { q: curr.q, r: curr.r }, connectorId: currRight },
          to: { coord: { q: next.q, r: next.r }, connectorId: nextLeft },
          steps: 1,
        } as LongMovement);
      } else {
        connectors.push({ kind: "outer_rim", position: { coord: { q: curr.q, r: curr.r }, connectorId: currRight } });
        connectors.push({ kind: "outer_rim", position: { coord: { q: next.q, r: next.r }, connectorId: nextLeft } });
      }
    }
  }

  const outerRim: BoardPosition[] = (connectors as OuterRimConnector[])
    .filter(c => c.kind === "outer_rim")
    .map(c => c.position);

  const totalPlayers = 1 + options.npcCount;
  const targetCount = options.npcCount + options.anyTargetCount;
  if (outerRim.length < totalPlayers + targetCount) {
    throw new Error(
      `Not enough outer-rim connectors (${outerRim.length}) for ${totalPlayers} players and ${targetCount} targets.`,
    );
  }

  // Shuffle all outer-rim positions
  for (let i = outerRim.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [outerRim[i], outerRim[j]] = [outerRim[j]!, outerRim[i]!];
  }

  const players: Player[] = Array.from({ length: totalPlayers }, (_, i) => {
    const startPosition = outerRim[i]!;
    const isNpc = i >= 1;
    const hand = isNpc ? [] : Array.from({ length: options.handSize }, () => {
      const { paths } = randomHexagonTile(rng);
      return { kind: "connector" as const, connections: paths };
    });
    return {
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]!,
      isAlive: true,
      canTakeActions: !isNpc,
      position: startPosition,
      hand,
      history: { startPosition, turns: [] },
      index: i,
    };
  });

  // Targets come after the player start positions in the shuffled array
  const targets: PickupDeliverTarget[] = [];
  for (let i = 0; i < options.npcCount; i++) {
    targets.push({
      position: outerRim[totalPlayers + i]!,
      acceptsPlayer: i + 1, // NPC player index
    });
  }
  for (let i = 0; i < options.anyTargetCount; i++) {
    targets.push({
      position: outerRim[totalPlayers + options.npcCount + i]!,
      acceptsPlayer: "any",
    });
  }

  return { board: { tiles, players, connectors }, targets };
}
