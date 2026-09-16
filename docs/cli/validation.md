# Standalone CLI validation — 2026-09-16

This is implementation evidence, not release authorization. Package version is
still derived from `package.json`; the pending minor changeset has not been applied.

## Passed locally

- `pnpm spec:check`: specification, complete package test lane, mdBook and spec-first.
  Test result: 107 Vitest tests across 19 files; zero failures.
- `pnpm check`, `deno task check`, generated documentation equality, `pnpm build`.
- `pnpm pack --pack-destination .release/cli-acceptance`: actual public tarball.
  The normal `packages:pack` command also passed but was a no-op because 0.1.0
  is already published; it is not counted as tarball validation.
- `deno task build:all`: macOS/Linux arm64/x64 executables, SHA-256 checksums,
  package/transitive license notices, source revision and Deno 2.9.5 manifest.
- `deno task test:cli` on macOS arm64: copied binary outside the checkout,
  empty HOME/caches and no Node/Deno on PATH; authentication, real runtime,
  metadata inspection, token redaction, JSON/NDJSON, duplicate ownership,
  watched status, followed logs, crash recovery and graceful signal shutdown.
- The same compiled smoke passed with internet egress blocked by macOS sandbox,
  allowing loopback TCP and Unix sockets only. A control curl request to an
  internet endpoint failed under the same profile.

Offline smoke invocation (after build):

```sh
sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*") (remote unix-socket))' deno task test:cli
```

AI smoke compiles an external fixture ACP agent, completes a prompt, diagnoses a
missing external Codex executable without installing it, and exercises the
bundled MCP stdio subcommand. Terminal smoke creates a real PTY, writes bytes,
resizes, restores output, observes exit and shuts down.

## Consumer boundaries

An isolated temporary package-manager installation consumed both rebuilt
`.release/cli-acceptance/*.tgz` files through their public exports:

- 13 tests passed: unchanged Lapis Deno desktop adapters, controller isolation,
  and a cold controller child using the rebuilt AI Host package and browser client.
- Fresh Deno embedding of both packages passed authenticated browser-client
  attachment, real PTY creation, resize/stop, inspection, lifecycle events,
  token-output suppression and shutdown.
- Both installed npm CLI launchers returned their versioned JSON envelope.
- Lapis source web attachment tests: 12 passed. These are mock-based adapter
  checks; they do not replace real browser acceptance.
- Lapis smoke-supervisor/boundary tests: 4 passed.

Temporary copies of unchanged consumer test boundaries were used for the isolated
package run; no consumer source, manifests, lockfiles or installed services were
changed by this implementation.

## Remaining acceptance gates

- Native execution on macOS x64, Linux arm64 and Linux x64. Four binaries built,
  but cross-compilation is not native execution. `.github/workflows/cli.yml`
  configures one native build/smoke runner per advertised target; those remote
  jobs have not been run from this workstation.
- Full Lapis desktop, web and cold Storybook AI acceptance against rebuilt
  packages. The existing application dependency installation fails on
  `@lapismd/lapis-community` (registry HTTP 404); its offline retry also lacks
  `@lapis-notes/community` metadata. The original consumer lockfile is unchanged.
- Actual launchd/systemd installation and replacement, publication, and signing
  remain separate operator actions. Unit tests validate service definitions,
  idempotent installation, instance isolation and data preservation on uninstall.

No binary or npm artifact has been published, installed globally, signed or used
to replace a live service. Existing parent changes in each repository are retained.
