import {
  HEX_SIZE, HexagonTile, ConnectorId,
  hexVertices, hexToPixel, edgeConnectors, connectorPosition,
  generateGrid, randomHexagonTile, rotateTile,
  followPath, mirrorConnector, EDGE_NEIGHBOR,
} from "./hex.js";
import { Rng } from "./random_number_generator.js";

// --- Colors / constants ---

const COLORS = {
  hexFill: "#16213e",
  hexStroke: "#0f3460",
  hexHover: "#1f4080",
  placedFill: "#0d1b35",
  placedStroke: "#1a4080",
  handFill: "#1a2a4a",
  handStroke: "#2255aa",
  connector: "#e94560",
  path: "#53d8fb",
  deadPath: "#3a3a52",
  crash: "#ffffff",
};

const CONNECTOR_RADIUS = 3.5;
const GRID_RADIUS = 3;
const HAND_HEX_SIZE = 52;
const HAND_SIZE = 3;
const ANIM_DURATION = 1500;

// --- Settings ---

let highlightDeadPaths = true;

type CollisionMode = "pass" | "die";
let collisionMode: CollisionMode = "pass";

const DEFAULT_COLORS = ["#00e676", "#ff6b6b", "#ffd93d", "#6bceff"];
let playerCount = 2;
let playerColors = [...DEFAULT_COLORS];

function playerColor(idx = 0): string {
  return playerColors[idx] ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]!;
}

// --- DOM ---

const boardCanvas = document.getElementById("game") as HTMLCanvasElement;
const boardCtx = boardCanvas.getContext("2d")!;
const gameOverEl = document.getElementById("game-over")!;
document.getElementById("restart-same-btn")!.addEventListener("click", restartCurrentGame);
document.getElementById("restart-new-btn")!.addEventListener("click", restartGame);

const cells = generateGrid(GRID_RADIUS);

// --- Types ---

interface PlayerPos { q: number; r: number; connectorId: ConnectorId; }

interface Player {
  pos: PlayerPos;
  hand: HexagonTile[];
  selectedIndex: number | null;
  traveledPaths: Map<string, [ConnectorId, ConnectorId][]>;
  isOut: boolean;
  totalDistance: number; // total path segments traveled
  maxVelocity: number; // max segments in a single move
}

interface InitialGameState {
  seed: number;
  startPositions: PlayerPos[];
}

interface ChainStep {
  q: number; r: number;
  entry: ConnectorId; exit: ConnectorId;
}

interface Preview {
  tile: HexagonTile;
  chain: ChainStep[];
  finalPos: PlayerPos | null;
}

interface PendingMove {
  playerIdx: number;
  chain: ChainStep[];
  finalPos: PlayerPos | null;
}

interface AnimSegment {
  fromX: number; fromY: number;
  ctrlX: number; ctrlY: number;
  toX: number; toY: number;
}

interface CrashEvent {
  players: [number, number];
  t: number;           // normalized [0,1]
  pixel: [number, number];
}

// --- Game state ---

const placedTiles = new Map<string, HexagonTile>();
let players: Player[] = [];
let currentPlayerIdx: number = 0;
let pendingMoves: PendingMove[] = [];
let crashSites: [number, number][] = [];
let initialState: InitialGameState;
let rng: Rng;
let preview: Preview | null = null;

const tileCanvases: HTMLCanvasElement[] = [];
const midButtons: HTMLButtonElement[] = [];

function cellKey(q: number, r: number): string { return `${q},${r}`; }
function curPlayer(): Player { return players[currentPlayerIdx]!; }

// --- Grid helpers ---

function isInGrid(q: number, r: number): boolean {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= GRID_RADIUS;
}

function isOuterEdge(q: number, r: number, edge: number): boolean {
  const [dq, dr] = EDGE_NEIGHBOR[edge]!;
  return !isInGrid(q + dq, r + dr);
}


function getOuterConnectors(): PlayerPos[] {
  const result: PlayerPos[] = [];
  for (const cell of cells) {
    for (let edge = 0; edge < 6; edge++) {
      const [dq, dr] = EDGE_NEIGHBOR[edge]!;
      if (!isInGrid(cell.q + dq, cell.r + dr)) {
        result.push({ q: cell.q, r: cell.r, connectorId: (edge * 2) as ConnectorId });
        result.push({ q: cell.q, r: cell.r, connectorId: (edge * 2 + 1) as ConnectorId });
      }
    }
  }
  return result;
}

// --- Drawing helpers ---

function drawHexShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fillColor: string, strokeColor: string,
): void {
  const verts = hexVertices(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(verts[0]![0], verts[0]![1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(verts[i]![0], verts[i]![1]);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawConnector(ctx: CanvasRenderingContext2D, mx: number, my: number): void {
  const grd = ctx.createRadialGradient(mx, my, 0, mx, my, CONNECTOR_RADIUS * 2.5);
  grd.addColorStop(0, "#ff6b8acc");
  grd.addColorStop(1, "#ff6b8a00");
  ctx.beginPath();
  ctx.arc(mx, my, CONNECTOR_RADIUS * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx, my, CONNECTOR_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.connector;
  ctx.fill();
}

function edgeNormalAngle(edge: number): number {
  return (edge * 60 + 30) * (Math.PI / 180);
}

function drawXMarker(ctx: CanvasRenderingContext2D, mx: number, my: number, angle: number): void {
  const arm = CONNECTOR_RADIUS * 1.6;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(angle);
  ctx.strokeStyle = COLORS.connector;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-arm, -arm); ctx.lineTo(arm, arm);
  ctx.moveTo(arm, -arm); ctx.lineTo(-arm, arm);
  ctx.stroke();
  ctx.restore();
}

function drawConnectors(
  ctx: CanvasRenderingContext2D, px: number, py: number, size: number,
  cellQ?: number, cellR?: number,
): void {
  for (let edge = 0; edge < 6; edge++) {
    const [cA, cB] = edgeConnectors(px, py, size, edge);
    const outer = cellQ !== undefined && cellR !== undefined && isOuterEdge(cellQ, cellR, edge);
    if (outer) {
      const angle = edgeNormalAngle(edge);
      drawXMarker(ctx, cA[0], cA[1], angle);
      drawXMarker(ctx, cB[0], cB[1], angle);
    } else {
      drawConnector(ctx, cA[0], cA[1]);
      drawConnector(ctx, cB[0], cB[1]);
    }
  }
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  a: ConnectorId, b: ConnectorId,
  color: string, lineWidth = 2.5,
): void {
  const [ax, ay] = connectorPosition(cx, cy, size, a);
  const [bx, by] = connectorPosition(cx, cy, size, b);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(cx, cy, bx, by);
  ctx.stroke();
}

function drawTilePaths(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, tile: HexagonTile): void {
  for (const [a, b] of tile.paths) drawPath(ctx, cx, cy, size, a, b, COLORS.path);
}

function drawMarker(ctx: CanvasRenderingContext2D, px: number, py: number, color: string): void {
  const r = CONNECTOR_RADIUS + 3;
  const grd = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
  grd.addColorStop(0, color + "cc");
  grd.addColorStop(1, color + "00");
  ctx.beginPath();
  ctx.arc(px, py, r * 3, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// --- Preview ---

interface PlayerChainPreview {
  playerIdx: number;
  chain: ChainStep[];
  finalPos: PlayerPos | null;
}

interface Preview {
  tile: HexagonTile;
  chain: ChainStep[];        // current player's chain (also in allChains)
  finalPos: PlayerPos | null;
  allChains: PlayerChainPreview[];
}

function chainFromBoard(
  playerIdx: number, pos: PlayerPos,
  board: Map<string, HexagonTile>,
): PlayerChainPreview {
  const { q, r, connectorId } = pos;
  if (!board.has(cellKey(q, r))) return { playerIdx, chain: [], finalPos: pos };
  const chain: ChainStep[] = [];
  let curQ = q, curR = r, entry = connectorId;
  while (true) {
    const tile = board.get(cellKey(curQ, curR));
    if (!tile) return { playerIdx, chain, finalPos: { q: curQ, r: curR, connectorId: entry } };
    const exit = followPath(tile, entry);
    chain.push({ q: curQ, r: curR, entry, exit });
    const exitEdge = Math.floor(exit / 2);
    const [dq, dr] = EDGE_NEIGHBOR[exitEdge]!;
    const nextQ = curQ + dq, nextR = curR + dr;
    if (!isInGrid(nextQ, nextR)) return { playerIdx, chain, finalPos: null };
    curQ = nextQ; curR = nextR; entry = mirrorConnector(exit);
  }
}

function computePreview(): void {
  const player = curPlayer();
  if (player.selectedIndex === null) { preview = null; return; }

  const tile = player.hand[player.selectedIndex]!;
  const { q, r, connectorId } = player.pos;

  const tempPlaced = new Map(placedTiles);
  tempPlaced.set(cellKey(q, r), tile);

  // Current player's chain
  const cur = chainFromBoard(currentPlayerIdx, { q, r, connectorId }, tempPlaced);

  // All players' chains against the preview board
  const allChains: PlayerChainPreview[] = players.map((p, i) => {
    if (p.isOut) return { playerIdx: i, chain: [], finalPos: null };
    if (i === currentPlayerIdx) return cur;
    return chainFromBoard(i, p.pos, tempPlaced);
  });

  preview = { tile, chain: cur.chain, finalPos: cur.finalPos, allChains };
}

// --- Animation ---

let animPlayersXY: Array<[number, number] | null> = [];
let isAnimating = false;

function bezier(t: number, p0: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function buildAnimSegments(chain: ChainStep[]): AnimSegment[] {
  const originX = boardCanvas.width / 2;
  const originY = boardCanvas.height / 2;
  return chain.map(step => {
    const [cx, cy] = hexToPixel(step.q, step.r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;
    const [fromX, fromY] = connectorPosition(px, py, HEX_SIZE, step.entry);
    const [toX, toY] = connectorPosition(px, py, HEX_SIZE, step.exit);
    return { fromX, fromY, ctrlX: px, ctrlY: py, toX, toY };
  });
}

function chainPosition(segments: AnimSegment[], t: number): [number, number] {
  if (segments.length === 0) return [0, 0];
  const scaled = t * segments.length;
  const segIdx = Math.min(Math.floor(scaled), segments.length - 1);
  const localT = scaled - segIdx;
  const seg = segments[segIdx]!;
  return [
    bezier(localT, seg.fromX, seg.ctrlX, seg.toX),
    bezier(localT, seg.fromY, seg.ctrlY, seg.toY),
  ];
}

function startMultiAnimation(
  allSegments: AnimSegment[][],
  pendingCrashes: CrashEvent[],
  onComplete: () => void,
): void {
  isAnimating = true;
  animPlayersXY = players.map(() => null);
  let start: number | null = null;

  function tick(now: number): void {
    if (start === null) start = now;
    const t = Math.min((now - start) / ANIM_DURATION, 1);

    for (let i = 0; i < players.length; i++) {
      const segs = allSegments[i] ?? [];
      if (segs.length === 0) { animPlayersXY[i] = null; continue; }
      const crash = pendingCrashes.find(c => c.players.includes(i));
      const tPlayer = crash ? Math.min(t, crash.t) : t;
      animPlayersXY[i] = chainPosition(segs, tPlayer);
    }

    renderBoard();

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      isAnimating = false;
      animPlayersXY = [];
      onComplete();
    }
  }

  requestAnimationFrame(tick);
}

// --- Collision detection ---

function detectCrashes(allSegments: AnimSegment[][]): CrashEvent[] {
  const crashes: CrashEvent[] = [];

  for (let a = 0; a < players.length; a++) {
    for (let b = a + 1; b < players.length; b++) {
      if (players[a]!.isOut || players[b]!.isOut) continue;
      const moveA = pendingMoves.find(m => m.playerIdx === a);
      const moveB = pendingMoves.find(m => m.playerIdx === b);
      if (!moveA || !moveB) continue;

      const chainA = moveA.chain, chainB = moveB.chain;
      const n_A = chainA.length, n_B = chainB.length;
      const segsA = allSegments[a]!;

      let earliest: CrashEvent | null = null;

      // Head-on: same cell, same path traversed in opposite directions simultaneously
      for (let i = 0; i < n_A; i++) {
        for (let j = 0; j < n_B; j++) {
          const sA = chainA[i]!, sB = chainB[j]!;
          if (sA.q !== sB.q || sA.r !== sB.r) continue;
          if (sA.entry !== sB.exit || sA.exit !== sB.entry) continue;

          const t = (1 + i + j) / (n_A + n_B);
          const localA = t * n_A - i;
          if (localA < 0 || localA > 1) continue;
          if (earliest && t >= earliest.t) continue;

          const seg = segsA[i]!;
          earliest = {
            players: [a, b],
            t,
            pixel: [
              bezier(localA, seg.fromX, seg.ctrlX, seg.toX),
              bezier(localA, seg.fromY, seg.ctrlY, seg.toY),
            ],
          };
        }
      }

      // Same-connector: A's exit lands on B's entry connector at the same normalized time
      for (let i = 0; i < n_A; i++) {
        for (let j = 0; j < n_B; j++) {
          const sA = chainA[i]!, sB = chainB[j]!;
          const tA = (i + 1) / n_A;
          const tB = j / n_B;

          const exitEdge = Math.floor(sA.exit / 2);
          const [dq, dr] = EDGE_NEIGHBOR[exitEdge]!;
          const nq = sA.q + dq, nr = sA.r + dr;
          if (nq !== sB.q || nr !== sB.r) continue;
          if (mirrorConnector(sA.exit) !== sB.entry) continue;

          const t = (tA + tB) / 2;
          if (earliest && t >= earliest.t) continue;

          const [px, py] = chainPosition(segsA, tA);
          earliest = { players: [a, b], t, pixel: [px, py] };
        }
      }

      if (earliest) crashes.push(earliest);
    }
  }

  return crashes;
}

// --- Game logic ---

function computePlayerChain(playerIdx: number, pos: PlayerPos): PendingMove {
  const r = chainFromBoard(playerIdx, pos, placedTiles);
  return { playerIdx, chain: r.chain, finalPos: r.finalPos };
}

function playTile(): void {
  const player = curPlayer();
  if (player.selectedIndex === null || preview === null || isAnimating) return;

  // Place tile on board immediately
  placedTiles.set(cellKey(player.pos.q, player.pos.r), player.hand[player.selectedIndex]!);

  // Record traveled paths for current player
  for (const step of preview.chain) {
    const key = cellKey(step.q, step.r);
    const list = player.traveledPaths.get(key) ?? [];
    list.push([step.entry, step.exit]);
    player.traveledPaths.set(key, list);
  }

  // Compute moves for ALL active players from the updated board state
  pendingMoves = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    if (p.isOut) continue;
    if (i === currentPlayerIdx) {
      pendingMoves.push({ playerIdx: i, chain: preview.chain, finalPos: preview.finalPos });
    } else {
      const move = computePlayerChain(i, p.pos);
      // Record any traveled paths for other players who actually move
      for (const step of move.chain) {
        const key = cellKey(step.q, step.r);
        const list = p.traveledPaths.get(key) ?? [];
        list.push([step.entry, step.exit]);
        p.traveledPaths.set(key, list);
      }
      pendingMoves.push(move);
    }
  }

  // Update stats for all moving players
  for (const move of pendingMoves) {
    const p = players[move.playerIdx]!;
    if (move.chain.length > 0) {
      p.totalDistance += move.chain.length;
      p.maxVelocity = Math.max(p.maxVelocity, move.chain.length);
    }
  }

  // Replenish hand
  player.hand.splice(player.selectedIndex, 1);
  player.hand.push(randomHexagonTile(rng));
  player.selectedIndex = null;
  preview = null;
  renderHand();
  renderStats();

  resolveRound();
}

function resolveRound(): void {
  const allSegments: AnimSegment[][] = players.map((p, i) => {
    const move = pendingMoves.find(m => m.playerIdx === i);
    if (!move || p.isOut) return [];
    return buildAnimSegments(move.chain);
  });

  const pendingCrashes = collisionMode === "die" ? detectCrashes(allSegments) : [];

  startMultiAnimation(allSegments, pendingCrashes, () => {
    // Commit crash sites and eliminate crashed players
    for (const crash of pendingCrashes) {
      crashSites.push(crash.pixel);
      for (const idx of crash.players) players[idx]!.isOut = true;
    }

    // Update the current player's position
    for (const move of pendingMoves) {
      const p = players[move.playerIdx]!;
      if (p.isOut) continue;
      if (move.finalPos === null) p.isOut = true;
      else p.pos = move.finalPos;
    }

    pendingMoves = [];

    if (players.every(p => p.isOut)) {
      triggerGameOver();
      return;
    }

    // Advance to the next active player
    let nextIdx = (currentPlayerIdx + 1) % players.length;
    while (players[nextIdx]!.isOut) nextIdx = (nextIdx + 1) % players.length;
    currentPlayerIdx = nextIdx;
    if (curPlayer().selectedIndex !== null) computePreview();
    renderHand();
    renderBoard();
  });
}

function triggerGameOver(): void {
  gameOverEl.classList.add("visible");
  renderBoard();
}

function resetState(state: InitialGameState): void {
  placedTiles.clear();
  crashSites = [];
  pendingMoves = [];
  rng = new Rng(state.seed);

  players = state.startPositions.map(pos => ({
    pos,
    hand: Array.from({ length: HAND_SIZE }, () => randomHexagonTile(rng)),
    selectedIndex: null,
    traveledPaths: new Map(),
    isOut: false,
    totalDistance: 0,
    maxVelocity: 0,
  }));

  currentPlayerIdx = 0;
  preview = null;
  gameOverEl.classList.remove("visible");
  renderBoard();
  renderHand();
  renderStats();
}

function restartGame(): void {
  const outer = getOuterConnectors();
  const seed = (Math.random() * 0x100000000) >>> 0;
  const tempRng = new Rng(seed);
  // Pick distinct random start positions for each player
  const shuffled = [...outer].sort(() => tempRng.next() - 0.5);
  initialState = {
    seed,
    startPositions: Array.from({ length: playerCount }, (_, i) => shuffled[i % shuffled.length]!),
  };
  resetState(initialState);
}

function restartCurrentGame(): void {
  resetState(initialState);
}

// --- Board rendering ---

function renderBoard(): void {
  const w = boardCanvas.width;
  const h = boardCanvas.height;
  const originX = w / 2;
  const originY = h / 2;

  boardCtx.clearRect(0, 0, w, h);

  // All players' preview chains (only when not animating)
  const allPreviewChains = (!isAnimating && preview) ? preview.allChains : [];
  // Use current player's chain for the hex-border highlight
  const curPreviewChain = allPreviewChains.find(c => c.playerIdx === currentPlayerIdx)?.chain ?? [];
  const chainKeys = new Set(curPreviewChain.map(s => cellKey(s.q, s.r)));
  const previewGameOver = preview !== null && preview.finalPos === null;

  // Live-connector flood-fill.
  // Seed: every connector on a placed tile whose edge faces an empty in-grid cell.
  // Flood-fill bidirectionally through placed tiles.
  // Anything NOT reached is dead (includes outer-rim chains AND closed loops).
  const liveConnectors = new Set<string>();
  if (highlightDeadPaths) {
    const lk = (q: number, r: number, c: ConnectorId) => `${q},${r},${c}`;
    const queue: Array<{ q: number; r: number; c: ConnectorId }> = [];

    for (const [key] of placedTiles) {
      const [qs, rs] = key.split(",").map(Number) as [number, number];
      for (let edge = 0; edge < 6; edge++) {
        const [dq, dr] = EDGE_NEIGHBOR[edge]!;
        const nq = qs + dq, nr = rs + dr;
        if (isInGrid(nq, nr) && !placedTiles.has(cellKey(nq, nr))) {
          // This edge faces an empty cell — both connectors on it are live seeds
          queue.push(
            { q: qs, r: rs, c: (edge * 2) as ConnectorId },
            { q: qs, r: rs, c: (edge * 2 + 1) as ConnectorId },
          );
        }
      }
    }

    while (queue.length) {
      const item = queue.pop()!;
      const k = lk(item.q, item.r, item.c);
      if (liveConnectors.has(k)) continue;
      liveConnectors.add(k);

      const tile = placedTiles.get(cellKey(item.q, item.r));
      if (!tile) continue;

      // Propagate to paired connector on the same tile
      const paired = followPath(tile, item.c);
      queue.push({ q: item.q, r: item.r, c: paired });

      // Propagate across each edge: current connector's edge AND paired connector's edge
      for (const c of [item.c, paired] as ConnectorId[]) {
        const edge = Math.floor(c / 2);
        const [dq, dr] = EDGE_NEIGHBOR[edge]!;
        const nq = item.q + dq, nr = item.r + dr;
        if (isInGrid(nq, nr) && placedTiles.has(cellKey(nq, nr))) {
          queue.push({ q: nq, r: nr, c: mirrorConnector(c) });
        }
      }
    }
  }

  // Draw cells
  for (const cell of cells) {
    const [cx, cy] = hexToPixel(cell.q, cell.r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;
    const placed = placedTiles.get(cellKey(cell.q, cell.r));
    const inChain = chainKeys.has(cellKey(cell.q, cell.r));

    drawHexShape(boardCtx, px, py, HEX_SIZE,
      placed ? COLORS.placedFill : COLORS.hexFill,
      inChain && previewGameOver ? "#e9456088" :
        inChain ? "#53d8fb44" :
          placed ? COLORS.placedStroke : COLORS.hexStroke);

    if (placed) {
      for (const [a, b] of placed.paths) {
        const live = liveConnectors.has(`${cell.q},${cell.r},${a}`) &&
          liveConnectors.has(`${cell.q},${cell.r},${b}`);
        drawPath(boardCtx, px, py, HEX_SIZE, a, b, (highlightDeadPaths && !live) ? COLORS.deadPath : COLORS.path);
      }
    }

    // Each player's traveled paths in their color
    for (let pi = 0; pi < players.length; pi++) {
      const traveled = players[pi]!.traveledPaths.get(cellKey(cell.q, cell.r));
      if (traveled) {
        for (const [a, b] of traveled) {
          drawPath(boardCtx, px, py, HEX_SIZE, a, b, playerColor(pi), 3);
        }
      }
    }

    // Preview paths for all players
    for (const pc of allPreviewChains) {
      const step = pc.chain.find((s: ChainStep) => s.q === cell.q && s.r === cell.r);
      if (step) {
        boardCtx.globalAlpha = 0.5;
        drawPath(boardCtx, px, py, HEX_SIZE, step.entry, step.exit, playerColor(pc.playerIdx), 3);
        boardCtx.globalAlpha = 1;
      }
    }

    // Ghost preview tile on current player's cell
    if (preview && !isAnimating && cell.q === curPlayer().pos.q && cell.r === curPlayer().pos.r) {
      boardCtx.globalAlpha = 0.45;
      drawTilePaths(boardCtx, px, py, HEX_SIZE, preview.tile);
      boardCtx.globalAlpha = 1;
    }

    drawConnectors(boardCtx, px, py, HEX_SIZE, cell.q, cell.r);
  }

  // Ghost final positions for all players
  if (!isAnimating) {
    for (const pc of allPreviewChains) {
      if (!pc.finalPos) continue;
      const fp = pc.finalPos;
      const [cx, cy] = hexToPixel(fp.q, fp.r, HEX_SIZE);
      const [gpx, gpy] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, fp.connectorId);
      boardCtx.globalAlpha = 0.4;
      boardCtx.beginPath();
      boardCtx.arc(gpx, gpy, CONNECTOR_RADIUS + 3, 0, Math.PI * 2);
      boardCtx.fillStyle = playerColor(pc.playerIdx);
      boardCtx.fill();
      boardCtx.globalAlpha = 1;
    }
  }

  // Draw crash sites
  for (const [cx, cy] of crashSites) {
    boardCtx.beginPath();
    boardCtx.arc(cx, cy, CONNECTOR_RADIUS + 5, 0, Math.PI * 2);
    boardCtx.strokeStyle = COLORS.crash;
    boardCtx.lineWidth = 2;
    boardCtx.stroke();
    boardCtx.beginPath();
    boardCtx.arc(cx, cy, 3, 0, Math.PI * 2);
    boardCtx.fillStyle = COLORS.crash;
    boardCtx.fill();
  }

  // Player markers
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi]!;
    if (p.isOut && animPlayersXY.length === 0) continue; // don't draw eliminated (static)

    const animXY = animPlayersXY[pi];
    if (animXY) {
      drawMarker(boardCtx, animXY[0], animXY[1], playerColor(pi));
    } else if (!p.isOut) {
      // Draw at static position — even during animation if this player isn't moving
      const [cx, cy] = hexToPixel(p.pos.q, p.pos.r, HEX_SIZE);
      const [mpx, mpy] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, p.pos.connectorId);
      drawMarker(boardCtx, mpx, mpy, playerColor(pi));
    }
  }
}

// --- Hand rendering ---

function renderTile(index: number): void {
  const canvas = tileCanvases[index];
  if (!canvas) return;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const player = curPlayer();
  const isSelected = player.selectedIndex === index;
  drawHexShape(ctx, cx, cy, HAND_HEX_SIZE,
    isSelected ? "#1f3a6e" : COLORS.handFill,
    isSelected ? "#e94560" : COLORS.handStroke);
  drawTilePaths(ctx, cx, cy, HAND_HEX_SIZE, player.hand[index]!);
  if (isSelected && preview?.chain.length) {
    const step = preview.chain[0]!;
    drawPath(ctx, cx, cy, HAND_HEX_SIZE, step.entry, step.exit, playerColor(currentPlayerIdx), 3);
  }
  drawConnectors(ctx, cx, cy, HAND_HEX_SIZE);
}

function updateMidButton(index: number): void {
  const btn = midButtons[index];
  if (!btn) return;
  const isSelected = curPlayer().selectedIndex === index;
  btn.textContent = isSelected ? "Play" : "Select";
  btn.className = isSelected ? "btn-play" : "btn-select";
}

function renderHand(): void {
  // Update player indicator
  const indicator = document.getElementById("player-indicator");
  if (indicator) {
    const n = currentPlayerIdx + 1;
    const color = playerColor(currentPlayerIdx);
    indicator.textContent = playerCount > 1 ? `Player ${n}` : "";
    indicator.style.color = color;
    indicator.style.borderBottomColor = color;
  }
  for (let i = 0; i < HAND_SIZE; i++) {
    renderTile(i);
    updateMidButton(i);
  }
}

// --- Hand DOM ---

function buildHandSlots(): void {
  const panel = document.getElementById("hand-panel")!;
  panel.innerHTML = "";
  tileCanvases.length = 0;
  midButtons.length = 0;

  // Player indicator row
  const indicator = document.createElement("div");
  indicator.id = "player-indicator";
  panel.append(indicator);

  for (let i = 0; i < HAND_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "hand-slot";

    const canvas = document.createElement("canvas");
    canvas.className = "tile-canvas";
    tileCanvases.push(canvas);

    const controls = document.createElement("div");
    controls.className = "tile-controls";

    const btnLeft = document.createElement("button");
    btnLeft.textContent = "↺";
    btnLeft.title = "Rotate left";
    btnLeft.addEventListener("click", () => {
      curPlayer().hand[i] = rotateTile(curPlayer().hand[i]!, -1);
      curPlayer().selectedIndex = i;
      computePreview();
      renderHand();
      renderBoard();
    });

    const btnMid = document.createElement("button");
    btnMid.textContent = "Select";
    btnMid.className = "btn-select";
    midButtons.push(btnMid);
    btnMid.addEventListener("click", () => {
      if (curPlayer().selectedIndex === i) {
        playTile();
      } else {
        curPlayer().selectedIndex = i;
        computePreview();
        renderHand();
        renderBoard();
      }
    });

    const btnRight = document.createElement("button");
    btnRight.textContent = "↻";
    btnRight.title = "Rotate right";
    btnRight.addEventListener("click", () => {
      curPlayer().hand[i] = rotateTile(curPlayer().hand[i]!, 1);
      curPlayer().selectedIndex = i;
      computePreview();
      renderHand();
      renderBoard();
    });

    controls.append(btnLeft, btnMid, btnRight);
    slot.append(canvas, controls);
    panel.append(slot);
  }
}

// --- Stats panel ---

function renderStats(): void {
  const content = document.getElementById("stats-content")!;
  content.innerHTML = "";

  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;

    const block = document.createElement("div");
    block.className = "stat-player";

    const name = document.createElement("div");
    name.className = "stat-name";
    name.textContent = `Player ${i + 1}`;
    name.style.color = playerColor(i);

    const dist = document.createElement("div");
    dist.className = "stat-row";
    dist.innerHTML = `<span>Distance</span><span>${p.totalDistance}</span>`;

    const vel = document.createElement("div");
    vel.className = "stat-row";
    vel.innerHTML = `<span>Max velocity</span><span>${p.maxVelocity}</span>`;

    block.append(name, dist, vel);
    content.append(block);
  }
}

// --- Control panel ---

function buildControlPanel(): void {
  const panel = document.getElementById("control-panel")!;
  panel.innerHTML = "";

  // Player count
  const countSection = document.createElement("div");
  const countLabel = document.createElement("div");
  countLabel.className = "ctrl-label";
  countLabel.textContent = "Players";
  const countBtns = document.createElement("div");
  countBtns.className = "count-btns";
  for (let n = 1; n <= 4; n++) {
    const btn = document.createElement("button");
    btn.textContent = String(n);
    if (n === playerCount) btn.classList.add("active");
    btn.addEventListener("click", () => { playerCount = n; buildControlPanel(); });
    countBtns.append(btn);
  }
  countSection.append(countLabel, countBtns);

  // Player colors
  const colorsSection = document.createElement("div");
  const colorsLabel = document.createElement("div");
  colorsLabel.className = "ctrl-label";
  colorsLabel.textContent = "Player Colors";
  const colorRows = document.createElement("div");
  colorRows.className = "player-color-rows";
  for (let i = 0; i < playerCount; i++) {
    const row = document.createElement("div");
    row.className = "player-color-row";
    const label = document.createElement("span");
    label.textContent = `P${i + 1}`;
    label.style.color = playerColors[i]!;
    const input = document.createElement("input");
    input.type = "color";
    input.value = playerColors[i]!;
    input.addEventListener("input", () => {
      playerColors[i] = input.value;
      label.style.color = input.value;
      renderBoard();
      renderHand();
    });
    row.append(label, input);
    colorRows.append(row);
  }
  colorsSection.append(colorsLabel, colorRows);

  // Collision mode (only relevant for ≥ 2 players)
  const collisionSection = document.createElement("div");
  const collisionLabel = document.createElement("div");
  collisionLabel.className = "ctrl-label";
  collisionLabel.textContent = "Collision";
  const select = document.createElement("select");
  select.className = "ctrl-select";
  const opt1 = document.createElement("option");
  opt1.value = "pass";
  opt1.textContent = "Pass through (colors mix)";
  const opt2 = document.createElement("option");
  opt2.value = "die";
  opt2.textContent = "Both players die";
  select.append(opt1, opt2);
  select.value = collisionMode;
  select.addEventListener("change", () => { collisionMode = select.value as CollisionMode; });
  collisionSection.append(collisionLabel, select);

  // Game buttons
  const gameSection = document.createElement("div");
  const gameLabel = document.createElement("div");
  gameLabel.className = "ctrl-label";
  gameLabel.textContent = "Game";
  const btnRestart = document.createElement("button");
  btnRestart.textContent = "Restart this game";
  btnRestart.className = "ctrl-btn";
  btnRestart.addEventListener("click", restartCurrentGame);
  const btnNew = document.createElement("button");
  btnNew.textContent = "New random game";
  btnNew.className = "ctrl-btn";
  btnNew.addEventListener("click", restartGame);
  gameSection.append(gameLabel, btnRestart, btnNew);

  // Display options
  const displaySection = document.createElement("div");
  const displayLabel = document.createElement("div");
  displayLabel.className = "ctrl-label";
  displayLabel.textContent = "Display";
  const deadPathLabel = document.createElement("label");
  deadPathLabel.className = "ctrl-checkbox";
  const deadPathCheck = document.createElement("input");
  deadPathCheck.type = "checkbox";
  deadPathCheck.checked = highlightDeadPaths;
  deadPathCheck.addEventListener("change", () => {
    highlightDeadPaths = deadPathCheck.checked;
    renderBoard();
  });
  deadPathLabel.append(deadPathCheck, "Highlight dead paths");
  displaySection.append(displayLabel, deadPathLabel);

  panel.append(countSection, colorsSection, collisionSection, gameSection, displaySection);
}

// --- Menu ---

function initMenu(): void {
  const handPanel = document.getElementById("hand-panel")!;
  const controlPanel = document.getElementById("control-panel")!;
  const menuBtn = document.getElementById("menu-btn")!;
  const dropdown = document.getElementById("menu-dropdown")!;
  const viewName = menuBtn.querySelector(".view-name")!;
  const items = dropdown.querySelectorAll<HTMLButtonElement>(".menu-item");

  function selectView(view: string): void {
    const isHand = view === "hand";
    handPanel.classList.toggle("hidden", !isHand);
    controlPanel.classList.toggle("visible", !isHand);
    viewName.textContent = isHand ? "Hand" : "Settings";
    items.forEach(item => item.classList.toggle("active", item.dataset["view"] === view));
    dropdown.classList.remove("open");
    if (isHand) renderHand();
  }

  menuBtn.addEventListener("click", () => dropdown.classList.toggle("open"));
  items.forEach(item =>
    item.addEventListener("click", () => selectView(item.dataset["view"] ?? "hand"))
  );
  document.addEventListener("click", (e) => {
    if (!menuBtn.contains(e.target as Node)) dropdown.classList.remove("open");
  });
}

// --- Resize ---

window.addEventListener("resize", () => {
  boardCanvas.width = boardCanvas.clientWidth;
  boardCanvas.height = boardCanvas.clientHeight;
  renderBoard();
  renderHand();
});

// --- Init ---

buildHandSlots();
buildControlPanel();
initMenu();
boardCanvas.width = boardCanvas.clientWidth;
boardCanvas.height = boardCanvas.clientHeight;
restartGame();
renderHand();
