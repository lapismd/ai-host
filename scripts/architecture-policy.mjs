/** Feature layers, composition-root globs, and the AH-ARCH-001 import matrix. */

export const LIMIT_KEYS = {
  production: "newProductionCountedLines",
  test: "newTestCountedLines",
  script: "newScriptCountedLines",
};

export const DEFAULT_LIMITS = {
  newProductionCountedLines: 300,
  newTestCountedLines: 500,
  newScriptCountedLines: 300,
};

const FEATURES = new Set([
  "protocol",
  "acp",
  "inventory",
  "executor",
  "mcp",
  "ws",
  "file-tools",
  "store",
  "cli",
  "controller",
  "testing",
]);

/** Filename owners while src/ is still flat (P0). Removed as files move in P1. */
export const FILE_LAYER = {
  "src/protocol.ts": "protocol",
  "src/replay-buffer.ts": "protocol",
  "src/token.ts": "ws",
  "src/client.ts": "ws",
  "src/ws-server.ts": "ws",
  "src/serve.ts": "ws",
  "src/executor.ts": "executor",
  "src/volatile-session-store.ts": "executor",
  "src/acp-agent.ts": "acp",
  "src/acp-session-options.ts": "acp",
  "src/acp-model-catalog.ts": "acp",
  "src/acp-model-inventory.ts": "inventory",
  "src/cursor-model-inventory.ts": "inventory",
  "src/codex-model-inventory.ts": "inventory",
  "src/opencode-model-inventory.ts": "inventory",
  "src/inventory-process.ts": "inventory",
  "src/tool-bridge.ts": "mcp",
  "src/mcp-shim.ts": "mcp",
  "src/mcp-shim-cli.ts": "mcp",
};

const COMPOSITION_FILES = new Set([
  "src/index.ts",
  "bin/lapis-mcp-shim.mjs",
]);

export const ALLOWED_DYNAMIC = new Set();

const R = "R";
const T = "T";
const X = "X";

const LAYERS = [
  "protocol",
  "acp",
  "inventory",
  "executor",
  "mcp",
  "ws",
  "file-tools",
  "store",
  "cli",
  "controller",
  "testing",
];

function row(cells) {
  return Object.fromEntries(LAYERS.map((layer, index) => [layer, cells[index]]));
}

/**
 * Rows import columns. file-tools must stay algorithm-only. cli→controller and
 * protocol→controller remain fatal so copied fixtures keep their meaning.
 */
export const MATRIX = {
  protocol: row([R, X, X, X, X, X, X, T, X, X, X]),
  acp: row([T, R, X, T, X, X, X, X, X, X, X]),
  inventory: row([X, R, R, T, X, X, X, X, X, X, X]),
  executor: row([R, R, R, R, R, X, X, X, X, X, X]),
  mcp: row([X, X, X, X, R, X, X, X, X, X, X]),
  ws: row([R, R, X, R, T, R, X, X, X, X, X]),
  "file-tools": row([X, X, X, X, X, X, R, X, X, X, X]),
  store: row([T, X, X, X, X, X, X, R, X, X, X]),
  cli: row([T, X, X, X, X, X, X, R, R, X, X]),
  controller: row([R, X, X, X, X, X, X, R, X, R, X]),
  testing: row([R, R, R, R, R, R, R, R, R, R, R]),
};

const FATAL_EDGES = new Set([
  "cli>controller",
  "protocol>controller",
  "file-tools>mcp",
  "file-tools>executor",
  "file-tools>ws",
  "file-tools>acp",
  "file-tools>inventory",
  "file-tools>protocol",
]);

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/u;

export function isSourceFile(name) {
  return SOURCE_EXT.test(name);
}

export function toPosix(relativePath) {
  return relativePath.split("\\").join("/");
}

export function isCompositionRoot(posixPath) {
  return COMPOSITION_FILES.has(posixPath);
}

export function fileKind(posixPath) {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(posixPath)) return "test";
  if (posixPath.startsWith("scripts/") || posixPath.startsWith("bin/"))
    return "script";
  return "production";
}

export function layerOf(posixPath) {
  const match = posixPath.match(/^src\/([^/]+)\//u);
  if (match) {
    if (match[1] === "__tests__") return "testing";
    if (FEATURES.has(match[1])) return match[1];
  }
  if (FILE_LAYER[posixPath]) return FILE_LAYER[posixPath];
  if (posixPath.startsWith("src/")) return "other";
  return "scripts";
}

export function isTestLike(posixPath) {
  return fileKind(posixPath) === "test";
}

export function isTestingPath(posixPath) {
  return (
    posixPath.startsWith("src/testing/") ||
    posixPath.startsWith("src/__tests__/") ||
    isTestLike(posixPath)
  );
}

export function matrixCell(fromLayer, toLayer) {
  if (fromLayer === "other" || fromLayer === "scripts") return R;
  if (toLayer === "other" || toLayer === "scripts") return R;
  return MATRIX[fromLayer]?.[toLayer] ?? X;
}

export function isPendingTypeEdge() {
  return false;
}

export function featureBarrel(posixPath) {
  const match = posixPath.match(/^(src\/[^/]+)\/index\.[cm]?[jt]sx?$/u);
  return match?.[1] ?? null;
}

export function isSelfBarrelImport(importer, imported) {
  const parent = importer.match(/^(src\/[^/]+)\//u)?.[1];
  if (!parent || parent === "src/__tests__") return false;
  if (importer === `${parent}/index.ts` || importer === `${parent}/index.js`)
    return false;
  return (
    imported === `${parent}/index.ts` || imported === `${parent}/index.js`
  );
}

export function isFatalEdge(fromLayer, toLayer) {
  return FATAL_EDGES.has(`${fromLayer}>${toLayer}`);
}

export const HOTSPOT_JUSTIFICATIONS = {
  "src/executor.ts":
    "ACP runtime orchestrator; extract catalog, session, MCP projection, permissions, and default runtime before adding behaviour",
  "src/executor/executor.ts":
    "ACP runtime facade; extract the responsibility you are changing",
  "src/tool-bridge.ts":
    "MCP broker; split types, HTTP/WebSocket contributions, and shim resolution before adding behaviour",
  "src/mcp/tool-bridge.ts":
    "MCP broker; split types, HTTP/WebSocket contributions, and shim resolution before adding behaviour",
  "src/client.ts":
    "Public ./client attach bridge; extract handshake and event fan-out before adding behaviour",
  "src/ws-server.ts":
    "WebSocket host; extract handshake and command routing before adding behaviour",
  "src/ws/ws-server.ts":
    "WebSocket host; extract handshake and command routing before adding behaviour",
  "src/executor.test.ts":
    "Executor suite; split with the extracted production boundary",
  "src/executor/executor.test.ts":
    "Executor suite; split with the extracted production boundary",
  "src/ws-contract.test.ts":
    "WebSocket contract suite; split with extracted host surfaces",
  "src/ws/ws-contract.test.ts":
    "WebSocket contract suite; split with extracted host surfaces",
  "scripts/ai-host-release.mjs":
    "Release automation; split only if a later change needs a named subset",
};
