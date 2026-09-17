# @lapismd/ai-host

## 0.2.0

### Minor Changes

- [#1](https://github.com/lapismd/ai-host/pull/1) [`f5343d9`](https://github.com/lapismd/ai-host/commit/f5343d9eaf65d9e8469e9713fde4b12311d99a5c) Thanks [@stevejuma](https://github.com/stevejuma)! - Retire the standalone operator CLI and service lifecycle in favor of AI
  Controller. Keep embeddable host and MCP shim launch hooks, controller-safe ACP
  catalogs, persisted-session discovery, restart-safe runtime events, NodeNext
  declaration paths, and native MCP credential forwarding. The private MCP shim
  remains an implementation helper, not a public PATH command.

### Patch Changes

- [#1](https://github.com/lapismd/ai-host/pull/1) [`16eea4e`](https://github.com/lapismd/ai-host/commit/16eea4ee4ca9f78cb4591a1be296d620a77e1b6c) Thanks [@stevejuma](https://github.com/stevejuma)! - Expose embeddable AI Host and MCP shim launch hooks so a compiled supervisor can
  run both services without separate Node.js entrypoints.

## 0.1.0

### Minor Changes

- Initial public release of the standalone LapisMD ACP host package.
- Publishes built root, `./client`, and `./file-tools` entrypoints plus the
  `lapis-ai-host` and `lapis-mcp-shim` CLI launchers.
- Adds Changesets-based release planning, verified tarball artifacts, manual
  bootstrap publishing, and future npm trusted publishing through GitHub
  Actions.
