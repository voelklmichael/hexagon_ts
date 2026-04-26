import type { GameState, ConnectorTile, ConnectorId } from "./types.js";
import {
  HEX_SIZE, hexVertices, hexToPixel, edgeConnectors,
  connectorPosition, mirrorConnector, EDGE_NEIGHBOR,
} from "./hex.js";

const COLORS = {
  hexFill: "#16213e",
  hexStroke: "#0f3460",
  placedFill: "#0d1b35",
  placedStroke: "#1a4080",
  connector: "#e94560",
  path: "#53d8fb",
  deadPath: "#3a3a52",
  longMovement: "#ffd93d",
};

const CONNECTOR_RADIUS = 3.5;

function cellKey(q: number, r: number): string { return `${q},${r}`; }

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

function drawConnectorDot(ctx: CanvasRenderingContext2D, mx: number, my: number): void {
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

function drawLongMovement(
  ctx: CanvasRenderingContext2D,
  originX: number, originY: number,
  fromX: number, fromY: number,
  toX: number, toY: number,
): void {
  // Control point pushed outward from the board centre so the arc clears the rim.
  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2;
  const dx = mx - originX;
  const dy = my - originY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const cpx = mx + (dx / len) * 44;
  const cpy = my + (dy / len) * 44;

  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = COLORS.longMovement;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(cpx, cpy, toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function followConnection(tile: ConnectorTile, entry: ConnectorId): ConnectorId {
  for (const [a, b] of tile.connections) {
    if (a === entry) return b;
    if (b === entry) return a;
  }
  throw new Error(`connector ${entry} not found in tile`);
}

export function renderGameState(
  state: GameState,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const { board, options } = state;
  const originX = width / 2;
  const originY = height / 2;

  ctx.clearRect(0, 0, width, height);

  // Build lookup structures from the tile list
  const placedMap = new Map<string, ConnectorTile>();
  const cellSet = new Set<string>();
  for (const entry of board.tiles) {
    if (entry.tile.kind === "removed") continue;
    const key = cellKey(entry.coord.q, entry.coord.r);
    cellSet.add(key);
    if (entry.tile.kind === "connector") placedMap.set(key, entry.tile);
  }

  // Flood-fill to find live (reachable) connectors for dead-path highlighting.
  // Seeds: connectors on placed tiles whose edge faces an empty cell.
  const liveConnectors = new Set<string>();
  if (options.highlightDeadPaths) {
    const lk = (q: number, r: number, c: ConnectorId) => `${q},${r},${c}`;
    const queue: Array<{ q: number; r: number; c: ConnectorId }> = [];

    for (const [key, _] of placedMap) {
      const [qs, rs] = key.split(",").map(Number) as [number, number];
      for (let edge = 0; edge < 6; edge++) {
        const [dq, dr] = EDGE_NEIGHBOR[edge]!;
        const nk = cellKey(qs + dq, rs + dr);
        if (cellSet.has(nk) && !placedMap.has(nk)) {
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

      const tile = placedMap.get(cellKey(item.q, item.r));
      if (!tile) continue;

      const paired = followConnection(tile, item.c);
      queue.push({ q: item.q, r: item.r, c: paired });

      for (const c of [item.c, paired] as ConnectorId[]) {
        const edge = Math.floor(c / 2);
        const [dq, dr] = EDGE_NEIGHBOR[edge]!;
        const nq = item.q + dq, nr = item.r + dr;
        if (placedMap.has(cellKey(nq, nr))) {
          queue.push({ q: nq, r: nr, c: mirrorConnector(c) });
        }
      }
    }
  }

  // Draw each cell
  for (const entry of board.tiles) {
    if (entry.tile.kind === "removed") continue;
    const { q, r } = entry.coord;
    const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;
    const placed = entry.tile.kind === "connector" ? entry.tile : null;

    drawHexShape(ctx, px, py, HEX_SIZE,
      placed ? COLORS.placedFill : COLORS.hexFill,
      placed ? COLORS.placedStroke : COLORS.hexStroke,
    );

    if (placed) {
      for (const [a, b] of placed.connections) {
        const live = !options.highlightDeadPaths ||
          (liveConnectors.has(`${q},${r},${a}`) && liveConnectors.has(`${q},${r},${b}`));
        drawPath(ctx, px, py, HEX_SIZE, a, b, live ? COLORS.path : COLORS.deadPath);
      }
    }

    // Each player's traveled paths in their color
    for (const player of board.players) {
      for (const step of player.history.steps) {
        if (step.coord.q !== q || step.coord.r !== r) continue;
        drawPath(ctx, px, py, HEX_SIZE, step.entry, step.exit, player.color, 3);
      }
    }

    // Connector dots on inner edges, X markers on outer edges
    for (let edge = 0; edge < 6; edge++) {
      const [cA, cB] = edgeConnectors(px, py, HEX_SIZE, edge);
      const [dq, dr] = EDGE_NEIGHBOR[edge]!;
      const isOuter = !cellSet.has(cellKey(q + dq, r + dr));
      if (isOuter) {
        const angle = (edge * 60 + 30) * (Math.PI / 180);
        drawXMarker(ctx, cA[0], cA[1], angle);
        drawXMarker(ctx, cB[0], cB[1], angle);
      } else {
        drawConnectorDot(ctx, cA[0], cA[1]);
        drawConnectorDot(ctx, cB[0], cB[1]);
      }
    }
  }

  // LongMovement connectors — dashed arcs outside the board rim
  for (const conn of board.connectors) {
    if (conn.kind !== "long_movement") continue;
    const [fcx, fcy] = hexToPixel(conn.from.coord.q, conn.from.coord.r, HEX_SIZE);
    const [fromX, fromY] = connectorPosition(originX + fcx, originY + fcy, HEX_SIZE, conn.from.connectorId);
    const [tcx, tcy] = hexToPixel(conn.to.coord.q, conn.to.coord.r, HEX_SIZE);
    const [toX, toY] = connectorPosition(originX + tcx, originY + tcy, HEX_SIZE, conn.to.connectorId);
    drawLongMovement(ctx, originX, originY, fromX, fromY, toX, toY);
  }

  // Player markers at their current positions
  for (const player of board.players) {
    if (!player.isAlive) continue;
    const { coord, connectorId } = player.position;
    const [cx, cy] = hexToPixel(coord.q, coord.r, HEX_SIZE);
    const [mpx, mpy] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, connectorId);
    drawMarker(ctx, mpx, mpy, player.color);
  }
}
