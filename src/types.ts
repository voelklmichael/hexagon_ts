// ─── Connectors ───────────────────────────────────────────────────────────────
//
// Each hex cell has 6 edges, 2 connectors per edge, numbered 0–11 clockwise:
//
//   Edge 0 → connectors 0, 1   (upper-right)
//   Edge 1 → connectors 2, 3   (right)
//   Edge 2 → connectors 4, 5   (lower-right)
//   Edge 3 → connectors 6, 7   (lower-left)
//   Edge 4 → connectors 8, 9   (left)
//   Edge 5 → connectors 10, 11 (upper-left)

export type ConnectorId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

// A path between two connectors on the same tile.
export type Connection = [ConnectorId, ConnectorId];

// ─── Tile variants ────────────────────────────────────────────────────────────

/** A cell that has not yet had a tile played on it. */
export type EmptyTile = {
  kind: "empty";
};

/** A cell that is permanently blocked — no tile can ever be placed here. */
export type RemovedTile = {
  kind: "removed";
};

/**
 * A played tile.  Contains up to 12 connector endpoints wired in pairs.
 * A standard random tile has exactly 6 connections (a perfect matching of
 * all 12 connectors), but the type allows fewer for special tiles.
 */
export type ConnectorTile = {
  kind: "connector";
  connections: Connection[];
};

export type Tile = EmptyTile | RemovedTile | ConnectorTile;

// ─── Coordinates ──────────────────────────────────────────────────────────────

/** Axial coordinate of a tile on the hex grid. */
export type TileCoord = {
  q: number;
  r: number;
};

/** A position on the board: which tile and which connector on that tile. */
export type BoardPosition = {
  coord: TileCoord;
  connectorId: ConnectorId;
};

// ─── Board connectors ─────────────────────────────────────────────────────────
//
// A BoardConnector describes a link that exists between positions on the board,
// independently of any tile placed there.  The full list of connectors defines
// the board topology.

/**
 * A position at the outer rim.  Exiting through this connector removes
 * the player from play (dead end).
 */
export type OuterRimConnector = {
  kind:     "outer_rim";
  position: BoardPosition;
};

/** Standard edge-shared link between two adjacent tiles. */
export type TileTileConnector = {
  kind: "tile_tile";
  a:    BoardPosition;
  b:    BoardPosition;
};

/**
 * Instantly transports a player from one position to another,
 * regardless of physical distance on the grid.
 */
export type Teleporter = {
  kind: "teleporter";
  from: BoardPosition;
  to:   BoardPosition;
};

/**
 * Like a teleporter but the journey counts as traversing a fixed number
 * of path-segments (affects distance statistics and velocity).
 */
export type LongMovement = {
  kind:  "long_movement";
  from:  BoardPosition;
  to:    BoardPosition;
  steps: number;
};

export type BoardConnector =
  | OuterRimConnector
  | TileTileConnector
  | Teleporter
  | LongMovement;

// ─── Player history ───────────────────────────────────────────────────────────

/** One tile traversed during a single move: the tile and the connector pair used. */
export type PathStep = {
  coord: TileCoord;
  entry: ConnectorId;
  exit:  ConnectorId;
};

/**
 * The full movement history of a player.
 * `startPosition` is where they entered the board (outer-rim connector).
 * `steps` is every tile traversed in order, across all turns.
 */
export type PlayerHistory = {
  startPosition: BoardPosition;
  steps:         PathStep[];
};

// ─── Player ───────────────────────────────────────────────────────────────────

export type Player = {
  /** CSS colour string, e.g. "#00e676". */
  color: string;

  /** False once the player has exited the grid or been eliminated by a crash. */
  isAlive: boolean;

  /** There are NPC-like players which do not move themselves (they should have an empty hand) */
  canTakeActions: boolean;

  /** Where the player currently sits on the board. */
  position: BoardPosition;

  /** Tiles available to play this turn. */
  hand: ConnectorTile[];

  /** Full movement history from the start of the game. */
  history: PlayerHistory;
};

// ─── GameBoard ────────────────────────────────────────────────────────────────

/** One cell in the grid: its coordinate and current tile state. */
export type TileEntry = {
  coord: TileCoord;
  tile:  Tile;
};

/**
 * The complete, self-contained state of a game board.
 *
 * - `tiles`      — every cell and what occupies it (empty / removed / connector tile).
 * - `players`    — all players, active or eliminated.
 * - `connectors` — the board topology: outer-rim exits, tile–tile links,
 *                  teleporters, and long-movement bridges.
 */
export type GameBoard = {
  tiles:      TileEntry[];
  players:    Player[];
  connectors: BoardConnector[];
};

// ─── GameOptions ──────────────────────────────────────────────────────────────

/** Collision mode: what happens when two players occupy the same position. */
export type CollisionMode = "pass" | "die";

/** Persistent settings that govern how the game is played. */
export type GameOptions = {
  collisionMode:      CollisionMode;
  highlightDeadPaths: boolean;
};

// ─── GameState ────────────────────────────────────────────────────────────────

export type Rng = () => number;

/**
 * The complete runtime state of a game session.
 *
 * - `board`   — the current board snapshot.
 * - `history` — ordered list of previous board snapshots, oldest first.
 *               Enables undo and replay.
 * - `options` — active game settings (collision rules, display flags, …).
 * - `seed`    — current RNG seed; deterministically reproduces the tile
 *               sequence from this point forward.
 * - `rng`     — live RNG instance advanced as the game progresses.
 */
export type CurrentPlayer = {
  playerIndex:        number;
  selectedTileIndex:  number | null;
};

export type GameState = {
  board:         GameBoard;
  history:       GameBoard[];
  options:       GameOptions;
  seed:          number;
  rng:           Rng;
  currentPlayer: CurrentPlayer;
};
