---
"@lapismd/ai-host": minor
---

Retire the standalone operator CLI and service lifecycle in favor of AI
Controller. Keep embeddable host and MCP shim launch hooks, controller-safe ACP
catalogs, persisted-session discovery, restart-safe runtime events, NodeNext
declaration paths, and native MCP credential forwarding. The private MCP shim
remains an implementation helper, not a public PATH command.
