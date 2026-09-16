import { expect, it } from "vitest";
import { Output } from "./output";
it("redacts string values before JSON encoding and removes terminal controls", () => {
  const lines: string[] = [];
  const output = new Output(
    { stdout: (s) => lines.push(s), stderr: () => {} },
    true,
    true,
  );
  output.secrets.add("private-value");
  output.success("doctor", {
    detail: "token=private-value",
    nested: ["\x1b[31mred\x1b[0m"],
  });
  output.event("serve", "error", { detail: "authorization=another-secret" });
  expect(JSON.parse(lines[0]).data).toEqual({
    detail: "token=[redacted]",
    nested: ["red"],
  });
  expect(JSON.parse(lines[1]).data.detail).toBe("authorization=[redacted]");
  expect(lines.join()).not.toContain("\x1b");
});

it("explicit JSON token disclosure preserves the exact secret", () => {
  const lines: string[] = [];
  const output = new Output(
    { stdout: (s) => lines.push(s), stderr: () => {} },
    true,
    true,
  );
  const token = "private-\x1b[31m-token";
  output.success("token show", { token }, token, true);
  expect(JSON.parse(lines[0]).data.token).toBe(token);
  expect(lines[0]).not.toContain("\x1b");
});

it("keeps envelope identifiers stable when a short token matches protocol text", () => {
  const lines: string[] = [];
  const output = new Output(
    { stdout: (s) => lines.push(s), stderr: () => {} },
    true,
    false,
  );
  output.secrets.add("1");
  output.success("status", { detail: "private 1" });
  expect(JSON.parse(lines[0]).schema.endsWith(".cli/1")).toBe(true);
  expect(JSON.parse(lines[0]).data.detail).toBe("private [redacted]");
});
