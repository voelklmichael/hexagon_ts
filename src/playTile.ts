import type {
  GameBoard, ConnectorTile, BoardConnector,
  TileCoord, ConnectorId, PathStep, BoardPosition, CollisionMode,
} from "./types.js";

function tileAt(tiles: GameBoard["tiles"], coord: TileCoord) {
  return tiles.find(e => e.coord.q === coord.q && e.coord.r === coord.r);
}

function followConnection(tile: ConnectorTile, entry: ConnectorId): ConnectorId | undefined {
  for (const [a, b] of tile.connections) {
    if (a === entry) return b;
    if (b === entry) return a;
  }
  return undefined;
}

function boardLinkAt(
  connectors: BoardConnector[],
  coord: TileCoord,
  connectorId: ConnectorId,
): BoardConnector | undefined {
  return connectors.find(c => {
    switch (c.kind) {
      case "outer_rim":
        return c.position.coord.q === coord.q
          && c.position.coord.r === coord.r
          && c.position.connectorId === connectorId;
      case "tile_tile":
        return (c.a.coord.q === coord.q && c.a.coord.r === coord.r && c.a.connectorId === connectorId)
          || (c.b.coord.q === coord.q && c.b.coord.r === coord.r && c.b.connectorId === connectorId);
      case "teleporter":
      case "long_movement":
        return (c.from.coord.q === coord.q && c.from.coord.r === coord.r && c.from.connectorId === connectorId)
          || (c.to.coord.q === coord.q && c.to.coord.r === coord.r && c.to.connectorId === connectorId);
    }
  });
}

function walkPath(
  board: GameBoard,
  start: BoardPosition,
): { steps: PathStep[]; finalPosition: BoardPosition | null } {
  const steps: PathStep[] = [];
  let { coord, connectorId } = start;
  let linkWeight = 0;

  while (true) {
    const entry = tileAt(board.tiles, coord);
    if (!entry || entry.tile.kind !== "connector") {
      return { steps, finalPosition: { coord, connectorId } };
    }

    const exitConnector = followConnection(entry.tile, connectorId);
    if (exitConnector === undefined) {
      return { steps, finalPosition: { coord, connectorId } };
    }

    steps.push({ coord, entry: connectorId, exit: exitConnector, weight: 1 + linkWeight });
    linkWeight = 0;

    const link = boardLinkAt(board.connectors, coord, exitConnector);
    if (!link || link.kind === "outer_rim") {
      return { steps, finalPosition: null };
    }

    if (link.kind === "tile_tile") {
      const next = link.a.coord.q === coord.q && link.a.coord.r === coord.r && link.a.connectorId === exitConnector
        ? link.b : link.a;
      coord = next.coord;
      connectorId = next.connectorId;
    } else { // teleporter or long_movement
      const next = link.from.coord.q === coord.q && link.from.coord.r === coord.r && link.from.connectorId === exitConnector
        ? link.to : link.from;
      coord = next.coord;
      connectorId = next.connectorId;
      if (link.kind === "long_movement") {
        linkWeight = link.steps;
      }
    }
  }
}

function positionKey(coord: TileCoord, connectorId: ConnectorId): string {
  return `${coord.q},${coord.r},${connectorId}`;
}

function visitedPositions(steps: PathStep[], finalPosition: BoardPosition | null): Set<string> {
  const s = new Set<string>();
  for (const step of steps) {
    s.add(positionKey(step.coord, step.entry));
    s.add(positionKey(step.coord, step.exit));
  }
  if (finalPosition) s.add(positionKey(finalPosition.coord, finalPosition.connectorId));
  return s;
}

// Returns the index of the first step whose entry or exit appears in otherPositions,
// or steps.length - 1 if only the finalPosition matches (player completed all steps then collided).
function firstCollisionStep(steps: PathStep[], finalPosition: BoardPosition | null, otherPositions: Set<string>): number | undefined {
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k]!;
    if (otherPositions.has(positionKey(step.coord, step.entry))) return k;
    if (otherPositions.has(positionKey(step.coord, step.exit))) return k;
  }
  if (finalPosition && otherPositions.has(positionKey(finalPosition.coord, finalPosition.connectorId))) {
    return steps.length - 1;
  }
  return undefined;
}

/**
 * Places `tile` at the current player's position, then walks every active
 * player's path on the updated board and returns a new GameBoard reflecting
 * the new tile, new positions, and extended histories.
 */
export function playTile(
  board: GameBoard,
  playerIndex: number,
  tile: ConnectorTile,
  turn: number,
  collisionMode: CollisionMode = "pass",
): GameBoard {
  const player = board.players[playerIndex];
  if (!player) throw new Error(`Invalid player index: ${playerIndex}`);

  const coord = player.position.coord;

  // Upsert tile at the playing player's coordinate
  const tiles = board.tiles.map(e =>
    e.coord.q === coord.q && e.coord.r === coord.r ? { coord, tile } : e,
  );

  const updatedBoard: GameBoard = { ...board, tiles, connectors: board.connectors };

  // Walk all alive players
  const walks = board.players.map(p =>
    p.isAlive ? walkPath(updatedBoard, p.position) : null,
  );

  // Detect collisions: players sharing any connector position during this turn both die.
  // killStep maps player index → index of the first step where the collision occurs.
  const killStep = new Map<number, number>();
  if (collisionMode === "die") {
    const sets = walks.map(w => w && w.steps.length > 0 ? visitedPositions(w.steps, w.finalPosition) : null);
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const si = sets[i], sj = sets[j];
        if (!si || !sj) continue;
        if (![...si].some(pos => sj.has(pos))) continue;
        const wi = walks[i]!, wj = walks[j]!;
        const ki = firstCollisionStep(wi.steps, wi.finalPosition, sj);
        const kj = firstCollisionStep(wj.steps, wj.finalPosition, si);
        if (ki !== undefined && ki < (killStep.get(i) ?? Infinity)) killStep.set(i, ki);
        if (kj !== undefined && kj < (killStep.get(j) ?? Infinity)) killStep.set(j, kj);
      }
    }
  }

  const players = board.players.map((p, pi) => {
    if (!p.isAlive) return p;
    const walk = walks[pi]!;

    const deathStep = killStep.get(pi);
    const isAlive = walk.finalPosition !== null && deathStep === undefined;

    // If no movement and no change in status, skip update
    if (walk.steps.length === 0 && isAlive === p.isAlive) return p;

    const steps = deathStep !== undefined ? walk.steps.slice(0, deathStep + 1) : walk.steps;
    const isAnimated = steps.some(s => s.coord.q === coord.q && s.coord.r === coord.r);

    return {
      ...p,
      isAlive,
      position: walk.finalPosition ?? p.position,
      history: {
        ...p.history, turns: steps.length > 0
          ? [...p.history.turns, { playerIndex: pi, turn, steps, isAnimated }]
          : p.history.turns
      },
    };
  });

  return { ...updatedBoard, players };
}
