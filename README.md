# `@lapismd/ai-host`

Transport library for ACP execution, disposable model discovery, process I/O,
MCP bridging and portable file-tool kernels. It has no standalone operator CLI.

Applications use `@lapismd/ai-controller` and its shared client. The standalone
service is `lapis-ai-controller`, maintained in the sibling `ai-controller`
repository. Nostr identity and Lapis vault/App authority stay with those apps.

Public library exports remain available at the package root, `./client` for
legacy transport clients, and `./file-tools` for algorithm-only file helpers.
The private MCP shim is launched by the executor or supplied by an embedding
executable through `shimCommand`; it is not installed on PATH.

Run `pnpm spec:check`, `pnpm check`, `pnpm test`, and `pnpm build` to validate.
Use `pnpm packages:pack` to verify the public npm artifact without publishing.
Published manifests use npm semver ranges. Local pre-release consumer validation
may use an explicitly documented tarball hook.

Existing `lapis-ai-host` service installations are not modified automatically.
Stop or uninstall them explicitly when migrating to a separately configured
controller. Durable controller state does not come from the old host replay buffer.
