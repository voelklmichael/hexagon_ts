import { HEX_SIZE, HexCell, hexVertices, hexToPixel, edgeConnectors, generateGrid } from "./hex.js";

const COLORS = {
  hexFill: "#16213e",
  hexStroke: "#0f3460",
  hexHover: "#1f4080",
  handFill: "#1a2a4a",
  handStroke: "#2255aa",
  connector: "#e94560",
  connectorGlow: "#ff6b8a",
};

const CONNECTOR_RADIUS = 5;
const GRID_RADIUS = 3;
const HAND_HEX_SIZE = 52;
const HAND_SIZE = 3;

const boardCanvas = document.getElementById("game") as HTMLCanvasElement;
const boardCtx = boardCanvas.getContext("2d")!;

const handCanvas = document.getElementById("hand") as HTMLCanvasElement;
const handCtx = handCanvas.getContext("2d")!;

const cells = generateGrid(GRID_RADIUS);
let hoveredCell: HexCell | null = null;

function resize(): void {
  const handPanel = document.getElementById("hand-panel")!;
  const boardPanel = document.getElementById("board-panel")!;
  handCanvas.width = handPanel.clientWidth;
  handCanvas.height = handPanel.clientHeight;
  boardCanvas.width = boardPanel.clientWidth;
  boardCanvas.height = boardPanel.clientHeight;
}

// --- Shared drawing helpers ---

function drawHexShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fillColor: string, strokeColor: string
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

// --- Board ---

function renderBoard(): void {
  const w = boardCanvas.width;
  const h = boardCanvas.height;
  const originX = w / 2;
  const originY = h / 2;

  boardCtx.clearRect(0, 0, w, h);

  for (const cell of cells) {
    const [cx, cy] = hexToPixel(cell.q, cell.r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;
    const isHovered = hoveredCell !== null && hoveredCell.q === cell.q && hoveredCell.r === cell.r;

    drawHexShape(boardCtx, px, py, HEX_SIZE,
      isHovered ? COLORS.hexHover : COLORS.hexFill,
      COLORS.hexStroke);
    drawConnectors(boardCtx, px, py, HEX_SIZE);
  }
}

// --- Hand ---

function renderHand(): void {
  const w = handCanvas.width;
  const h = handCanvas.height;

  handCtx.clearRect(0, 0, w, h);

  const slotHeight = h / HAND_SIZE;
  const cx = w / 2;

  for (let i = 0; i < HAND_SIZE; i++) {
    const cy = slotHeight * i + slotHeight / 2;
    drawHexShape(handCtx, cx, cy, HAND_HEX_SIZE, COLORS.handFill, COLORS.handStroke);
    drawConnectors(handCtx, cx, cy, HAND_HEX_SIZE);
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
  if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > GRID_RADIUS) return null;
  return { q, r };
}

boardCanvas.addEventListener("mousemove", (e: MouseEvent) => {
  hoveredCell = pixelToHex(e.offsetX, e.offsetY);
  renderBoard();
});

window.addEventListener("resize", () => {
  resize();
  renderBoard();
  renderHand();
});

resize();
renderBoard();
renderHand();
