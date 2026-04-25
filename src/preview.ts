import type { StandardGameOptions } from "./standardGameOptions.js";
import type { GameState } from "./types.js";
import { createStandardGameBoard } from "./createGameBoard.js";
import { renderGameState } from "./renderGameState.js";
import { makeRng } from "./hex.js";

const form = document.getElementById("options-form") as HTMLFormElement;
const renderBtn = document.getElementById("render-btn") as HTMLButtonElement;
const errorEl = document.getElementById("error-msg") as HTMLElement;
const emptyHint = document.getElementById("empty-hint") as HTMLElement;
const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function readOptions(): StandardGameOptions {
  const data = new FormData(form);
  return {
    playerCount: Number(data.get("playerCount")),
    collisionMode: data.get("collisionMode") as "pass" | "die",
    highlightDeadPaths: data.get("highlightDeadPaths") === "on",
    winningCondition: data.get("winningCondition") as "LastManStanding" | "MaxDistance" | "MaxVelocity",
    handSize: Number(data.get("handSize")),
    boardSize: Number(data.get("boardSize")),
    outerConnectors: data.get("outerConnectors") as "All" | "Reduced",
  };
}

function render(): void {

  errorEl.textContent = "";

  const options = readOptions();
  const seedInput = document.getElementById("seed-input") as HTMLInputElement;
  const seed = seedInput.value.trim()
    ? (Number(seedInput.value) >>> 0)
    : ((Math.random() * 0x100000000) >>> 0);
  seedInput.value = String(seed);
  let rng = makeRng(seed)

  let board;
  try {
    board = createStandardGameBoard(options, rng);
  } catch (e) {
    errorEl.textContent = e instanceof Error ? e.message : String(e);
    return;
  }

  const state: GameState = {
    board,
    history: [],
    options: { collisionMode: options.collisionMode, highlightDeadPaths: options.highlightDeadPaths },
    seed,
    rng,
    currentPlayer: { playerIndex: 0, selectedTileIndex: null },
  };

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  renderGameState(state, ctx, canvas.width, canvas.height);
  emptyHint.style.display = "none";
}

renderBtn.addEventListener("click", render);
window.addEventListener("resize", () => {
  if (canvas.width > 0) render();
});
