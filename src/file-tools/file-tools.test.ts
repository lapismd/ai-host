import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyEditsToText,
  executeApplyPatch,
  executeEdit,
  executeRead,
  executeWrite,
  parseApplyPatch,
  prepareEditInput,
  prepareWriteInput,
  type FileToolOperations,
} from "./index";

const leafDir = dirname(fileURLToPath(import.meta.url));

function memoryOperations(
  files: Record<string, string> = {},
): FileToolOperations & { files: Record<string, string> } {
  const store = { ...files };
  return {
    files: store,
    async readFile(path) {
      if (!(path in store)) throw new Error(`Missing ${path}`);
      return store[path];
    },
    async writeFile(path, content) {
      store[path] = content;
    },
    async mkdirp() {},
    async stat(path) {
      if (!(path in store)) return null;
      return { type: "file", size: store[path].length };
    },
    async remove(path) {
      delete store[path];
    },
    async rename(from, to) {
      if (!(from in store)) throw new Error(`Missing ${from}`);
      store[to] = store[from];
      delete store[from];
    },
  };
}

describe("file-tools isolation", () => {
  it("does not import MCP, acpx, or host transport modules", () => {
    const sources = [
      "index.ts",
      "aliases.ts",
      "apply-patch-parse.ts",
      "apply-patch-update.ts",
      "edit.ts",
      "execute.ts",
      "schemas.ts",
      "types.ts",
    ].map((name) => readFileSync(join(leafDir, name), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(/from ["']\.\.\//u);
      expect(source).not.toMatch(/@modelcontextprotocol|acpx|ws-server|tool-bridge|mcp-shim/u);
    }
  });
});

describe("prepareEditInput", () => {
  it("hoists edits, aliases, file_path, and JSON-string edits", () => {
    expect(
      prepareEditInput({
        file_path: "note.md",
        edits: [{ old_string: "a", new_string: "b" }],
      }),
    ).toEqual({ path: "note.md", edits: [{ oldText: "a", newText: "b" }] });
    expect(
      prepareEditInput({ path: "note.md", oldText: "a", newText: "b" }),
    ).toEqual({ path: "note.md", edits: [{ oldText: "a", newText: "b" }] });
    expect(
      prepareEditInput({
        path: "note.md",
        edits: JSON.stringify([{ old_str: "a", new_str: "b" }]),
      }),
    ).toEqual({ path: "note.md", edits: [{ oldText: "a", newText: "b" }] });
  });
});

describe("applyEditsToText", () => {
  it("applies unique non-overlapping hunks against the original", () => {
    expect(
      applyEditsToText("alpha\nbeta\n", [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "beta", newText: "BETA" },
      ]),
    ).toEqual({ ok: true, content: "ALPHA\nBETA\n" });
  });

  it("fails zero, repeated, overlapping, and no-op hunks", () => {
    expect(applyEditsToText("same same", [{ oldText: "missing", newText: "x" }])).toMatchObject({
      ok: false,
      reason: "match_not_found",
    });
    expect(applyEditsToText("same same", [{ oldText: "same", newText: "x" }])).toMatchObject({
      ok: false,
      reason: "ambiguous_match",
      matchCount: 2,
    });
    expect(
      applyEditsToText("abcdef", [
        { oldText: "abc", newText: "x" },
        { oldText: "bcd", newText: "y" },
      ]),
    ).toMatchObject({ ok: false, reason: "overlapping_hunks" });
    expect(applyEditsToText("abc", [{ oldText: "abc", newText: "abc" }])).toMatchObject({
      ok: false,
      reason: "no_change",
    });
  });
});

describe("executeWrite and executeEdit", () => {
  it("creates or overwrites through caller operations", async () => {
    const ops = memoryOperations();
    await expect(
      executeWrite(ops, (path) => path, prepareWriteInput({ path: "a.md", content: "one" })),
    ).resolves.toEqual({ path: "a.md", created: true, changed: true });
    await expect(
      executeWrite(ops, (path) => path, { path: "a.md", content: "two" }),
    ).resolves.toEqual({ path: "a.md", created: false, changed: true });
    expect(ops.files["a.md"]).toBe("two");
  });

  it("leaves path containment to the caller", async () => {
    const ops = memoryOperations({ "Notes/a.md": "old" });
    await expect(
      executeEdit(ops, () => {
        throw new Error("escaped");
      }, "Notes/../secret.md", [{ oldText: "old", newText: "new" }]),
    ).rejects.toThrow("escaped");
    expect(ops.files["Notes/a.md"]).toBe("old");
  });

  it("writes unique edits and reports conflicts", async () => {
    const ops = memoryOperations({ "a.md": "hello world" });
    await expect(
      executeEdit(ops, (path) => path, "a.md", [{ oldText: "hello", newText: "hi" }]),
    ).resolves.toMatchObject({ ok: true, content: "hi world" });
    await expect(
      executeEdit(ops, (path) => path, "a.md", [{ oldText: "missing", newText: "x" }]),
    ).resolves.toMatchObject({ ok: false, reason: "match_not_found" });
  });
});

describe("executeRead", () => {
  it("returns a bounded line range", async () => {
    const ops = memoryOperations({ "a.md": "one\ntwo\nthree" });
    await expect(
      executeRead(ops, (path) => path, { path: "a.md", startLine: 2, endLine: 3 }),
    ).resolves.toMatchObject({
      text: "two\nthree",
      startLine: 2,
      endLine: 3,
      totalLines: 3,
      truncated: false,
    });
  });
});

describe("apply_patch", () => {
  it("parses add, update, delete, and move envelopes", () => {
    const hunks = parseApplyPatch(`*** Begin Patch
*** Add File: new.md
+hello
*** Update File: old.md
@@
-old
+new
*** Update File: moved.md
*** Move to: renamed.md
@@
-keep
+keep
*** Delete File: gone.md
*** End Patch`);
    expect(hunks.map((hunk) => hunk.kind)).toEqual([
      "add",
      "update",
      "update",
      "delete",
    ]);
    expect(hunks[2]).toMatchObject({ kind: "update", movePath: "renamed.md" });
  });

  it("applies add, update, delete, and move through injected operations", async () => {
    const ops = memoryOperations({
      "old.md": "old\n",
      "moved.md": "keep\n",
      "gone.md": "bye\n",
    });
    const result = await executeApplyPatch(
      ops,
      (path) => path,
      `*** Begin Patch
*** Add File: new.md
+hello
*** Update File: old.md
@@
-old
+new
*** Update File: moved.md
*** Move to: renamed.md
@@
-keep
+kept
*** Delete File: gone.md
*** End Patch`,
    );
    expect(result.summary).toEqual({
      added: ["new.md"],
      modified: ["old.md", "renamed.md"],
      deleted: ["gone.md"],
    });
    expect(ops.files["new.md"]).toBe("hello\n");
    expect(ops.files["old.md"]).toBe("new\n");
    expect(ops.files["renamed.md"]).toBe("kept\n");
    expect(ops.files["moved.md"]).toBeUndefined();
    expect(ops.files["gone.md"]).toBeUndefined();
  });

  it("rejects Add File when the destination exists", async () => {
    const ops = memoryOperations({ "new.md": "exists" });
    await expect(
      executeApplyPatch(
        ops,
        (path) => path,
        "*** Begin Patch\n*** Add File: new.md\n+x\n*** End Patch",
      ),
    ).rejects.toThrow("already exists");
    expect(ops.files["new.md"]).toBe("exists");
  });

  it("validates later hunks before writing earlier ones", async () => {
    const ops = memoryOperations({ "old.md": "old\n" });
    await expect(
      executeApplyPatch(
        ops,
        (path) => path,
        `*** Begin Patch
*** Add File: new.md
+hello
*** Update File: missing.md
@@
-old
+new
*** End Patch`,
      ),
    ).rejects.toThrow("Missing missing.md");
    expect(ops.files["new.md"]).toBeUndefined();
    expect(ops.files["old.md"]).toBe("old\n");
  });
});
