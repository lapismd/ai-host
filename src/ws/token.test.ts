import { describe, expect, it } from "vitest";
import { generateToken, isLoopbackBind, tokensEqual } from "./token";

describe("token helpers", () => {
  it("generates a non-empty token and compares it in constant time", () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThan(20);
    expect(tokensEqual(token, token)).toBe(true);
    expect(tokensEqual(token, `${token}x`)).toBe(false);
    expect(tokensEqual(token, "other")).toBe(false);
  });

  it("treats only loopback hosts as localhost binds", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("localhost")).toBe(true);
    expect(isLoopbackBind("::1")).toBe(true);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
  });
});
