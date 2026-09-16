import { BINARY, IS_AI } from "./brand";
import { CliError } from "./types";
type Option = { value?: string; description: string; multiple?: boolean };
export const globals: Record<string, Option> = {
  config: { value: "path", description: "Configuration file." },
  instance: { value: "name", description: "Instance (default default)." },
  json: { description: "Versioned JSON or NDJSON." },
  "no-input": { description: "Never prompt." },
  color: { value: "auto|always|never", description: "Human output color." },
  help: { description: "Show contextual help." },
  version: { description: "Show package version." },
};
const serve: Record<string, Option> = {
  workspace: { value: "path", description: "Workspace root." },
  port: {
    value: "number",
    description: `Port (default ${IS_AI ? 7345 : 7346}).`,
  },
  bind: { value: "host", description: "Bind address (default 127.0.0.1)." },
  origin: {
    value: "url",
    description: "Allowed origin (repeatable).",
    multiple: true,
  },
  token: {
    value: "secret",
    description: "Connection token; prefer --token-file.",
  },
  "token-file": { value: "path", description: "Owner-only token file." },
  ...(IS_AI
    ? {
        profile: {
          value: "trusted|controller",
          description: "AI access profile.",
        },
        "agent-config": {
          value: "path",
          description: "ACP agent registry JSON.",
        },
      }
    : {}),
};
export type CommandSpec = {
  summary: string;
  options: Record<string, Option>;
  example?: string;
};
export const commands: Record<string, CommandSpec> = {
  init: {
    summary: "Create private configuration and token; requires --workspace.",
    options: serve,
    example: "init --workspace ~/code/workspace",
  },
  serve: {
    summary: "Run the host until interrupted.",
    options: serve,
    example: "serve --workspace ~/code/workspace",
  },
  "config validate": {
    summary: "Validate the selected configuration.",
    options: {},
  },
  status: {
    summary: "Show live host state or stopped status.",
    options: { watch: { description: "Watch until interrupted." } },
  },
  doctor: {
    summary:
      "Inspect configuration, permissions, dependencies and live connectivity.",
    options: {},
  },
  "sessions list": {
    summary: "List live session metadata.",
    options: {
      active: { description: "Only running or initializing sessions." },
    },
  },
  "sessions show": {
    summary: "Show one live session's metadata.",
    options: { session: { value: "id", description: "Session identifier." } },
  },
  ...(IS_AI
    ? {
        "runtimes list": {
          summary: "List registered external ACP runtimes and availability.",
          options: {},
        },
      }
    : {}),
  logs: {
    summary: "Read metadata-only operational logs.",
    options: {
      lines: { value: "number", description: "Last N records (default 100)." },
      follow: { description: "Follow new records." },
    },
  },
  ...Object.fromEntries(
    ["install", "start", "stop", "restart", "status", "uninstall"].map(
      (name) => [
        `service ${name}`,
        {
          summary: `${name[0].toUpperCase() + name.slice(1)} the user service. Uninstall preserves data.`,
          options: {},
        },
      ],
    ),
  ),
  "token show": {
    summary: "Explicitly reveal the connection token. Output is secret.",
    options: {},
  },
  "docs markdown-help": {
    summary: "Print the generated Markdown reference.",
    options: {},
  },
};
export type Arguments = {
  command: string;
  options: Record<string, string | boolean | string[]>;
};
export function parseArguments(argv: string[]): Arguments {
  const all = {
    ...globals,
    ...Object.assign({}, ...Object.values(commands).map((c) => c.options)),
  } as Record<string, Option>;
  const options: Arguments["options"] = {};
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let item = argv[i];
    if (item === "-h") item = "--help";
    if (item === "-v") item = "--version";
    if (!item.startsWith("--")) {
      words.push(item);
      continue;
    }
    const equal = item.indexOf("=");
    const name = item.slice(2, equal < 0 ? undefined : equal);
    const spec = all[name];
    if (!spec)
      throw new CliError(
        "unknown_option",
        `Unknown option --${name}.${hint(name, Object.keys(all))}`,
      );
    const value = spec.value
      ? equal < 0
        ? argv[++i]
        : item.slice(equal + 1)
      : true;
    if (
      spec.value &&
      (typeof value !== "string" || !value || value.startsWith("--"))
    )
      throw new CliError("missing_value", `--${name} requires ${spec.value}`);
    if (!spec.value && equal >= 0)
      throw new CliError("invalid_option", `--${name} does not take a value`);
    if (options[name] !== undefined && !spec.multiple)
      throw new CliError("duplicate_option", `Duplicate --${name}`);
    options[name] = spec.multiple
      ? [...((options[name] as string[] | undefined) ?? []), String(value)]
      : value;
  }
  const help = words[0] === "help";
  if (help) {
    words.shift();
    options.help = true;
  }
  const command = words.join(" ");
  if (
    options.color &&
    !["auto", "always", "never"].includes(String(options.color))
  )
    throw new CliError(
      "invalid_option",
      "--color must be auto, always, or never",
    );
  if (options.version) return { command: "version", options };
  if (
    !command ||
    (options.help &&
      (commands[command] ||
        Object.keys(commands).some((c) => c.startsWith(command + " ")))) ||
    (!commands[command] &&
      Object.keys(commands).some((c) => c.startsWith(command + " ")))
  )
    return { command, options: { ...options, help: true } };
  if (!commands[command])
    throw new CliError(
      "unknown_command",
      `Unknown command ${command}.${hint(command, Object.keys(commands))}`,
    );
  for (const name of Object.keys(options))
    if (!globals[name] && !commands[command].options[name])
      throw new CliError(
        "unknown_option",
        `Unknown option --${name} for ${command}`,
      );
  return { command, options };
}
function hint(value: string, choices: string[]): string {
  const score = (s: string) => {
    const row = Array.from({ length: s.length + 1 }, (_, i) => i);
    for (let i = 1; i <= value.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= s.length; j++) {
        const old = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          prev + (value[i - 1] === s[j - 1] ? 0 : 1),
        );
        prev = old;
      }
    }
    return row[s.length];
  };
  const nearest = choices.sort((a, b) => score(a) - score(b))[0];
  return nearest && score(nearest) <= 3 ? ` Did you mean ${nearest}?` : "";
}
export function helpText(command = ""): string {
  const spec = commands[command];
  const children = Object.entries(commands).filter(
    ([name]) => !command || name.startsWith(command + " "),
  );
  return [
    `Usage: ${BINARY}${command ? " " + command : ""}${spec ? " [options]" : " <command> [options]"}`,
    "",
    spec?.summary ?? "Standalone host operations.",
    "",
    ...children.map(([name, c]) => `  ${name.padEnd(24)} ${c.summary}`),
    "Options:",
    ...Object.entries({ ...globals, ...spec?.options }).map(
      ([name, o]) =>
        `  --${name}${o.value ? " <" + o.value + ">" : ""}  ${o.description}`,
    ),
    "",
    `Example: ${BINARY} ${spec?.example ?? (command || "status --json")}`,
  ].join("\n");
}
export function markdownHelp(): string {
  return (
    `# ${BINARY} CLI reference

Generated from the command tree; do not edit by hand.

` +
    Object.keys(commands)
      .map(
        (name) => `## ${name}

\`\`\`text
${helpText(name)}
\`\`\`
`,
      )
      .join("\n")
  );
}
