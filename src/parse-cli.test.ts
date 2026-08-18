import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVE_BIND,
  DEFAULT_SERVE_PORT,
  DEFAULT_SERVE_WORKSPACE,
  parseServeArgs,
} from "./parse-cli";

describe("parseServeArgs", () => {
  it("parses serve defaults and a provided token", () => {
    const parsed = parseServeArgs(["serve", "--token", "secret-token"]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        port: DEFAULT_SERVE_PORT,
        bind: DEFAULT_SERVE_BIND,
        workspace: DEFAULT_SERVE_WORKSPACE,
        token: "secret-token",
        origins: [],
      },
    });
  });

  it("allows omitting --token so the host can generate one", () => {
    const parsed = parseServeArgs(["serve"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.args.token).toBeUndefined();
  });

  it("rejects an empty --token", () => {
    const parsed = parseServeArgs(["serve", "--token", ""]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && "error" in parsed) {
      expect(parsed.error).toMatch(/non-empty token/i);
    }
  });

  it("requires --origin when binding a non-localhost address", () => {
    const parsed = parseServeArgs(["serve", "--bind", "0.0.0.0"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && "error" in parsed) {
      expect(parsed.error).toMatch(/--origin/i);
    }
  });

  it("does not add a public serve-local CLI command", () => {
    const parsed = parseServeArgs(["serve-local"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && "error" in parsed) {
      expect(parsed.error).toMatch(/^Usage: lapis-ai-host serve /);
    }
  });

  it("accepts a non-localhost bind with an origin allowlist", () => {
    const parsed = parseServeArgs([
      "serve",
      "--bind",
      "0.0.0.0",
      "--origin",
      "http://localhost:7010",
      "--workspace",
      "./tmp/agents",
    ]);
    expect(parsed).toMatchObject({
      ok: true,
      args: {
        bind: "0.0.0.0",
        workspace: "./tmp/agents",
        origins: ["http://localhost:7010"],
      },
    });
  });
});
