import type {
  FileEdit,
  NormalizedEditInput,
  NormalizedReadInput,
  NormalizedWriteInput,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function readReplacement(value: unknown): FileEdit | null {
  if (!isRecord(value)) return null;
  const oldText = readString(value, ["oldText", "old_string", "old_str"]);
  const newText = readString(value, ["newText", "new_string", "new_str"]);
  if (!oldText || newText === undefined) return null;
  return { oldText, newText };
}

function readEdits(value: unknown): FileEdit[] {
  const raw = typeof value === "string" ? parseJsonArray(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const edit = readReplacement(entry);
    return edit ? [edit] : [];
  });
}

function parseJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function prepareReadInput(input: unknown): NormalizedReadInput {
  if (!isRecord(input)) throw new Error("Read input must be an object.");
  const path = readString(input, ["path", "file_path"]);
  if (!path) throw new Error("Read path is required.");
  const startLine =
    typeof input.startLine === "number" ? input.startLine : undefined;
  const endLine = typeof input.endLine === "number" ? input.endLine : undefined;
  return { path, startLine, endLine };
}

export function prepareWriteInput(input: unknown): NormalizedWriteInput {
  if (!isRecord(input)) throw new Error("Write input must be an object.");
  const path = readString(input, ["path", "file_path"]);
  if (!path) throw new Error("Write path is required.");
  if (typeof input.content !== "string") {
    throw new Error("Write content is required.");
  }
  return { path, content: input.content };
}

export function prepareEditInput(input: unknown): NormalizedEditInput {
  if (!isRecord(input)) throw new Error("Edit input must be an object.");
  const path = readString(input, ["path", "file_path"]);
  if (!path) throw new Error("Edit path is required.");
  const fromArray = readEdits(input.edits);
  const legacy = readReplacement(input);
  const edits = fromArray.length > 0 ? fromArray : legacy ? [legacy] : [];
  if (edits.length === 0) {
    throw new Error("Edit input must include at least one replacement.");
  }
  return { path, edits };
}

export function prepareApplyPatchInput(input: unknown): { input: string } {
  if (typeof input === "string" && input.trim()) return { input };
  if (!isRecord(input)) throw new Error("apply_patch input must be an object.");
  const patch = readString(input, ["input", "patch"]);
  if (!patch?.trim()) throw new Error("Provide a patch input.");
  return { input: patch };
}
