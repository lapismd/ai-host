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
        "^spec/src/(?:index|architecture|protocol|executor|file-tools|spec-governance)\\.md$",
      ignore: [
        "(^|/)node_modules/",
        "(^|/)(?:dist|build)/",
        "^spec/book/",
        "^spec/src/(?:SUMMARY|verification)\\.md$",
        "\\.(?:spec|test)\\.[cm]?[jt]sx?$",
      ],
      rules: [
        {
          pattern: "^src/(?:serve|parse-cli|cli|token)\\.ts$",
          chapters: ["spec/src/protocol.md"],
        },
        {
          pattern: "^src/(?:ws-server|protocol|replay-buffer|client)\\.ts$",
          chapters: ["spec/src/protocol.md"],
        },
        {
          pattern: "^src/(?:executor|acp-agent|acp-session-options)\\.ts$",
          chapters: ["spec/src/executor.md"],
        },
        {
          pattern: "^src/(?:mcp-shim|tool-bridge)\\.ts$",
          chapters: ["spec/src/executor.md"],
        },
        {
          pattern: "^src/file-tools/",
          chapters: ["spec/src/file-tools.md"],
        },
        {
          pattern: "^(?:package\\.json$|src/index\\.ts$|bin/|scripts/)",
          chapters: ["spec/src/architecture.md"],
        },
        {
          pattern:
            "^(?:spec-validator\\.config\\.mjs$|AGENTS\\.md$|pnpm-workspace\\.yaml$|spec/book\\.toml$)",
          chapters: ["spec/src/spec-governance.md"],
        },
      ],
      protected: [
        "^(?:src/|package\\.json$|bin/|scripts/|spec-validator\\.config\\.mjs$|AGENTS\\.md$|pnpm-workspace\\.yaml$)",
      ],
    },
  },
  check: {
    lanes: [{ name: "tests", command: "pnpm", args: ["test"] }],
    build: true,
    first: true,
  },
});
