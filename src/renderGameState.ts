import type { GameState, ConnectorTile, ConnectorId, TileCoord } from "./types.js";
import {
  HEX_SIZE, hexVertices, hexToPixel,
  connectorPosition,
} from "./hex.js";
import { playTile } from "./playTile.js";

const COLORS = {
  hexFill: "#16213e",
  hexStroke: "#0f3460",
  placedFill: "#0d1b35",
  placedStroke: "#1a4080",
  connector: "#ffd700",
  path: "#53d8fb",
  deadPath: "#3a3a52",
  closedLoop: "#252530",
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

function drawConnectorDot(ctx: CanvasRenderingContext2D, mx: number, my: number, color: string): void {
  const grd = ctx.createRadialGradient(mx, my, 0, mx, my, CONNECTOR_RADIUS * 2.5);
  grd.addColorStop(0, color + "cc");
  grd.addColorStop(1, color + "00");
  ctx.beginPath();
  ctx.arc(mx, my, CONNECTOR_RADIUS * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx, my, CONNECTOR_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawXMarker(ctx: CanvasRenderingContext2D, mx: number, my: number, angle: number, color: string): void {
  const arm = CONNECTOR_RADIUS * 1.6;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
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

function drawStartMarker(
  ctx: CanvasRenderingContext2D,
  mx: number, my: number,
  hexCx: number, hexCy: number,
  color: string,
): void {
  const r = CONNECTOR_RADIUS + 3;

  // Filled circle at the start position
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#ffffff44";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Arrow pointing inward toward the hex center
  const dx = hexCx - mx;
  const dy = hexCy - my;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  const shaftStart = r + 3;
  const shaftEnd = shaftStart + 18;
  const headLen = 8;
  const headAngle = Math.PI / 5;
  const angle = Math.atan2(ny, nx);
  const tipX = mx + nx * shaftEnd;
  const tipY = my + ny * shaftEnd;

  ctx.beginPath();
  ctx.moveTo(mx + nx * shaftStart, my + ny * shaftStart);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(angle - headAngle), tipY - headLen * Math.sin(angle - headAngle));
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(angle + headAngle), tipY - headLen * Math.sin(angle + headAngle));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
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

function interpolateQuadratic(a: [number, number], cp: [number, number], b: [number, number], t: number): [number, number] {
  const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cp[0] + t * t * b[0];
  const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cp[1] + t * t * b[1];
  return [x, y];
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

function mixColors(colors: string[]): string {
  if (colors.length === 1) return colors[0]!;
  let r = 0, g = 0, b = 0;
  for (const c of colors) {
    r += parseInt(c.slice(1, 3), 16);
    g += parseInt(c.slice(3, 5), 16);
    b += parseInt(c.slice(5, 7), 16);
  }
  const n = colors.length;
  return `#${Math.round(r / n).toString(16).padStart(2, "0")}${Math.round(g / n).toString(16).padStart(2, "0")}${Math.round(b / n).toString(16).padStart(2, "0")}`;
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
  animationProgress: number = 1.0,
): void {
  const originX = width / 2;
  const originY = height / 2;

  ctx.clearRect(0, 0, width, height);

  let board = state.board;
  {
    let selected_tile = null;
    if (state.currentPlayer.selectedTileIndex != null) {
      selected_tile
        = state.board.players[state.currentPlayer.playerIndex]?.hand[state.currentPlayer.selectedTileIndex];
    } if (selected_tile != null) {
      board = playTile(state.board, state.currentPlayer.playerIndex, selected_tile, 0, state.options.collisionMode);
    }
  }

  const placedMap = new Map<string, ConnectorTile>();
  for (const entry of board.tiles) {
    if (entry.tile.kind === "connector") {
      placedMap.set(cellKey(entry.coord.q, entry.coord.r), entry.tile);
    }
  }

  // Hex shapes
  for (const entry of board.tiles) {
    if (entry.tile.kind === "removed") continue;
    const { q, r } = entry.coord;
    const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
    const px = originX + cx;
    const py = originY + cy;

    const currentPlayer = state.board.players[state.currentPlayer.playerIndex];
    const currentCoord = currentPlayer?.position.coord;
    const isCurrentPlayerTile =
      currentCoord !== undefined &&
      q === currentCoord.q &&
      r === currentCoord.r;


    let fill: string;
    if (isCurrentPlayerTile && state.options.previewMoves) {
      fill = "#8b4513"; // brown
    } else if (entry.tile.kind === "connector") {
      fill = COLORS.placedFill;
    } else {
      fill = COLORS.hexFill;
    }

    drawHexShape(ctx, px, py, HEX_SIZE, fill, entry.tile.kind === "connector" ? COLORS.placedStroke : COLORS.hexStroke);
  }

  // "q,r,connId" → board connector — used to cross tile boundaries while tracing
  const boardConnByPos = new Map<string, (typeof board.connectors)[number]>();
  for (const conn of board.connectors) {
    const add = (q: number, r: number, c: ConnectorId) => boardConnByPos.set(`${q},${r},${c}`, conn);
    switch (conn.kind) {
      case "outer_rim": add(conn.position.coord.q, conn.position.coord.r, conn.position.connectorId); break;
      case "tile_tile": add(conn.a.coord.q, conn.a.coord.r, conn.a.connectorId);
        add(conn.b.coord.q, conn.b.coord.r, conn.b.connectorId); break;
      case "teleporter":
      case "long_movement": add(conn.from.coord.q, conn.from.coord.r, conn.from.connectorId);
        add(conn.to.coord.q, conn.to.coord.r, conn.to.connectorId); break;
    }
  }

  const addStep = (map: Map<string, Set<number>>, key: string, pi: number) => {
    const s = map.get(key);
    if (s) s.add(pi); else map.set(key, new Set([pi]));
  };

  // "q,r,entry,exit" → set of player indices, real history only (state.board)
  // In "die" collision mode, dead players' last turn (the death turn) is excluded.
  const historyStepMap = new Map<string, Set<number>>();
  for (let pi = 0; pi < state.board.players.length; pi++) {
    const player = state.board.players[pi]!;
    const turns = (!player.isAlive && state.options.collisionMode === "die")
      ? player.history.turns.slice(0, -1)
      : player.history.turns;
    for (const turn of turns) {
      for (const step of turn.steps) {
        addStep(historyStepMap, `${step.coord.q},${step.coord.r},${step.entry},${step.exit}`, pi);
        addStep(historyStepMap, `${step.coord.q},${step.coord.r},${step.exit},${step.entry}`, pi);
      }
    }
  }

  // "q,r,entry,exit" → set of player indices, including preview turn (board)
  const previewStepMap = new Map<string, Set<number>>();
  for (let pi = 0; pi < board.players.length; pi++) {
    for (const turn of board.players[pi]!.history.turns) {
      for (const step of turn.steps) {
        addStep(previewStepMap, `${step.coord.q},${step.coord.r},${step.entry},${step.exit}`, pi);
        addStep(previewStepMap, `${step.coord.q},${step.coord.r},${step.exit},${step.entry}`, pi);
      }
    }
  }

  type Arc = { q: number; r: number; entry: ConnectorId; exit: ConnectorId };
  type RimEnd = { q: number; r: number; connectorId: ConnectorId };

  const visited = new Set<string>();
  const rimHandled = new Set<string>();

  // Follow a chain of tile arcs starting from (q, r, connId), crossing tile_tile
  // boundaries until an outer_rim connector is reached or the chain ends.
  const traceChain = (startQ: number, startR: number, startConnId: ConnectorId): { arcs: Arc[]; rimEnds: RimEnd[] } => {
    const arcs: Arc[] = [];
    const rimEnds: RimEnd[] = [];
    let q = startQ, r = startR, connId = startConnId;

    while (true) {
      if (visited.has(`${q},${r},${connId}`)) break;
      const tile = placedMap.get(cellKey(q, r));
      if (!tile) break;

      const paired = followConnection(tile, connId);
      visited.add(`${q},${r},${connId}`);
      visited.add(`${q},${r},${paired}`);
      arcs.push({ q, r, entry: connId, exit: paired });

      const next = boardConnByPos.get(`${q},${r},${paired}`);
      if (next?.kind === "outer_rim") {
        rimEnds.push({ q, r, connectorId: paired });
        break;
      } else if (next?.kind === "tile_tile") {
        const other = (next.a.coord.q === q && next.a.coord.r === r && next.a.connectorId === paired)
          ? next.b : next.a;
        q = other.coord.q; r = other.coord.r; connId = other.connectorId;
      } else {
        break; // teleporter, long_movement, or no connector (empty neighbour)
      }
    }

    return { arcs, rimEnds };
  };

  for (const conn of [...board.connectors].sort((a, b) => (a.kind === "outer_rim" ? -1 : b.kind === "outer_rim" ? 1 : 0))) {
    const starts: Array<{ q: number; r: number; connId: ConnectorId; isRim: boolean }> = [];
    switch (conn.kind) {
      case "outer_rim":
        starts.push({ q: conn.position.coord.q, r: conn.position.coord.r, connId: conn.position.connectorId, isRim: true });
        break;
      case "tile_tile":
        starts.push({ q: conn.a.coord.q, r: conn.a.coord.r, connId: conn.a.connectorId, isRim: false });
        starts.push({ q: conn.b.coord.q, r: conn.b.coord.r, connId: conn.b.connectorId, isRim: false });
        break;
      case "teleporter":
      case "long_movement":
        starts.push({ q: conn.from.coord.q, r: conn.from.coord.r, connId: conn.from.connectorId, isRim: false });
        starts.push({ q: conn.to.coord.q, r: conn.to.coord.r, connId: conn.to.connectorId, isRim: false });
        break;
    }

    for (const { q, r, connId, isRim } of starts) {
      if (visited.has(`${q},${r},${connId}`)) continue;

      const { arcs, rimEnds } = traceChain(q, r, connId);
      if (arcs.length === 0) continue;

      const allRimEnds: RimEnd[] = isRim ? [{ q, r, connectorId: connId }, ...rimEnds] : rimEnds;

      // Collect all owning players — history (full color) takes priority over preview-only (translucent)
      const historyOwners = new Set<number>();
      for (const arc of arcs) {
        const s = historyStepMap.get(`${arc.q},${arc.r},${arc.entry},${arc.exit}`);
        if (s) for (const pi of s) historyOwners.add(pi);
      }
      const previewOnlyOwners = new Set<number>();
      if (historyOwners.size === 0) {
        for (const arc of arcs) {
          const s = previewStepMap.get(`${arc.q},${arc.r},${arc.entry},${arc.exit}`);
          if (s) for (const pi of s) previewOnlyOwners.add(pi);
        }
      }

      const ownerIdx = historyOwners.size > 0 ? [...historyOwners][0]! : previewOnlyOwners.size > 0 ? [...previewOnlyOwners][0]! : -1;
      const arcColor = historyOwners.size > 0
        ? mixColors([...historyOwners].map(pi => board.players[pi]!.color))
        : previewOnlyOwners.size > 0
          ? mixColors([...previewOnlyOwners].map(pi => board.players[pi]!.color)) + "aa"
          : allRimEnds.length === 0 ? "#ffd700" : "#888888";

      for (const arc of arcs) {
        const [cx, cy] = hexToPixel(arc.q, arc.r, HEX_SIZE);
        drawPath(ctx, originX + cx, originY + cy, HEX_SIZE, arc.entry, arc.exit, arcColor);
      }

      for (const rim of allRimEnds) {
        rimHandled.add(`${rim.q},${rim.r},${rim.connectorId}`);
        const [cx, cy] = hexToPixel(rim.q, rim.r, HEX_SIZE);
        const [mx, my] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, rim.connectorId);
        if (ownerIdx >= 0) {
          drawConnectorDot(ctx, mx, my, "#ffd700");
        } else {
          const edge = Math.floor(rim.connectorId / 2);
          drawXMarker(ctx, mx, my, (edge * 60 + 30) * (Math.PI / 180), "#e94560");
        }
      }
    }
  }

  // Outer rim connectors on empty (unplaced) cells — always red X
  for (const conn of board.connectors) {
    if (conn.kind !== "outer_rim") continue;
    const { coord, connectorId } = conn.position;
    if (rimHandled.has(`${coord.q},${coord.r},${connectorId}`)) continue;
    const [cx, cy] = hexToPixel(coord.q, coord.r, HEX_SIZE);
    const [mx, my] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, connectorId);
    const edge = Math.floor(connectorId / 2);
    drawXMarker(ctx, mx, my, (edge * 60 + 30) * (Math.PI / 180), "#e94560");
  }

  const getPixelPos = (q: number, r: number, id: ConnectorId): [number, number] => {
    const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
    return connectorPosition(originX + cx, originY + cy, HEX_SIZE, id);
  };

  // Player positions
  for (const player of state.board.players) {
    //player.history.turns
    if (!player.isAlive) continue;

    const lastTurn = player.history.turns[player.history.turns.length - 1];
    let markerPos: [number, number] | null = null;

    if (animationProgress < 1.0 && lastTurn != null) {
      const totalWeight = lastTurn.steps.reduce((acc, s) => acc + s.weight, 0);
      const targetWeight = animationProgress * totalWeight;
      let currentWeight = 0;

      for (let i = 0; i < lastTurn.steps.length; i++) {
        const step = lastTurn.steps[i]!;
        if (currentWeight + step.weight >= targetWeight) {
          const progressInStep = (targetWeight - currentWeight) / step.weight;
          const entryPos = getPixelPos(step.coord.q, step.coord.r, step.entry);
          const exitPos = getPixelPos(step.coord.q, step.coord.r, step.exit);
          const [hexX, hexY] = hexToPixel(step.coord.q, step.coord.r, HEX_SIZE);
          const center = [originX + hexX, originY + hexY] as [number, number];

          if (step.weight > 1) {
            const linkWeight = step.weight - 1;
            const linkProgressThreshold = linkWeight / step.weight;
            if (progressInStep < linkProgressThreshold) {
              const prevStep = lastTurn.steps[i - 1];
              const prevPos = prevStep
                ? getPixelPos(prevStep.coord.q, prevStep.coord.r, prevStep.exit)
                : getPixelPos(player.history.startPosition.coord.q, player.history.startPosition.coord.r, player.history.startPosition.connectorId);
              const t = progressInStep / linkProgressThreshold;
              const mx = (prevPos[0] + entryPos[0]) / 2;
              const my = (prevPos[1] + entryPos[1]) / 2;
              const dx = mx - originX;
              const dy = my - originY;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const cpx = mx + (dx / len) * 44;
              const cpy = my + (dy / len) * 44;
              markerPos = interpolateQuadratic(prevPos, [cpx, cpy], entryPos, t);
            } else {
              const t = (progressInStep - linkProgressThreshold) / (1 - linkProgressThreshold);
              markerPos = interpolateQuadratic(entryPos, center, exitPos, t);
            }
          } else {
            markerPos = interpolateQuadratic(entryPos, center, exitPos, progressInStep);
          }
          break;
        }
        currentWeight += step.weight;
      }
    }

    let current_position = player.position;
    const { coord, connectorId } = current_position;
    const [mx, my] = getPixelPos(coord.q, coord.r, connectorId);

    if (markerPos) {
      drawMarker(ctx, markerPos[0], markerPos[1], player.color);
    } else {
      drawMarker(ctx, mx, my, player.color);
    }

    const { coord: sc, connectorId: scId } = player.history.startPosition;
    const spx = originX + hexToPixel(sc.q, sc.r, HEX_SIZE)[0];
    const spy = originY + hexToPixel(sc.q, sc.r, HEX_SIZE)[1];
    const [smx, smy] = connectorPosition(spx, spy, HEX_SIZE, scId);

    drawStartMarker(ctx, smx, smy, spx, spy, player.color);

    let next_position = board.players[player.index]!.position;
    if (animationProgress === 1.0 && current_position != next_position && state.options.previewMoves) {
      const { coord: next_coord, connectorId: next_connectorId } = next_position;
      const [mx, my] = getPixelPos(next_coord.q, next_coord.r, next_connectorId);
      drawMarker(ctx, mx, my, player.color);
    }
  }

}
