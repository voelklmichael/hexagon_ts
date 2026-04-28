import type { OuterConnectors } from "./standardGameOptions.js";

export type PickupDeliverOptions = {
  mode: "pickup_deliver";
  /** NPCs that are automatically routed by the single active player. */
  npcCount: number;
  /** Whether the active player (index 0) also has a personal target to reach. */
  activePlayerHasTarget: boolean;
  /** Extra targets that any player (including active) can fulfill. */
  anyTargetCount: number;
  boardSize: number;
  handSize: number;
  outerConnectors: OuterConnectors;
};
