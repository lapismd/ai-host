# TypeScript architecture and enforcement

**Status:** P0 landed. P1 folders landed. P2 extraction remains. Canonical
requirements live in `spec/src`.

**Kind of statements:** **Fact** is observed in this checkout. **Recommendation**
is a chosen policy. Organisation plans under `docs/plans/` are not canonical.

## Recommendation

`@lapismd/ai-host` is a single TypeScript transport library whose production
source is still mostly a **flat `src/`**. The failure mode is a few composition
files that absorb every new concern, plus no machine gate on size or layering.

Chosen approach:

1. Do not introduce nested workspace packages, a generic layered architecture
   tree, or ESLint `max-lines`.
2. Reuse the nostr-agent-controller / lapis-community architecture checker.
   Rewrite `architecture-policy.mjs` for this package. Do not publish a shared
   npm checker.
3. Land a no-new-debt ratchet first (P0) on the current flat tree. Then move
   cohesive files into feature folders (P1). Then extract executor, tool-bridge,
   client, and ws-server.

Public contracts stay stable: root `dist/index.js`, `./client`, and
`./file-tools`. `src/client.ts` remains the `./client` entry facade.

## Target folders

```text
src/
  index.ts                 # public barrel
  client.ts                # public ./client facade
  protocol/                # protocol.ts, replay-buffer.ts
  acp/                     # agent registry, session options, model catalog
  inventory/               # agent CLI/app-server model lists
  executor/                # ACP runtime + volatile session store
  mcp/                     # tool-bridge, stdio shim
  ws/                      # serve, ws-server, token
  file-tools/              # keep; algorithm-only
```

## Phases

- **P0.** AH-ARCH-001, this plan, checker, baseline, `pnpm check:architecture`.
  No production moves.
- **P1.** Mechanical move into the folders above. Keep spec-first prefixes for
  old and new paths.
- **P2.** Extract `executor.ts`, then `tool-bridge.ts`, `client.ts`, and
  `ws-server.ts` until new production files stay at or under 300 counted lines.

## Import matrix (summary)

- `file-tools` must not import protocol, acp, inventory, executor, mcp, or ws.
- `inventory` may type-import executor until catalog types move into acp.
- `executor` may import protocol, acp, inventory, and mcp.
- `ws` may import protocol, acp, and executor, and may type-import mcp.
- Composition roots (`src/index.ts`, `bin/lapis-mcp-shim.mjs`) may import
  features.
