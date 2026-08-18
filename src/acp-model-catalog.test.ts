import { describe, expect, it } from "vitest";
import { normalizeAcpModelEntry } from "./acp-model-catalog";

describe("ACP model catalog labels", () => {
  it("keeps the raw Cursor id and surfaces Fast or effort badges", () => {
    expect(
      normalizeAcpModelEntry(
        "cursor",
        "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]",
      ),
    ).toEqual({
      id: "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]",
      label: "claude-opus-5",
      badges: ["High"],
    });
    expect(
      normalizeAcpModelEntry("cursor", "composer-2.5[fast=true]"),
    ).toEqual({
      id: "composer-2.5[fast=true]",
      label: "composer-2.5",
      badges: ["Fast"],
    });
  });

  it("uses the Codex id as the label unless a display name is provided", () => {
    expect(normalizeAcpModelEntry("codex", "gpt-5.6-sol")).toEqual({
      id: "gpt-5.6-sol",
      label: "gpt-5.6-sol",
    });
    expect(normalizeAcpModelEntry("codex", "gpt-5.6-sol", "Sol")).toEqual({
      id: "gpt-5.6-sol",
      label: "Sol",
    });
  });
});
