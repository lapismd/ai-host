import { stripVTControlCharacters } from "node:util";
import { BINARY } from "./brand";
import { CliError } from "./types";
export type Io = { stdout(line: string): void; stderr(line: string): void };
export class Output {
  readonly secrets = new Set<string>();
  constructor(
    readonly io: Io,
    readonly json: boolean,
    readonly color: boolean,
  ) {}
  redact(text: string): string {
    for (const s of this.secrets)
      if (s) text = text.replaceAll(s, "[redacted]");
    return text.replace(
      /((?:token|secret|authorization)\s*[=:]\s*)([^\s,;]+)/gi,
      "$1[redacted]",
    );
  }
  success(command: string, data: unknown, human?: string, secret = false) {
    const value = this.json
      ? this.serialize(
          { schema: BINARY + ".cli/1", command, ok: true, data },
          secret,
        )
      : (human ?? this.human(data));
    this.io.stdout(this.json || secret ? value : this.redact(value));
  }
  event(command: string, event: string, data: unknown) {
    this.io.stdout(
      this.json
        ? this.serialize({
            schema: BINARY + ".cli/1",
            command,
            event,
            time: new Date().toISOString(),
            data,
          })
        : this.redact(this.human({ event, ...(data as object) })),
    );
  }
  error(command: string, error: unknown) {
    const e =
      error instanceof CliError
        ? error
        : new CliError(
            "operation_failed",
            error instanceof Error ? error.message : "Operation failed",
            1,
          );
    const value = {
      code: e.code,
      message: this.redact(e.message),
      exitCode: e.exitCode,
    };
    if (this.json)
      this.io.stdout(
        this.serialize({
          schema: BINARY + ".cli/1",
          command,
          ok: false,
          error: value,
        }),
      );
    else this.io.stderr(this.redact("✗ " + e.message));
    return e.exitCode;
  }
  private serialize(value: unknown, secret = false): string {
    if (secret) return JSON.stringify(value);
    const clean = (item: unknown): unknown => {
      if (typeof item === "string")
        return this.redact(stripVTControlCharacters(item));
      if (Array.isArray(item)) return item.map(clean);
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, entry]) => [key, clean(entry)]),
        );
      return item;
    };
    const envelope = value as Record<string, unknown>;
    // Protocol identifiers stay stable even when an operator supplies a short token.
    const result = { ...envelope };
    if ("data" in result) result.data = clean(result.data);
    if (result.error) {
      const error = result.error as Record<string, unknown>;
      result.error = { ...error, message: clean(error.message) };
    }
    return JSON.stringify(result);
  }
  human(data: unknown): string {
    if (Array.isArray(data))
      return data.length ? data.map((v) => this.human(v)).join("\n") : "• None";
    if (data && typeof data === "object")
      return Object.entries(data)
        .map(([key, value]) => {
          if (Array.isArray(value))
            return `${key}:
${this.human(value)}`;
          if (value && typeof value === "object")
            return `${key}:
${this.human(value)}`;
          const good =
            value === true ||
            value === "running" ||
            value === "ready" ||
            value === "available";
          const bad =
            value === false || value === "failed" || value === "unavailable";
          const marker = good ? "✓" : bad ? "✗" : "•";
          const prefix = this.color
            ? `[${good ? 32 : bad ? 31 : 36}m${marker}[0m`
            : marker;
          return `${prefix} ${key}: ${value ?? "unknown"}`;
        })
        .join("\n");
    return String(data);
  }
}
