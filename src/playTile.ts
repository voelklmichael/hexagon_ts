import type {
  GameBoard, ConnectorTile, BoardConnector,
  TileCoord, ConnectorId, PathStep, BoardPosition,
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

  while (true) {
    const entry = tileAt(board.tiles, coord);
    if (!entry || entry.tile.kind !== "connector") {
      return { steps, finalPosition: { coord, connectorId } };
    }

    const exitConnector = followConnection(entry.tile, connectorId);
    if (exitConnector === undefined) {
      return { steps, finalPosition: { coord, connectorId } };
    }

    steps.push({ coord, entry: connectorId, exit: exitConnector });

    const link = boardLinkAt(board.connectors, coord, exitConnector);
    if (!link || link.kind === "outer_rim") {
      return { steps, finalPosition: null };
    }

    if (link.kind === "tile_tile") {
      const next = link.a.coord.q === coord.q && link.a.coord.r === coord.r && link.a.connectorId === exitConnector
        ? link.b : link.a;
      coord = next.coord;
      connectorId = next.connectorId;
    } else {
      // teleporter or long_movement — follow from→to (or to→from if entering from the other side)
      const next = link.from.coord.q === coord.q && link.from.coord.r === coord.r && link.from.connectorId === exitConnector
        ? link.to : link.from;
      coord = next.coord;
      connectorId = next.connectorId;
    }
  }
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
): GameBoard {
  const player = board.players[playerIndex];
  if (!player) throw new Error(`Invalid player index: ${playerIndex}`);

  const coord = player.position.coord;

  // Upsert tile at the playing player's coordinate
  const tiles = board.tiles.map(e =>
    e.coord.q === coord.q && e.coord.r === coord.r ? { coord, tile } : e,
  );

  // Board topology (connectors) is unchanged by tile placement
  const connectors = board.connectors;

  const updatedBoard: GameBoard = { ...board, tiles, connectors };

  // Recompute positions and histories for all active players against the new board
  const players = board.players.map(p => {
    if (!p.isAlive) return p;

    const { steps, finalPosition } = walkPath(updatedBoard, p.position);
    if (steps.length === 0) return p;

    return {
      ...p,
      isAlive: finalPosition !== null,
      position: finalPosition ?? p.position,
      history: {
        ...p.history,
        steps: [...p.history.steps, ...steps],
      },
    };
  });

  return { ...updatedBoard, players };
}
