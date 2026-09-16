# lapis-ai-host CLI reference

Generated from the command tree; do not edit by hand.

## init

```text
Usage: lapis-ai-host init [options]

Create private configuration and token; requires --workspace.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.
  --workspace <path>  Workspace root.
  --port <number>  Port (default 7345).
  --bind <host>  Bind address (default 127.0.0.1).
  --origin <url>  Allowed origin (repeatable).
  --token <secret>  Connection token; prefer --token-file.
  --token-file <path>  Owner-only token file.
  --profile <trusted|controller>  AI access profile.
  --agent-config <path>  ACP agent registry JSON.

Example: lapis-ai-host init --workspace ~/code/workspace
```

## serve

```text
Usage: lapis-ai-host serve [options]

Run the host until interrupted.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.
  --workspace <path>  Workspace root.
  --port <number>  Port (default 7345).
  --bind <host>  Bind address (default 127.0.0.1).
  --origin <url>  Allowed origin (repeatable).
  --token <secret>  Connection token; prefer --token-file.
  --token-file <path>  Owner-only token file.
  --profile <trusted|controller>  AI access profile.
  --agent-config <path>  ACP agent registry JSON.

Example: lapis-ai-host serve --workspace ~/code/workspace
```

## config validate

```text
Usage: lapis-ai-host config validate [options]

Validate the selected configuration.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host config validate
```

## status

```text
Usage: lapis-ai-host status [options]

Show live host state or stopped status.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.
  --watch  Watch until interrupted.

Example: lapis-ai-host status
```

## doctor

```text
Usage: lapis-ai-host doctor [options]

Inspect configuration, permissions, dependencies and live connectivity.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host doctor
```

## sessions list

```text
Usage: lapis-ai-host sessions list [options]

List live session metadata.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.
  --active  Only running or initializing sessions.

Example: lapis-ai-host sessions list
```

## sessions show

```text
Usage: lapis-ai-host sessions show [options]

Show one live session's metadata.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.
  --session <id>  Session identifier.

Example: lapis-ai-host sessions show
```

## runtimes list

```text
Usage: lapis-ai-host runtimes list [options]

List registered external ACP runtimes and availability.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host runtimes list
```

## logs

```text
Usage: lapis-ai-host logs [options]

Read metadata-only operational logs.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.
  --lines <number>  Last N records (default 100).
  --follow  Follow new records.

Example: lapis-ai-host logs
```

## service install

```text
Usage: lapis-ai-host service install [options]

Install the user service. Uninstall preserves data.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host service install
```

## service start

```text
Usage: lapis-ai-host service start [options]

Start the user service. Uninstall preserves data.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host service start
```

## service stop

```text
Usage: lapis-ai-host service stop [options]

Stop the user service. Uninstall preserves data.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host service stop
```

## service restart

```text
Usage: lapis-ai-host service restart [options]

Restart the user service. Uninstall preserves data.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host service restart
```

## service status

```text
Usage: lapis-ai-host service status [options]

Status the user service. Uninstall preserves data.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host service status
```

## service uninstall

```text
Usage: lapis-ai-host service uninstall [options]

Uninstall the user service. Uninstall preserves data.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host service uninstall
```

## token show

```text
Usage: lapis-ai-host token show [options]

Explicitly reveal the connection token. Output is secret.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host token show
```

## docs markdown-help

```text
Usage: lapis-ai-host docs markdown-help [options]

Print the generated Markdown reference.

Options:
  --config <path>  Configuration file.
  --instance <name>  Instance (default default).
  --json  Versioned JSON or NDJSON.
  --no-input  Never prompt.
  --color <auto|always|never>  Human output color.
  --help  Show contextual help.
  --version  Show package version.

Example: lapis-ai-host docs markdown-help
```
