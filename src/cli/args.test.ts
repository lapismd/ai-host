import { describe, it, expect } from "vitest";
import { parseArguments, markdownHelp } from "./args";
describe("operator command contract", () => {
  it("accepts global options on either side", () => {
    expect(
      parseArguments(["--json", "status", "--color", "never"]).command,
    ).toBe("status");
    expect(parseArguments(["status", "--json"]).options.json).toBe(true);
  });
  it("rejects unknown flags and missing values", () => {
    expect(() => parseArguments(["serve", "--workspace", "--json"])).toThrow(
      /requires/,
    );
    expect(() => parseArguments(["status", "--workspace", "/tmp"])).toThrow(
      /Unknown option/,
    );
    expect(() => parseArguments(["statsu"])).toThrow(/status/);
  });
  it("generates command-specific documentation", () => {
    expect(markdownHelp()).toContain("service install");
    expect(markdownHelp()).toContain("token show");
  });
});
