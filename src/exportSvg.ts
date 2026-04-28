import type { GameState, ConnectorId, ConnectorTile, BoardConnector } from "./types.js";
import { HEX_SIZE, hexVertices, hexToPixel, connectorPosition } from "./hex.js";
import { followConnection } from "./playTile.js";

const SVG_COLORS = {
    hexFill: "#16213e",
    hexStroke: "#0f3460",
    placedFill: "#0d1b35",
    placedStroke: "#1a4080",
    connector: "#ffd700",
    path: "#53d8fb",
    deadPath: "#3a3a52",
    closedLoop: "#252530",
};

const SVG_CONNECTOR_RADIUS = 3.5;

function cellKey(q: number, r: number): string { return `${q},${r}`; }

function hexVerticesToSvgPoints(cx: number, cy: number, size: number): string {
    return hexVertices(cx, cy, size).map(v => `${v[0]},${v[1]}`).join(" ");
}

function svgQuadraticPath(p1: [number, number], cp: [number, number], p2: [number, number]): string {
    return `M${p1[0]},${p1[1]} Q${cp[0]},${cp[1]} ${p2[0]},${p2[1]}`;
}

function mixColorsSvg(colors: string[]): string {
    if (colors.length === 0) return "#ffffff";
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

/**
 * Renders the current game board state to an SVG string.
 */
export function renderGameStateToSvgString(state: GameState, width: number, height: number): string {
    const originX = width / 2;
    const originY = height / 2;
    const svgElements: string[] = [];

    // Background
    svgElements.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0a0a1a"/>`);

    const getPixelPos = (q: number, r: number, id: ConnectorId): [number, number] => {
        const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
        return connectorPosition(originX + cx, originY + cy, HEX_SIZE, id);
    };

    const placedMap = new Map<string, ConnectorTile>();
    for (const entry of state.board.tiles) {
        if (entry.tile.kind === "connector") {
            placedMap.set(cellKey(entry.coord.q, entry.coord.r), entry.tile);
        }
    }

    // 1. Render Hex Grid
    for (const entry of state.board.tiles) {
        if (entry.tile.kind === "removed") continue;
        const { q, r } = entry.coord;
        const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
        const px = originX + cx;
        const py = originY + cy;
        const fill = entry.tile.kind === "connector" ? SVG_COLORS.placedFill : SVG_COLORS.hexFill;
        const stroke = entry.tile.kind === "connector" ? SVG_COLORS.placedStroke : SVG_COLORS.hexStroke;
        svgElements.push(`<polygon points="${hexVerticesToSvgPoints(px, py, HEX_SIZE)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    }

    // 2. Map board topology for path tracing
    const boardConnByPos = new Map<string, BoardConnector>();
    for (const conn of state.board.connectors) {
        const add = (q: number, r: number, c: ConnectorId) => boardConnByPos.set(`${q},${r},${c}`, conn);
        if (conn.kind === "outer_rim") add(conn.position.coord.q, conn.position.coord.r, conn.position.connectorId);
        else if (conn.kind === "tile_tile") {
            add(conn.a.coord.q, conn.a.coord.r, conn.a.connectorId);
            add(conn.b.coord.q, conn.b.coord.r, conn.b.connectorId);
        } else {
            add(conn.from.coord.q, conn.from.coord.r, conn.from.connectorId);
            add(conn.to.coord.q, conn.to.coord.r, conn.to.connectorId);
        }
    }

    // 3. Collect move history for coloring
    const visited = new Set<string>();
    const historyStepMap = new Map<string, Set<number>>();
    for (const player of state.board.players) {
        const turns = (!player.isAlive && state.options.mode === "standard" && state.options.collisionMode === "die")
            ? player.history.turns.slice(0, -1) : player.history.turns;
        for (const turn of turns) {
            for (const step of turn.steps) {
                const k1 = `${step.coord.q},${step.coord.r},${step.entry},${step.exit}`;
                const k2 = `${step.coord.q},${step.coord.r},${step.exit},${step.entry}`;
                if (!historyStepMap.has(k1)) historyStepMap.set(k1, new Set());
                if (!historyStepMap.has(k2)) historyStepMap.set(k2, new Set());
                historyStepMap.get(k1)!.add(player.index);
                historyStepMap.get(k2)!.add(player.index);
            }
        }
    }

    // 4. Trace and render paths
    for (const conn of state.board.connectors) {
        const starts = [];
        if (conn.kind === "outer_rim") starts.push(conn.position);
        else if (conn.kind === "tile_tile") { starts.push(conn.a); starts.push(conn.b); }
        else { starts.push(conn.from); starts.push(conn.to); }

        for (const start of starts) {
            if (visited.has(`${start.coord.q},${start.coord.r},${start.connectorId}`)) continue;
            let q = start.coord.q, r = start.coord.r, cid = start.connectorId;
            const arcs = [];
            while (true) {
                const tile = placedMap.get(cellKey(q, r));
                if (!tile) break;
                const exit = followConnection(tile, cid);
                if (exit === undefined || visited.has(`${q},${r},${cid}`)) break;
                visited.add(`${q},${r},${cid}`); visited.add(`${q},${r},${exit}`);
                arcs.push({ q, r, entry: cid, exit });
                const link = boardConnByPos.get(`${q},${r},${exit}`);
                if (!link || link.kind === "outer_rim") break;
                const next = (link.kind === "tile_tile")
                    ? ((link.a.coord.q === q && link.a.coord.r === r && link.a.connectorId === exit) ? link.b : link.a)
                    : ((link.from.coord.q === q && link.from.coord.r === r && link.from.connectorId === exit) ? link.to : link.from);
                q = next.coord.q; r = next.coord.r; cid = next.connectorId;
            }

            if (arcs.length > 0) {
                const owners = new Set<number>();
                for (const arc of arcs) {
                    const s = historyStepMap.get(`${arc.q},${arc.r},${arc.entry},${arc.exit}`);
                    if (s) s.forEach(pi => owners.add(pi));
                }
                const color = owners.size > 0 ? mixColorsSvg([...owners].map(pi => state.board.players[pi]!.color)) : SVG_COLORS.connector;
                for (const arc of arcs) {
                    const [cx, cy] = hexToPixel(arc.q, arc.r, HEX_SIZE);
                    const [ax, ay] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, arc.entry);
                    const [bx, by] = connectorPosition(originX + cx, originY + cy, HEX_SIZE, arc.exit);
                    svgElements.push(`<path d="${svgQuadraticPath([ax, ay], [originX + cx, originY + cy], [bx, by])}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`);
                }
            }
        }
    }

    // 5. Render Player Markers
    for (const player of state.board.players) {
        const { coord, connectorId } = player.position;
        const [mx, my] = getPixelPos(coord.q, coord.r, connectorId);
        svgElements.push(`<circle cx="${mx}" cy="${my}" r="${SVG_CONNECTOR_RADIUS + 3}" fill="${player.color}"/>`);
    }

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${svgElements.join("")}</svg>`;
}

export function downloadSvgReplay(state: GameState, width: number, height: number): void {
    const svgString = renderGameStateToSvgString(state, width, height);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hexagon_replay_${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}