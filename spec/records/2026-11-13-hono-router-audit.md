# Hono production audit repair

Date: 2026-11-13

Requirement: AH-PKG-008

## Failed boundary

`pnpm audit --prod --audit-level moderate` failed with three production
advisories through `@modelcontextprotocol/sdk` and Hono 4.13.11:

- `GHSA-4m76-xfj5-7975` (moderate)
- `GHSA-h7mg-cq63-vhpq` (moderate)
- `GHSA-3gg2-335m-rxc6` (low)

The first two advisories made the command exit 1. The published MCP SDK range
already admits the patched Hono release, so no public dependency range or
runtime API changed.

## Repair

The workspace override and committed lock select Hono 4.13.16, the first
release patched for all three findings. No advisory exception was added.

## Validation

- `pnpm audit --prod --audit-level moderate`: passed with no known
  vulnerabilities.
- `pnpm spec:check`: passed.
- `pnpm check`: passed.
- `pnpm test`: passed.
- `pnpm build`: passed.

The Desktop consumer lock remains separately responsible for selecting the
patched transitive version from the published AI Host semver graph.
