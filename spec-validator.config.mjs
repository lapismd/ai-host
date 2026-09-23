import {
  defineConfig,
  singleIdVerification,
  tableRequirements,
} from "@lapismd/spec-validator";

export default defineConfig(tableRequirements(), {
  name: "ai-host",
  idPattern: /^AH-[A-Z]+-\d{3}$/,
  tableSection: "Requirements",
  ruleIds: {
    summary: "AH-GOV-001",
    governance: "AH-GOV-003",
    verification: "AH-GOV-003",
    book: "AH-GOV-001",
    bookIgnore: "AH-GOV-001",
    specFirst: "AH-GOV-002",
    internal: "AH-GOV-003",
  },
  validators: {
    summary: true,
    governance: {
      extras: ["AGENTS.md", "README.md"],
      normative: true,
      proseLimits: false,
      acceptance: false,
      references: true,
      changeMap: true,
    },
    verification: singleIdVerification({
      headers: {
        ids: ["ID"],
        status: ["Status"],
        evidence: ["Evidence"],
        required: [],
      },
      statuses: ["Implemented", "Planned"],
    }),
    book: true,
    specFirst: {
      mode: "mapped",
      canonicalPattern:
        "^spec/src/(?:cli|index|architecture|protocol|executor|file-tools|spec-governance)\\.md$",
      ignore: [
        "(^|/)node_modules/",
        "(^|/)(?:dist|build)/",
        "^spec/book/",
        "^spec/src/(?:SUMMARY|verification)\\.md$",
        "\\.(?:spec|test)\\.[cm]?[jt]sx?$",
      ],
      rules: [
        {
          pattern:
            "^(?:src/cli/|src/cli\\.ts$|src/main\\.ts$|deno\\.(?:json|lock)$|docs/cli/|scripts/(?:build-cli|check-cli|smoke-cli|docs-cli)\\.ts$)",
          chapters: ["spec/src/cli.md"],
        },
        {
          pattern:
            "^(?:src/(?:serve|parse-cli|cli|token)\\.ts$|src/ws/(?:serve|token)\\.ts$)",
          chapters: ["spec/src/protocol.md"],
        },
        {
          pattern:
            "^(?:src/(?:ws-server|protocol|replay-buffer|client)\\.ts$|src/ws/ws-server\\.ts$|src/protocol/|src/client\\.ts$)",
          chapters: ["spec/src/protocol.md"],
        },
        {
          pattern:
            "^(?:src/(?:executor|acp-agent|acp-session-options|acp-model-catalog|acp-model-inventory|cursor-model-inventory|codex-model-inventory|opencode-model-inventory|inventory-process|volatile-session-store)\\.ts$|src/(?:executor|acp|inventory)/)",
          chapters: ["spec/src/executor.md"],
        },
        {
          pattern: "^(?:src/(?:mcp-shim(?:-cli)?|tool-bridge)\\.ts$|src/mcp/)",
          chapters: ["spec/src/executor.md"],
        },
        {
          pattern: "^src/file-tools/",
          chapters: ["spec/src/file-tools.md"],
        },
        {
          pattern:
            "^(?:docs/plans/|scripts/(?:check-architecture|architecture))",
          chapters: ["spec/src/architecture.md"],
        },
        {
          pattern:
            "^(?:package\\.json$|src/index\\.ts$|bin/|scripts/|\\.changeset/|\\.github/workflows/|CHANGELOG\\.md$|LICENSE\\.md$|README\\.md$)",
          chapters: ["spec/src/architecture.md"],
        },
        {
          pattern:
            "^(?:spec-validator\\.config\\.mjs$|AGENTS\\.md$|pnpm-workspace\\.yaml$|spec/book\\.toml$|\\.gitignore$)",
          chapters: ["spec/src/spec-governance.md"],
        },
      ],
      protected: [
        "^(?:deno\\.(?:json|lock)$|docs/cli/|docs/plans/|src/|package\\.json$|bin/|scripts/|\\.changeset/|\\.github/workflows/|CHANGELOG\\.md$|LICENSE\\.md$|README\\.md$|\\.gitignore$|spec-validator\\.config\\.mjs$|AGENTS\\.md$|pnpm-workspace\\.yaml$)",
      ],
    },
  },
  check: {
    lanes: [
      { name: "architecture", command: "node", args: ["scripts/check-architecture.mjs"] },
      { name: "tests", command: "pnpm", args: ["test"] },
    ],
    build: true,
    first: true,
  },
});
