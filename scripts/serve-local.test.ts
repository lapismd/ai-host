import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_SERVE_TOKEN,
  LOCAL_SERVE_TOKEN_KEY,
  buildServeArgs,
  ensureLocalServeToken,
  readEnvToken,
} from "./serve-local.mjs";

describe("serve-local env seed", () => {
  it("creates .env with the deterministic token when missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-host-serve-local-"));
    const envPath = join(directory, ".env");
    const result = await ensureLocalServeToken(envPath);

    expect(result).toEqual({
      token: DEFAULT_LOCAL_SERVE_TOKEN,
      created: true,
    });
    expect(await readFile(envPath, "utf8")).toBe(
      `${LOCAL_SERVE_TOKEN_KEY}=${DEFAULT_LOCAL_SERVE_TOKEN}\n`,
    );
  });

  it("reuses an existing .env token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-host-serve-local-"));
    const envPath = join(directory, ".env");
    await writeFile(envPath, `${LOCAL_SERVE_TOKEN_KEY}=checkout-secret\n`);

    await expect(ensureLocalServeToken(envPath)).resolves.toEqual({
      token: "checkout-secret",
      created: false,
    });
    expect(await readFile(envPath, "utf8")).toBe(
      `${LOCAL_SERVE_TOKEN_KEY}=checkout-secret\n`,
    );
  });

  it("appends the deterministic token when .env exists without the key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-host-serve-local-"));
    const envPath = join(directory, ".env");
    await writeFile(envPath, "OTHER=1");

    await expect(ensureLocalServeToken(envPath)).resolves.toEqual({
      token: DEFAULT_LOCAL_SERVE_TOKEN,
      created: true,
    });
    expect(await readFile(envPath, "utf8")).toBe(
      `OTHER=1\n${LOCAL_SERVE_TOKEN_KEY}=${DEFAULT_LOCAL_SERVE_TOKEN}\n`,
    );
  });

  it("reads quoted values and ignores comments", () => {
    expect(
      readEnvToken(`# comment\n${LOCAL_SERVE_TOKEN_KEY}="quoted-token"\n`),
    ).toBe("quoted-token");
  });

  it("starts the existing serve command with the seeded token", () => {
    expect(buildServeArgs(["--port", "0"], "from-env")).toEqual([
      "serve",
      "--port",
      "0",
      "--token",
      "from-env",
    ]);
  });
});
