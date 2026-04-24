import {
  HEX_SIZE, HexCell, HexagonTile, ConnectorId,
  hexVertices, hexToPixel, edgeConnectors, connectorPosition,
  generateGrid, randomHexagonTile, rotateTile,
  followPath, mirrorConnector, EDGE_NEIGHBOR,
} from "./hex.js";

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
  player: "#00e676",
  playerGlow: "#00e676",
};

const CONNECTOR_RADIUS = 5;
const GRID_RADIUS = 3;
const HAND_HEX_SIZE = 52;
const HAND_SIZE = 3;

// --- DOM ---

const boardCanvas = document.getElementById("game") as HTMLCanvasElement;
const boardCtx = boardCanvas.getContext("2d")!;
const gameOverEl = document.getElementById("game-over")!;
document.getElementById("restart-btn")!.addEventListener("click", restartGame);

const cells = generateGrid(GRID_RADIUS);

// --- Game state ---

interface PlayerPos { q: number; r: number; connectorId: ConnectorId; }

const placedTiles   = new Map<string, HexagonTile>();
const traveledPaths = new Map<string, Array<[ConnectorId, ConnectorId]>>();
let playerPos: PlayerPos;
let hand: HexagonTile[];
let selectedIndex: number | null = null;
let hoveredCell: HexCell | null = null;

const tileCanvases: HTMLCanvasElement[] = [];
const midButtons: HTMLButtonElement[] = [];

function cellKey(q: number, r: number): string { return `${q},${r}`; }

function isInGrid(q: number, r: number): boolean {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= GRID_RADIUS;
}

function getOuterConnectors(): PlayerPos[] {
  const result: PlayerPos[] = [];
  for (const cell of cells) {
    for (let edge = 0; edge < 6; edge++) {
      const [dq, dr] = EDGE_NEIGHBOR[edge]!;
      if (!isInGrid(cell.q + dq, cell.r + dr)) {
        result.push({ q: cell.q, r: cell.r, connectorId: (edge * 2)     as ConnectorId });
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

function drawConnectors(ctx: CanvasRenderingContext2D, px: number, py: number, size: number): void {
  for (let edge = 0; edge < 6; edge++) {
    const [cA, cB] = edgeConnectors(px, py, size, edge);
    drawConnector(ctx, cA[0], cA[1]);
    drawConnector(ctx, cB[0], cB[1]);
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

function drawPlayer(originX: number, originY: number): void {
  const [cx, cy] = hexToPixel(playerPos.q, playerPos.r, HEX_SIZE);
  const [px, py] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, playerPos.connectorId);
  const r = CONNECTOR_RADIUS + 3;
  const grd = boardCtx.createRadialGradient(px, py, 0, px, py, r * 3);
  grd.addColorStop(0, COLORS.playerGlow + "cc");
  grd.addColorStop(1, COLORS.playerGlow + "00");
  boardCtx.beginPath();
  boardCtx.arc(px, py, r * 3, 0, Math.PI * 2);
  boardCtx.fillStyle = grd;
  boardCtx.fill();
  boardCtx.beginPath();
  boardCtx.arc(px, py, r, 0, Math.PI * 2);
  boardCtx.fillStyle = COLORS.player;
  boardCtx.fill();
}

// --- Preview simulation ---

interface ChainStep {
  q: number; r: number;
  entry: ConnectorId; exit: ConnectorId;
}

interface Preview {
  tile: HexagonTile;
  chain: ChainStep[];
  finalPos: PlayerPos | null;
}

let preview: Preview | null = null;

function computePreview(): void {
  if (selectedIndex === null) { preview = null; return; }

  const tile = hand[selectedIndex]!;
  const { q, r, connectorId } = playerPos;

  const tempPlaced = new Map(placedTiles);
  tempPlaced.set(cellKey(q, r), tile);

  const chain: ChainStep[] = [];
  let curQ = q, curR = r, entry = connectorId;

  while (true) {
    const curTile = tempPlaced.get(cellKey(curQ, curR))!;
    const exit = followPath(curTile, entry);
    chain.push({ q: curQ, r: curR, entry, exit });

    const exitEdge = Math.floor(exit / 2);
    const [dq, dr] = EDGE_NEIGHBOR[exitEdge]!;
    const nextQ = curQ + dq;
    const nextR = curR + dr;

    if (!isInGrid(nextQ, nextR)) {
      preview = { tile, chain, finalPos: null };
      return;
    }

    const nextEntry = mirrorConnector(exit);

    if (!tempPlaced.has(cellKey(nextQ, nextR))) {
      preview = { tile, chain, finalPos: { q: nextQ, r: nextR, connectorId: nextEntry } };
      return;
    }

    curQ = nextQ; curR = nextR; entry = nextEntry;
  }
}

// --- Animation ---

interface AnimSegment {
  fromX: number; fromY: number;
  ctrlX: number; ctrlY: number;
  toX:   number; toY:   number;
}

let animSegments:  AnimSegment[] | null = null;
let animStart:     number | null = null;
let animRafId:     number | null = null;
let animPlayerXY:  [number, number] | null = null;
let isAnimating = false;

const ANIM_DURATION = 1500;

function bezier(t: number, p0: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function buildAnimSegments(chain: ChainStep[]): AnimSegment[] {
  const originX = boardCanvas.width  / 2;
  const originY = boardCanvas.height / 2;
  return chain.map(step => {
    const [cx, cy] = hexToPixel(step.q, step.r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;
    const [fromX, fromY] = connectorPosition(px, py, HEX_SIZE, step.entry);
    const [toX,   toY  ] = connectorPosition(px, py, HEX_SIZE, step.exit);
    return { fromX, fromY, ctrlX: px, ctrlY: py, toX, toY };
  });
}

function startAnimation(segments: AnimSegment[], onComplete: () => void): void {
  animSegments = segments;
  isAnimating  = true;

  function tick(now: number): void {
    if (animStart === null) animStart = now;
    const t = Math.min((now - animStart) / ANIM_DURATION, 1);

    const segCount = animSegments!.length;
    const scaled   = t * segCount;
    const segIdx   = Math.min(Math.floor(scaled), segCount - 1);
    const localT   = scaled - segIdx;
    const seg      = animSegments![segIdx]!;

    animPlayerXY = [
      bezier(localT, seg.fromX, seg.ctrlX, seg.toX),
      bezier(localT, seg.fromY, seg.ctrlY, seg.toY),
    ];
    renderBoard();

    if (t < 1) {
      animRafId = requestAnimationFrame(tick);
    } else {
      animSegments = null; animStart = null; animRafId = null;
      animPlayerXY = null; isAnimating = false;
      onComplete();
    }
  }

  animStart = null;
  animRafId = requestAnimationFrame(tick);
}

// --- Game logic ---

function playTile(): void {
  if (selectedIndex === null || preview === null || isAnimating) return;

  const { chain, finalPos } = preview;

  // Apply tile placement immediately so it shows during animation
  placedTiles.set(cellKey(playerPos.q, playerPos.r), hand[selectedIndex]!);

  // Record each step as a traveled path
  for (const step of chain) {
    const key = cellKey(step.q, step.r);
    const list = traveledPaths.get(key) ?? [];
    list.push([step.entry, step.exit]);
    traveledPaths.set(key, list);
  }

  // Update hand and selection
  hand.splice(selectedIndex, 1);
  hand.push(randomHexagonTile());
  selectedIndex = null;
  preview = null;
  renderHand();

  // Animate; update playerPos (or game-over) when done
  startAnimation(buildAnimSegments(chain), () => {
    if (finalPos === null) {
      triggerGameOver();
    } else {
      playerPos = finalPos;
      renderBoard();
    }
  });
}

function triggerGameOver(): void {
  gameOverEl.classList.add("visible");
  renderBoard(); // show final state
}

function restartGame(): void {
  placedTiles.clear();
  traveledPaths.clear();
  const outerConnectors = getOuterConnectors();
  playerPos = outerConnectors[Math.floor(Math.random() * outerConnectors.length)]!;
  hand = Array.from({ length: HAND_SIZE }, randomHexagonTile);
  selectedIndex = null;
  preview = null;
  gameOverEl.classList.remove("visible");
  renderBoard();
  renderHand();
}

// --- Board rendering ---

function renderBoard(): void {
  const w = boardCanvas.width;
  const h = boardCanvas.height;
  const originX = w / 2;
  const originY = h / 2;

  boardCtx.clearRect(0, 0, w, h);

  const previewChain = (!isAnimating && preview) ? preview.chain : [];
  const chainKeys = new Set(previewChain.map(s => cellKey(s.q, s.r)));
  const previewGameOver = preview !== null && preview.finalPos === null;

  for (const cell of cells) {
    const [cx, cy] = hexToPixel(cell.q, cell.r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;
    const placed   = placedTiles.get(cellKey(cell.q, cell.r));
    const isHovered = !isAnimating && hoveredCell?.q === cell.q && hoveredCell?.r === cell.r;
    const inChain   = chainKeys.has(cellKey(cell.q, cell.r));

    drawHexShape(boardCtx, px, py, HEX_SIZE,
      placed    ? COLORS.placedFill :
      isHovered ? COLORS.hexHover   : COLORS.hexFill,
      inChain && previewGameOver ? "#e9456088" :
      inChain                    ? "#53d8fb44" :
      placed                     ? COLORS.placedStroke : COLORS.hexStroke);

    if (placed) drawTilePaths(boardCtx, px, py, HEX_SIZE, placed);

    const traveled = traveledPaths.get(cellKey(cell.q, cell.r));
    if (traveled) {
      for (const [a, b] of traveled) drawPath(boardCtx, px, py, HEX_SIZE, a, b, COLORS.player, 3);
    }

    const previewStep = previewChain.find(s => s.q === cell.q && s.r === cell.r);
    if (previewStep) {
      boardCtx.globalAlpha = 0.5;
      drawPath(boardCtx, px, py, HEX_SIZE, previewStep.entry, previewStep.exit, COLORS.player, 3);
      boardCtx.globalAlpha = 1;
    }

    if (preview && !isAnimating && cell.q === playerPos.q && cell.r === playerPos.r) {
      boardCtx.globalAlpha = 0.45;
      drawTilePaths(boardCtx, px, py, HEX_SIZE, preview.tile);
      boardCtx.globalAlpha = 1;
    }

    drawConnectors(boardCtx, px, py, HEX_SIZE);
  }

  // Ghost player at predicted final position (preview only)
  if (preview?.finalPos && !isAnimating) {
    const fp = preview.finalPos;
    const [cx, cy] = hexToPixel(fp.q, fp.r, HEX_SIZE);
    const [gpx, gpy] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, fp.connectorId);
    boardCtx.globalAlpha = 0.4;
    boardCtx.beginPath();
    boardCtx.arc(gpx, gpy, CONNECTOR_RADIUS + 3, 0, Math.PI * 2);
    boardCtx.fillStyle = COLORS.player;
    boardCtx.fill();
    boardCtx.globalAlpha = 1;
  }

  // Animated or static player
  if (animPlayerXY) {
    const [apx, apy] = animPlayerXY;
    const r = CONNECTOR_RADIUS + 3;
    const grd = boardCtx.createRadialGradient(apx, apy, 0, apx, apy, r * 3);
    grd.addColorStop(0, COLORS.playerGlow + "cc");
    grd.addColorStop(1, COLORS.playerGlow + "00");
    boardCtx.beginPath();
    boardCtx.arc(apx, apy, r * 3, 0, Math.PI * 2);
    boardCtx.fillStyle = grd;
    boardCtx.fill();
    boardCtx.beginPath();
    boardCtx.arc(apx, apy, r, 0, Math.PI * 2);
    boardCtx.fillStyle = COLORS.player;
    boardCtx.fill();
  } else {
    drawPlayer(originX, originY);
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
  const isSelected = selectedIndex === index;
  drawHexShape(ctx, cx, cy, HAND_HEX_SIZE,
    isSelected ? "#1f3a6e" : COLORS.handFill,
    isSelected ? "#e94560" : COLORS.handStroke);
  drawTilePaths(ctx, cx, cy, HAND_HEX_SIZE, hand[index]!);
  drawConnectors(ctx, cx, cy, HAND_HEX_SIZE);
}

function updateMidButton(index: number): void {
  const btn = midButtons[index];
  if (!btn) return;
  const isSelected = selectedIndex === index;
  btn.textContent = isSelected ? "Play" : "Select";
  btn.className = isSelected ? "btn-play" : "btn-select";
}

function renderHand(): void {
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
      hand[i] = rotateTile(hand[i]!, -1);
      selectedIndex = i;
      computePreview();
      renderHand();
      renderBoard();
    });

    const btnMid = document.createElement("button");
    btnMid.textContent = "Select";
    btnMid.className = "btn-select";
    midButtons.push(btnMid);
    btnMid.addEventListener("click", () => {
      if (selectedIndex === i) {
        playTile();
      } else {
        selectedIndex = i;
        computePreview();
        renderHand();
        renderBoard();
      }
    });

    const btnRight = document.createElement("button");
    btnRight.textContent = "↻";
    btnRight.title = "Rotate right";
    btnRight.addEventListener("click", () => {
      hand[i] = rotateTile(hand[i]!, 1);
      selectedIndex = i;
      computePreview();
      renderHand();
      renderBoard();
    });

    controls.append(btnLeft, btnMid, btnRight);
    slot.append(canvas, controls);
    panel.append(slot);
  }
}

// --- Input ---

function pixelToHex(px: number, py: number): HexCell | null {
  const originX = boardCanvas.width / 2;
  const originY = boardCanvas.height / 2;
  const x = px - originX;
  const y = py - originY;
  const q = (2 / 3) * x / HEX_SIZE;
  const r = (-(1 / 3) * x + (Math.sqrt(3) / 3) * y) / HEX_SIZE;
  return cubeRound(q, r);
}

function cubeRound(fq: number, fr: number): HexCell | null {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  if (!isInGrid(q, r)) return null;
  return { q, r };
}

boardCanvas.addEventListener("mousemove", (e: MouseEvent) => {
  hoveredCell = pixelToHex(e.offsetX, e.offsetY);
  renderBoard();
});

window.addEventListener("resize", () => {
  boardCanvas.width = boardCanvas.clientWidth;
  boardCanvas.height = boardCanvas.clientHeight;
  renderBoard();
  renderHand();
});

// --- Init ---

buildHandSlots();
boardCanvas.width = boardCanvas.clientWidth;
boardCanvas.height = boardCanvas.clientHeight;
restartGame();
renderHand();
