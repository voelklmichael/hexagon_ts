import type { StandardGameOptions } from "./standardGameOptions.js";
import type { PickupDeliverOptions } from "./pickupDeliverOptions.js";
import type { GameState, GameBoard, Statistics, ConnectorTile, ConnectorId, TileCoord, PickupDeliverTarget } from "./types.js";
import { createStandardGameBoard } from "./createGameBoard.js";
import { createPickupDeliverBoard } from "./createPickupDeliverBoard.js";
import { renderGameState } from "./renderGameState.js";
import { Rng } from "./random_number_generator.js";
import { hexVertices, connectorPosition, randomHexagonTile } from "./hex.js";
import { playTile } from "./playTile.js";
import { renderMusicView, initMusicAutoplay } from "./background_music.js";

const form = document.getElementById("options-form") as HTMLFormElement;
const renderBtn = document.getElementById("start-new-game-with-options") as HTMLButtonElement;
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
const restartBtn = document.getElementById("restart-game-btn") as HTMLButtonElement;

// ── Panel navigation ──
function setupBurgerMenu(
  burgerBtn: HTMLButtonElement,
  nav: HTMLElement,
  titleEl: HTMLElement,
  viewClass: string,
): void {
  burgerBtn.addEventListener("click", e => {
    e.stopPropagation();
    nav.classList.toggle("hidden");
  });
  nav.querySelectorAll<HTMLElement>(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const target = item.dataset.target!;
      document.querySelectorAll(`.${viewClass}`).forEach(v => v.classList.add("hidden"));
      document.getElementById(target)!.classList.remove("hidden");
      nav.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      titleEl.textContent = item.textContent!.trim();
      nav.classList.add("hidden");
    });
  });
}

setupBurgerMenu(
  document.getElementById("left-burger-btn") as HTMLButtonElement,
  document.getElementById("left-panel-nav") as HTMLElement,
  document.getElementById("left-panel-title") as HTMLElement,
  "left-view",
);

function switchLeftPanel(targetId: string): void {
  const nav = document.getElementById("left-panel-nav")!;
  document.querySelectorAll<HTMLElement>(".left-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(targetId)!.classList.remove("hidden");
  nav.querySelectorAll<HTMLElement>(".nav-item").forEach(item => {
    const isTarget = item.dataset.target === targetId;
    item.classList.toggle("active", isTarget);
    if (isTarget) document.getElementById("left-panel-title")!.textContent = item.textContent!.trim();
  });
}

function switchRightPanel(targetId: string): void {
  const nav = document.getElementById("right-panel-nav")!;
  document.querySelectorAll<HTMLElement>(".right-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(targetId)!.classList.remove("hidden");
  nav.querySelectorAll<HTMLElement>(".nav-item").forEach(item => {
    const isTarget = item.dataset.target === targetId;
    item.classList.toggle("active", isTarget);
    if (isTarget) document.getElementById("right-panel-title")!.textContent = item.textContent!.trim();
  });
}

const rightPanel = document.getElementById("right-panel") as HTMLDivElement;
const rightCollapseBtn = document.getElementById("right-collapse-btn") as HTMLButtonElement;
const rightPanelNav = document.getElementById("right-panel-nav") as HTMLElement;

setupBurgerMenu(
  document.getElementById("right-burger-btn") as HTMLButtonElement,
  rightPanelNav,
  document.getElementById("right-panel-title") as HTMLElement,
  "right-view",
);

rightCollapseBtn.addEventListener("click", () => {
  const collapsed = rightPanel.classList.toggle("collapsed");
  rightCollapseBtn.textContent = collapsed ? "›" : "‹";
});

rightPanel.addEventListener("transitionend", () => { if (state) redrawBoard(); });

document.addEventListener("click", () => {
  document.getElementById("left-panel-nav")!.classList.add("hidden");
  rightPanelNav.classList.add("hidden");
});

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
let animationFrameId: number | null = null;
let animationStartTime: number | null = null;
let stopConfetti: (() => void) | null = null;
const ANIMATION_DURATION = 1500;

function startAnimation() {
  animationStartTime = performance.now();
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(animate);
}

function stopAnimation() {
  animationStartTime = null;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function animate(time: number) {
  if (!animationStartTime || !state) return;
  const elapsed = time - animationStartTime;
  const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
  redrawBoard(progress, turn);
  if (progress < 1) animationFrameId = requestAnimationFrame(animate);
}

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
  stopAnimation();
  removeGameOverOverlay();
  const { state: prev, turn: prevTurn } = deserializeSnapshot(undoStack.pop()!);
  state = prev;
  turn = prevTurn;
  syncUndoRedo();
  persistState();
  redrawBoard();
  renderHandPanel();
  renderStats();
});

redoBtn.addEventListener("click", () => {
  if (!redoStack.length || !state) return;
  undoStack.push(serializeState(state, turn));
  stopAnimation();
  removeGameOverOverlay();
  const { state: next, turn: nextTurn } = deserializeSnapshot(redoStack.pop()!);
  state = next;
  turn = nextTurn;
  syncUndoRedo();
  persistState();
  redrawBoard();
  renderStats();
  renderHandPanel();
});

function readOptions(): StandardGameOptions | PickupDeliverOptions {
  const data = new FormData(form);
  const mode = data.get("gameMode") as string;
  if (mode === "pickup_deliver") {
    return {
      mode: "pickup_deliver",
      npcCount: Number(data.get("pd_npcCount") ?? 0),
      activePlayerHasTarget: data.get("pd_activePlayerHasTarget") === "on",
      anyTargetCount: Number(data.get("pd_anyTargetCount") ?? 0),
      handSize: Number(data.get("handSize")),
      boardSize: Number(data.get("boardSize")),
      outerConnectors: data.get("outerConnectors") as "All" | "Reduced",
    };
  }
  return {
    mode: "standard",
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

function redrawBoard(progress: number = 1.0, currentTurn?: number, playedCoord?: TileCoord | null): void {
  if (!state) return;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  if (canvas.width === 0 || canvas.height === 0) {
    requestAnimationFrame(() => redrawBoard(progress, currentTurn, playedCoord));
    return;
  }
  renderGameState(state, ctx, canvas.width, canvas.height, progress, currentTurn);
  jsonOutput.textContent = JSON.stringify(state, null, 2);
}

function targetFulfilled(target: PickupDeliverTarget, players: GameBoard["players"]): boolean {
  const candidates = target.acceptsPlayer === "any"
    ? players
    : players.filter(p => p.index === target.acceptsPlayer);
  for (const p of candidates) {
    if (p.isAlive) continue;
    for (const turn of p.history.turns) {
      const last = turn.steps[turn.steps.length - 1];
      if (last &&
        last.coord.q === target.position.coord.q &&
        last.coord.r === target.position.coord.r &&
        last.exit === target.position.connectorId) return true;
    }
  }
  return false;
}

function checkGameOver(state: GameState): { over: boolean; winners: number[]; lost: boolean } {
  if (state.options.mode === "pickup_deliver") {
    const targets = state.pickupDeliverTargets ?? [];
    if (targets.length > 0 && targets.every(t => targetFulfilled(t, state.board.players))) {
      return { over: true, winners: [0], lost: false };
    }
    const failedTarget = targets.some(t => {
      if (t.acceptsPlayer === "any") return false;
      const p = state.board.players.find(p => p.index === t.acceptsPlayer);
      return p && !p.isAlive && !targetFulfilled(t, state.board.players);
    });
    if (failedTarget || !state.board.players[0]!.isAlive) return { over: true, winners: [], lost: true };
    return { over: false, winners: [], lost: false };
  }

  const { board, options, statistics } = state;
  const alivePlayers = board.players.filter(p => p.isAlive);
  const aliveCount = alivePlayers.length;

  let over = false;
  if (options.winningCondition === "LastManStanding") {
    if (aliveCount <= 1) over = true;
  } else {
    if (aliveCount === 0) over = true;
  }

  if (!over) return { over: false, winners: [], lost: false };

  let winners: number[] = [];
  if (options.winningCondition === "LastManStanding") {
    if (aliveCount === 1) winners = [alivePlayers[0]!.index];
  } else {
    const stats = options.winningCondition === "MaxDistance" ? statistics.totalDistance : statistics.maxVelocity;
    const values = Object.values(stats);
    if (values.length > 0) {
      const max = Math.max(...values);
      winners = board.players.filter(p => stats[p.index] === max).map(p => p.index);
    }
  }
  return { over: true, winners, lost: false };
}

function startConfetti(container: HTMLElement): void {
  const cvs = document.createElement("canvas");
  Object.assign(cvs.style, {
    position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
    pointerEvents: "none",
  });
  container.insertBefore(cvs, container.firstChild);
  cvs.width = container.offsetWidth || window.innerWidth;
  cvs.height = container.offsetHeight || window.innerHeight;

  const c = cvs.getContext("2d")!;
  const COLORS = ["#ff6b6b", "#ffd93d", "#6bceff", "#c77dff", "#ff9f1c", "#00e676", "#53d8fb"];

  const pieces = Array.from({ length: 160 }, () => ({
    x: Math.random() * cvs.width,
    y: Math.random() * cvs.height - cvs.height,
    vx: (Math.random() - 0.5) * 4,
    vy: Math.random() * 3 + 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    w: Math.random() * 10 + 6,
    h: Math.random() * 6 + 3,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.15,
  }));

  let rafId: number;
  function draw() {
    c.clearRect(0, 0, cvs.width, cvs.height);
    for (const p of pieces) {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.angle);
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      if (p.y > cvs.height) { p.y = -p.h; p.x = Math.random() * cvs.width; }
    }
    rafId = requestAnimationFrame(draw);
  }
  draw();
  stopConfetti = () => { cancelAnimationFrame(rafId); stopConfetti = null; };
}

function showGameOverOverlay(winners: number[], lost: boolean, state: GameState): void {
  removeGameOverOverlay();

  // Ensure animation styles exist
  let styleEl = document.getElementById("game-over-styles") as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "game-over-styles";
    styleEl.textContent = `@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`;
    document.head.appendChild(styleEl);
  }

  const overlay = document.createElement("div");
  overlay.id = "game-over-overlay";
  Object.assign(overlay.style, {
    position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
    backgroundColor: "rgba(10, 10, 26, 0.95)", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", zIndex: "10000", color: "white",
    fontFamily: "system-ui, sans-serif", textAlign: "center", animation: "fadeIn 0.4s ease-out"
  });

  const title = document.createElement("h1");
  title.style.fontSize = "5rem";
  title.style.margin = "0";
  if (winners.length > 0) {
    const p = state.board.players.find(player => player.index === winners[0]);
    const color = p?.color || "white";
    const verb = winners.length === 1 ? "wins" : "win";
    const names = winners.map(idx => `Player ${idx + 1}`).join(" & ");
    title.textContent = `${names} ${verb}`;
    title.style.color = color;
  } else if (lost) {
    title.textContent = "GAME OVER";
    title.style.color = "#e94560";
  } else {
    title.textContent = "DRAW";
    title.style.color = "#e94560";
  }
  overlay.appendChild(title);

  const btn = document.createElement("button");
  btn.textContent = "NEW GAME";
  Object.assign(btn.style, {
    marginTop: "50px", padding: "15px 40px", fontSize: "1.2rem", cursor: "pointer",
    backgroundColor: "#53d8fb", border: "none", color: "#16213e", borderRadius: "50px", fontWeight: "bold"
  });
  btn.onclick = (e) => {
    e.stopPropagation();
    removeGameOverOverlay();
    restart();
  };
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
  if (winners.length > 0) startConfetti(overlay);
}

function removeGameOverOverlay() {
  stopConfetti?.();
  document.getElementById("game-over-overlay")?.remove();
}

function rotateTileInHand(pi: number, tileIdx: number, steps: number): void {
  if (!state) return;
  state.currentPlayer.selectedTileIndex = tileIdx;
  const player = state.board.players[pi]!;
  const tile = player.hand[tileIdx]!;
  stopAnimation();
  const shift = (((steps % 6) * 2) + 12) % 12;
  const rotated: ConnectorTile = {
    kind: "connector",
    connections: tile.connections.map(([a, b]) => [
      ((a + shift) % 12) as ConnectorId,
      ((b + shift) % 12) as ConnectorId,
    ]),
  };
  const newHand = player.hand.map((t, i) => i === tileIdx ? rotated : t);
  state.board = {
    ...state.board,
    players: state.board.players.map((p, i) => i === pi ? { ...p, hand: newHand } : p),
  };
  redrawBoard();
  renderHandPanel();
}

function renderHandPanel(): void {
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
    card.dataset.tileIndex = String(i);

    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = 160;
    tileCanvas.height = 80;
    drawMiniTile(tileCanvas, tile, i === selectedTileIndex);

    card.appendChild(tileCanvas);

    const rotRow = document.createElement("div");
    rotRow.className = "tile-rotate-row";
    const rotL = document.createElement("button");
    rotL.textContent = "↺";
    rotL.title = "Rotate left";
    const rotR = document.createElement("button");
    rotR.textContent = "↻";
    rotR.title = "Rotate right";
    rotL.addEventListener("click", e => { e.stopPropagation(); rotateTileInHand(playerIndex, i, -1); });
    rotR.addEventListener("click", e => { e.stopPropagation(); rotateTileInHand(playerIndex, i, 1); });
    rotRow.append(rotL, rotR);
    card.appendChild(rotRow);

    card.addEventListener("click", () => {
      if (!state) return;
      stopAnimation();
      state.currentPlayer.selectedTileIndex = i;
      tileGrid.querySelectorAll<HTMLElement>(".tile-card").forEach((c, idx) => {
        const sel = idx === i;
        c.classList.toggle("selected", sel);
        const cv = c.querySelector("canvas") as HTMLCanvasElement | null;
        if (cv) drawMiniTile(cv, player.hand[idx]!, sel);
      });
      playBtn.disabled = false;
      gameStatus.textContent = "";
      redrawBoard();
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

tileGrid.addEventListener("dblclick", e => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".tile-card");
  if (!card || !state) return;
  state.currentPlayer.selectedTileIndex = Number(card.dataset.tileIndex);
  playSelectedTile();
});

function playSelectedTile(): void {
  if (!state || state.currentPlayer.selectedTileIndex === null) return;

  stopAnimation();
  undoStack.push(serializeState(state, turn));
  redoStack.length = 0;
  syncUndoRedo();

  const { playerIndex, selectedTileIndex } = state.currentPlayer;
  const tile = state.board.players[playerIndex]!.hand[selectedTileIndex]!;


  turn++;
  const newBoard = playTile(state.board, playerIndex, tile, turn, state.options.mode === "standard" ? state.options.collisionMode : "pass");

  const newHand = state.board.players[playerIndex]!.hand.filter((_, i) => i !== selectedTileIndex);
  const { paths } = randomHexagonTile(state.rng);
  newHand.push({ kind: "connector", connections: paths });

  state.board = {
    ...newBoard,
    players: newBoard.players.map((p, i) =>
      i === playerIndex ? { ...p, hand: newHand } : p,
    ),
  };
  state.statistics = computeStatistics(state.board);

  const nextIdx = nextAlivePlayer(state.board.players, playerIndex);
  state.currentPlayer = { playerIndex: nextIdx === -1 ? playerIndex : nextIdx, selectedTileIndex: null };

  persistState();
  renderStats();
  renderHandPanel();

  const result = checkGameOver(state);
  if (result.over) {
    stopAnimation();
    redrawBoard();
    showGameOverOverlay(result.winners, result.lost, state);
  } else {
    startAnimation();
  }
}

playBtn.addEventListener("click", playSelectedTile);

function renderStats(): void {
  const view = document.getElementById("stats-view")!;
  if (!state) {
    view.innerHTML = '<div class="stats-empty">No game in progress.</div>';
    return;
  }
  const { statistics, board, options } = state;
  const aliveCount = board.players.filter(p => p.isAlive).length;
  const statusText = aliveCount <= 1
    ? (aliveCount === 1 ? "Game over" : "Draw")
    : `${aliveCount} alive`;
  const winStat = options.mode === "standard" && options.winningCondition === "MaxDistance" ? "dist"
    : options.mode === "standard" && options.winningCondition === "MaxVelocity" ? "vel"
      : null;
  const hi = (col: string) => winStat === col ? " class=\"stats-hi\"" : "";

  let rows = "";
  for (const p of board.players) {
    const dist = statistics.totalDistance[p.index] ?? 0;
    const vel = statistics.maxVelocity[p.index] ?? 0;
    rows += `<tr${p.isAlive ? "" : " class=\"stats-dead\""}>
      <td><span class="stats-dot" style="background:${p.color}"></span>P${p.index + 1}</td>
      <td${hi("dist")}>${dist}</td>
      <td${hi("vel")}>${vel}</td>
      <td>${p.history.turns.length}</td>
    </tr>`;
  }

  view.innerHTML = `
    <div class="stats-meta">Turn ${turn} · ${statusText}</div>
    <table class="stats-table">
      <thead><tr>
        <th>Player</th>
        <th${hi("dist")} title="Total path steps traversed">Dist</th>
        <th${hi("vel")} title="Max steps in a single turn">Max&nbsp;v</th>
        <th title="Number of turns taken">Turns</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function computeStatistics(board: GameBoard): Statistics {
  const totalDistance: Record<number, number> = {};
  const maxVelocity: Record<number, number> = {};
  for (const player of board.players) {
    const pi = player.index;
    let total = 0;
    let maxV = 0;
    for (const t of player.history.turns) {
      const v = t.steps.reduce((sum, s) => sum + s.weight, 0);
      total += v;
      if (v > maxV) maxV = v;
    }
    totalDistance[pi] = total;
    maxVelocity[pi] = maxV;
  }
  return { totalDistance, maxVelocity };
}

function render(): void {
  errorEl.textContent = "";
  stopAnimation();
  removeGameOverOverlay();

  const options = readOptions();
  const seedInput = document.getElementById("seed-input") as HTMLInputElement;
  const seed = seedInput.value.trim()
    ? (Number(seedInput.value) >>> 0)
    : ((Math.random() * 0x100000000) >>> 0);
  seedInput.value = String(seed);
  const rng = new Rng(seed);

  let board: GameBoard;
  let pickupDeliverTargets: PickupDeliverTarget[] | undefined;
  try {
    if (options.mode === "pickup_deliver") {
      const result = createPickupDeliverBoard(options, rng);
      board = result.board;
      pickupDeliverTargets = result.targets;
    } else {
      board = createStandardGameBoard(options, rng);
    }
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
    currentPlayer: { playerIndex: nextAlivePlayer(board.players, -1), selectedTileIndex: null },
    statistics: computeStatistics(board),
    pickupDeliverTargets,
  };

  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoRedo();
  emptyHint.style.display = "none";
  persistState();
  redrawBoard();
  renderHandPanel();
  renderStats();
  switchLeftPanel("hand-view");
  switchRightPanel("stats-view");
}

function restart(): void {
  if (!state) return;
  stopAnimation();
  removeGameOverOverlay();

  const rng = new Rng(state.seed);
  let board: GameBoard;
  let pickupDeliverTargets: PickupDeliverTarget[] | undefined;
  try {
    if (state.options.mode === "pickup_deliver") {
      const result = createPickupDeliverBoard(state.options, rng);
      board = result.board;
      pickupDeliverTargets = result.targets;
    } else {
      board = createStandardGameBoard(state.options, rng);
    }
  } catch (e) {
    errorEl.textContent = e instanceof Error ? e.message : String(e);
    return;
  }

  turn = 0;
  state = {
    ...state,
    board,
    history: [],
    rng,
    currentPlayer: { playerIndex: nextAlivePlayer(board.players, -1), selectedTileIndex: null },
    statistics: computeStatistics(board),
    pickupDeliverTargets,
  };

  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoRedo();
  persistState();
  redrawBoard();
  renderHandPanel();
  renderStats();
  switchLeftPanel("hand-view");
  switchRightPanel("stats-view");
}

renderBtn.addEventListener("click", render);
restartBtn.addEventListener("click", restart);

const canvasObserver = new ResizeObserver(() => { if (state) redrawBoard(); });
canvasObserver.observe(canvas);

// Restore last session on load
const saved = localStorage.getItem(LS_KEY);
if (saved) {
  try {
    const { state: s, turn: t } = deserializeSnapshot(saved);
    state = s;
    if (!state.statistics) state.statistics = computeStatistics(state.board);
    turn = t;
    emptyHint.style.display = "none";
    switchLeftPanel("hand-view");
    switchRightPanel("stats-view");
    syncUndoRedo();
    redrawBoard();
    renderHandPanel();
    renderStats();
    renderMusicView();
  } catch (e) {
    console.error("Failed to restore session:", e);
    localStorage.removeItem(LS_KEY);
    emptyHint.style.display = "flex";
    switchLeftPanel("options-view");
    switchRightPanel("stats-view");
  }
} else {
  // No saved game: show the welcome screen (empty hint + options)
  emptyHint.style.display = "flex";
  switchLeftPanel("options-view");
  switchRightPanel("stats-view");
}

// Draw after window.load so canvas dimensions are guaranteed to be non-zero.
// Also covers the restore path above (state set synchronously before load fires).
window.addEventListener("load", () => { if (state) redrawBoard(); }, { once: true });
initMusicAutoplay();
renderMusicView();
