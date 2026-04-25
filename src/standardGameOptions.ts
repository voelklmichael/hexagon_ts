import type { CollisionMode } from "./types.js";

export type WinningCondition = "LastManStanding" | "MaxDistance" | "MaxVelocity";
export type OuterConnectors  = "All" | "Reduced";

/** Full options for a standard game setup. Numeric constraints are enforced at runtime. */
export type StandardGameOptions = {
  /** Minimum 1. */
  playerCount:        number;
  collisionMode:      CollisionMode;
  highlightDeadPaths: boolean;
  winningCondition:   WinningCondition;
  /** Minimum 1. */
  handSize:           number;
  /** Minimum 3. */
  boardSize:          number;
  outerConnectors:    OuterConnectors;
};
