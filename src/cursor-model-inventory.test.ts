import { describe, expect, it } from "vitest";
import { parseCursorListModelsOutput } from "./cursor-model-inventory";

describe("Cursor model inventory", () => {
  it("parses id, label, current, and default markers", () => {
    expect(
      parseCursorListModelsOutput(`
Available models

auto - Auto (default)
composer-2.5 - Composer 2.5 (current)
gpt-5.3-codex-low - Codex 5.3 Low
composer-2.5 - ignored duplicate
`),
    ).toEqual([
      { id: "auto", label: "Auto", default: true },
      { id: "composer-2.5", label: "Composer 2.5", current: true },
      { id: "gpt-5.3-codex-low", label: "Codex 5.3 Low" },
    ]);
  });
});
