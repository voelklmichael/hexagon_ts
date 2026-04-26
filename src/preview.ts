import type { StandardGameOptions } from "./standardGameOptions.js";
import type { GameState, ConnectorTile } from "./types.js";
import { createStandardGameBoard } from "./createGameBoard.js";
import { renderGameState } from "./renderGameState.js";
import { Rng } from "./random_number_generator.js";
import { hexVertices, connectorPosition, randomHexagonTile } from "./hex.js";
import { playTile } from "./playTile.js";

const form = document.getElementById("options-form") as HTMLFormElement;
const renderBtn = document.getElementById("render-btn") as HTMLButtonElement;
const errorEl = document.getElementById("error-msg") as HTMLElement;
const emptyHint = document.getElementById("empty-hint") as HTMLElement;
const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const playerStatusList = document.getElementById("player-status-list") as HTMLDivElement;
const tileGrid = document.getElementById("tile-grid") as HTMLDivElement;
const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const gameStatus = document.getElementById("game-status") as HTMLDivElement;
const jsonOutput = document.getElementById("json-output") as HTMLPreElement;
const jsonCopyBtn = document.getElementById("json-copy-btn") as HTMLButtonElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const redoBtn = document.getElementById("redo-btn") as HTMLButtonElement;

jsonCopyBtn.addEventListener("click", () => {
  const text = jsonOutput.textContent;
  if (!text) return;

  const confirm = () => {
    const orig = jsonCopyBtn.textContent;
    jsonCopyBtn.textContent = "Copied!";
    setTimeout(() => { jsonCopyBtn.textContent = orig; }, 1500);
  };

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(confirm);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    confirm();
  }
});

const LS_KEY = "hexagon_ts_preview";

type Snapshot = { stateJson: string; turn: number };

function serializeState(s: GameState, t: number): string {
  return JSON.stringify({ stateJson: JSON.stringify(s), turn: t });
}

function deserializeSnapshot(raw: string): { state: GameState; turn: number } {
  const { stateJson, turn: t } = JSON.parse(raw) as Snapshot;
  const parsed = JSON.parse(stateJson);
  const rng = new Rng(parsed.rng.seed);
  rng.count = parsed.rng.count;
  return { state: { ...parsed, rng }, turn: t };
}

let state: GameState | null = null;
let turn = 0;
const undoStack: string[] = [];
const redoStack: string[] = [];

function syncUndoRedo(): void {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function persistState(): void {
  if (!state) return;
  localStorage.setItem(LS_KEY, serializeState(state, turn));
}

undoBtn.addEventListener("click", () => {
  if (!undoStack.length || !state) return;
  redoStack.push(serializeState(state, turn));
  const { state: prev, turn: prevTurn } = deserializeSnapshot(undoStack.pop()!);
  state = prev;
  turn = prevTurn;
  syncUndoRedo();
  persistState();
  redrawBoard();
  renderMidPanel();
});

redoBtn.addEventListener("click", () => {
  if (!redoStack.length || !state) return;
  undoStack.push(serializeState(state, turn));
  const { state: next, turn: nextTurn } = deserializeSnapshot(redoStack.pop()!);
  state = next;
  turn = nextTurn;
  syncUndoRedo();
  persistState();
  redrawBoard();
  renderMidPanel();
});

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
    previewMoves: data.get("previewMoves") === "on",
  };
}

function drawMiniTile(tileCanvas: HTMLCanvasElement, tile: ConnectorTile, selected: boolean): void {
  const tc = tileCanvas.getContext("2d")!;
  const w = tileCanvas.width;
  const h = tileCanvas.height;
  const size = Math.min(w, h) * 0.38;
  const cx = w / 2;
  const cy = h / 2;

  tc.clearRect(0, 0, w, h);

  const verts = hexVertices(cx, cy, size);
  tc.beginPath();
  tc.moveTo(verts[0]![0], verts[0]![1]);
  for (let i = 1; i < 6; i++) tc.lineTo(verts[i]![0], verts[i]![1]);
  tc.closePath();
  tc.fillStyle = selected ? "#0e2040" : "#0d1b35";
  tc.fill();
  tc.strokeStyle = selected ? "#53d8fb" : "#1a4080";
  tc.lineWidth = selected ? 2 : 1.5;
  tc.stroke();

  for (const [a, b] of tile.connections) {
    const [ax, ay] = connectorPosition(cx, cy, size, a);
    const [bx, by] = connectorPosition(cx, cy, size, b);
    tc.strokeStyle = "#53d8fb";
    tc.lineWidth = 1.5;
    tc.lineCap = "round";
    tc.beginPath();
    tc.moveTo(ax, ay);
    tc.quadraticCurveTo(cx, cy, bx, by);
    tc.stroke();
  }
}

function nextAlivePlayer(players: GameState["board"]["players"], fromIndex: number): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    const p = players[idx]!;
    if (p.isAlive && p.canTakeActions) return idx;
  }
  return -1;
}

function redrawBoard(): void {
  if (!state) return;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  renderGameState(state, ctx, canvas.width, canvas.height);
  jsonOutput.textContent = JSON.stringify(state, null, 2);
}

function renderMidPanel(): void {
  if (!state) return;
  const { board, currentPlayer } = state;
  const { playerIndex, selectedTileIndex } = currentPlayer;

  // Player status list
  playerStatusList.innerHTML = "";
  board.players.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "player-status-row" + (i === playerIndex ? " current" : "");

    const dot = document.createElement("span");
    dot.className = "player-dot";
    dot.style.background = p.color;

    const label = document.createElement("span");
    label.className = "player-label" + (!p.isAlive ? " player-dead" : "");
    label.textContent = `Player ${i + 1}`;

    row.appendChild(dot);
    row.appendChild(label);

    if (i === playerIndex) {
      const badge = document.createElement("span");
      badge.className = "current-badge";
      badge.textContent = "▶";
      row.appendChild(badge);
    }

    playerStatusList.appendChild(row);
  });

  // Tile grid for current player
  tileGrid.innerHTML = "";
  const player = board.players[playerIndex];
  if (!player || !player.isAlive || !player.canTakeActions) {
    gameStatus.textContent = player && !player.isAlive ? "Eliminated" : "";
    playBtn.disabled = true;
    return;
  }

  player.hand.forEach((tile, i) => {
    const card = document.createElement("div");
    card.className = "tile-card" + (i === selectedTileIndex ? " selected" : "");

    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = 160;
    tileCanvas.height = 80;
    drawMiniTile(tileCanvas, tile, i === selectedTileIndex);

    card.appendChild(tileCanvas);
    card.addEventListener("click", () => {
      state!.currentPlayer.selectedTileIndex = i;
      redrawBoard();
      renderMidPanel();
    });
    tileGrid.appendChild(card);
  });

  const aliveCount = board.players.filter(p => p.isAlive).length;
  if (aliveCount <= 1) {
    gameStatus.textContent = aliveCount === 1 ? "Game over" : "Draw";
    playBtn.disabled = true;
  } else {
    gameStatus.textContent = selectedTileIndex === null ? "Select a tile" : "";
    playBtn.disabled = selectedTileIndex === null;
  }
}

playBtn.addEventListener("click", () => {
  if (!state || state.currentPlayer.selectedTileIndex === null) return;

  undoStack.push(serializeState(state, turn));
  redoStack.length = 0;
  syncUndoRedo();

  const { playerIndex, selectedTileIndex } = state.currentPlayer;
  const tile = state.board.players[playerIndex]!.hand[selectedTileIndex]!;

  turn++;
  const newBoard = playTile(state.board, playerIndex, tile, turn);

  // Replenish hand: remove played tile, draw a new one
  const newHand = state.board.players[playerIndex]!.hand.filter((_, i) => i !== selectedTileIndex);
  const { paths } = randomHexagonTile(state.rng);
  newHand.push({ kind: "connector", connections: paths });

  state.board = {
    ...newBoard,
    players: newBoard.players.map((p, i) =>
      i === playerIndex ? { ...p, hand: newHand } : p,
    ),
  };

  const nextIdx = nextAlivePlayer(state.board.players, playerIndex);
  state.currentPlayer = { playerIndex: nextIdx === -1 ? playerIndex : nextIdx, selectedTileIndex: null };

  persistState();
  redrawBoard();
  renderMidPanel();
});

function render(): void {
  errorEl.textContent = "";

  const options = readOptions();
  const seedInput = document.getElementById("seed-input") as HTMLInputElement;
  const seed = seedInput.value.trim()
    ? (Number(seedInput.value) >>> 0)
    : ((Math.random() * 0x100000000) >>> 0);
  seedInput.value = String(seed);
  const rng = new Rng(seed);

  let board;
  try {
    board = createStandardGameBoard(options, rng);
  } catch (e) {
    errorEl.textContent = e instanceof Error ? e.message : String(e);
    return;
  }

  turn = 0;
  state = {
    board,
    history: [],
    options,
    seed,
    rng,
    currentPlayer: { playerIndex: 0, selectedTileIndex: null },
  };

  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoRedo();
  emptyHint.style.display = "none";
  persistState();
  redrawBoard();
  renderMidPanel();
}

renderBtn.addEventListener("click", render);
window.addEventListener("resize", () => {
  if (state) redrawBoard();
});

// Restore last session on load
const saved = localStorage.getItem(LS_KEY);
if (saved) {
  try {
    const { state: s, turn: t } = deserializeSnapshot(saved);
    state = s;
    turn = t;
    emptyHint.style.display = "none";
    syncUndoRedo();
    redrawBoard();
    renderMidPanel();
  } catch {
    localStorage.removeItem(LS_KEY);
  }
}
