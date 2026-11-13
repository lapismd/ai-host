# `@hono/node-server` production audit repair

Date: 2026-11-13

Desktop PR 23 failed its production dependency audit while installing the
published `@lapismd/ai-host` graph. The retained hosted report resolved
`@hono/node-server` 2.1.5 through `@modelcontextprotocol/sdk` and rejected:

- `GHSA-qv5m-9pm6-hqp3`, an unhandled socket error during asynchronous
  WebSocket upgrade;
- `GHSA-jpvv-r467-5p4w`, reverse-proxy path interpretation divergence for raw
  backslashes.

The exact owning-repository reproduction, `pnpm audit --prod --audit-level
moderate`, failed with both advisories while the source lock resolved 2.1.3.
Both advisories affect versions before 2.1.6.

The workspace override now maps every affected 2.x resolution below 2.1.6 to
2.1.6. No advisory is ignored or muted. The committed lockfile and complete
package gates provide the acceptance evidence for this repair.
