import { applyUpdateChunksToText } from "./apply-patch-update";
import { applyEditsToText } from "./edit";
import { parseApplyPatch } from "./apply-patch-parse";
import type {
  ApplyPatchSummary,
  FileToolOperations,
  FileEdit,
  NormalizedReadInput,
  NormalizedWriteInput,
  ResolveFileToolPath,
} from "./types";

export type ReadBounds = {
  maxLines?: number;
  maxBytes?: number;
};

export type ReadExecuteResult = {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
};

export type WriteExecuteResult = {
  path: string;
  created: boolean;
  changed: boolean;
};

export type EditExecuteResult =
  | { ok: true; path: string; content: string }
  | {
      ok: false;
      path: string;
      reason: "match_not_found" | "ambiguous_match" | "overlapping_hunks" | "no_change";
      matchCount?: number;
      hunkIndex?: number;
    };

export async function executeRead(
  operations: FileToolOperations,
  resolvePath: ResolveFileToolPath,
  input: NormalizedReadInput,
  bounds: ReadBounds = {},
): Promise<ReadExecuteResult> {
  const path = resolvePath(input.path);
  const content = await operations.readFile(path);
  const lines = content.split(/\r?\n/u);
  const totalLines = lines.length;
  const startLine = input.startLine ?? 1;
  const requestedEnd = Math.min(input.endLine ?? totalLines, totalLines);
  if (startLine > requestedEnd || startLine > totalLines) {
    throw new Error("Requested file line range is empty or reversed.");
  }
  const maxLines = bounds.maxLines ?? 500;
  const maxBytes = bounds.maxBytes ?? 60 * 1024;
  const boundedEnd = Math.min(requestedEnd, startLine + maxLines - 1);
  const selected = lines.slice(startLine - 1, boundedEnd).join("\n");
  const text = truncateUtf8(selected, maxBytes);
  const selectedLineCount = Math.min(
    boundedEnd - startLine + 1,
    text.split("\n").length,
  );
  return {
    path,
    text,
    startLine,
    endLine: startLine + selectedLineCount - 1,
    totalLines,
    truncated: boundedEnd < requestedEnd || byteLength(selected) > maxBytes,
  };
}

export async function executeWrite(
  operations: FileToolOperations,
  resolvePath: ResolveFileToolPath,
  input: NormalizedWriteInput,
): Promise<WriteExecuteResult> {
  const path = resolvePath(input.path);
  const existing = await operations.stat(path);
  if (existing?.type === "directory") {
    throw new Error(`${path} is a folder`);
  }
  if (existing?.type === "file") {
    const current = await operations.readFile(path);
    if (current === input.content) {
      return { path, created: false, changed: false };
    }
    await operations.writeFile(path, input.content);
    return { path, created: false, changed: true };
  }
  const parent = parentPath(path);
  if (parent) await operations.mkdirp(parent);
  await operations.writeFile(path, input.content);
  return { path, created: true, changed: true };
}

export async function executeEdit(
  operations: FileToolOperations,
  resolvePath: ResolveFileToolPath,
  pathInput: string,
  edits: FileEdit[],
): Promise<EditExecuteResult> {
  const path = resolvePath(pathInput);
  const current = await operations.readFile(path);
  const applied = applyEditsToText(current, edits);
  if (!applied.ok) return { ...applied, path };
  if (applied.content === current) {
    return { ok: false, path, reason: "no_change" };
  }
  await operations.writeFile(path, applied.content);
  return { ok: true, path, content: applied.content };
}

type PlannedFileOp =
  | { kind: "write"; path: string; content: string }
  | { kind: "remove"; path: string };

export async function executeApplyPatch(
  operations: FileToolOperations,
  resolvePath: ResolveFileToolPath,
  input: string,
): Promise<{ summary: ApplyPatchSummary; text: string }> {
  const hunks = parseApplyPatch(input);
  const overlay = new Map<string, string | null>();
  const planned: PlannedFileOp[] = [];
  const summary: ApplyPatchSummary = { added: [], modified: [], deleted: [] };

  const overlayStat = async (path: string) => {
    if (overlay.has(path)) {
      const value = overlay.get(path) ?? null;
      return value === null ? null : { type: "file" as const, size: value.length };
    }
    return operations.stat(path);
  };
  const overlayRead = async (path: string) => {
    if (overlay.has(path)) {
      const value = overlay.get(path);
      if (value == null) throw new Error(`File not found: ${path}`);
      return value;
    }
    return operations.readFile(path);
  };

  for (const hunk of hunks) {
    if (hunk.kind === "add") {
      const path = resolvePath(hunk.path);
      if (await overlayStat(path)) {
        throw new Error(
          `Add File failed: ${path} already exists. Use Update File or delete it earlier in the same patch.`,
        );
      }
      planned.push({ kind: "write", path, content: hunk.contents });
      overlay.set(path, hunk.contents);
      summary.added.push(path);
      continue;
    }
    if (hunk.kind === "delete") {
      const path = resolvePath(hunk.path);
      planned.push({ kind: "remove", path });
      overlay.set(path, null);
      summary.deleted.push(path);
      continue;
    }
    const path = resolvePath(hunk.path);
    const current = await overlayRead(path);
    const applied = applyUpdateChunksToText(current, path, hunk.chunks);
    if (hunk.movePath) {
      const destination = resolvePath(hunk.movePath);
      if (destination !== path) {
        if (await overlayStat(destination)) {
          throw new Error(
            `Move failed: ${destination} already exists. Delete it earlier in the same patch.`,
          );
        }
        planned.push({ kind: "write", path: destination, content: applied });
        planned.push({ kind: "remove", path });
        overlay.set(destination, applied);
        overlay.set(path, null);
        summary.modified.push(destination);
        continue;
      }
    }
    if (applied !== current) {
      planned.push({ kind: "write", path, content: applied });
      overlay.set(path, applied);
      summary.modified.push(path);
    }
  }

  for (const operation of planned) {
    if (operation.kind === "write") {
      const parent = parentPath(operation.path);
      if (parent) await operations.mkdirp(parent);
      await operations.writeFile(operation.path, operation.content);
      continue;
    }
    await operations.remove(operation.path);
  }
  return {
    summary,
    text: formatSummary(summary),
  };
}

function formatSummary(summary: ApplyPatchSummary): string {
  const lines = ["Success. Updated the following files:"];
  for (const file of summary.added) lines.push(`A ${file}`);
  for (const file of summary.modified) lines.push(`M ${file}`);
  for (const file of summary.deleted) lines.push(`D ${file}`);
  return lines.join("\n");
}

function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "" : null;
  return path.slice(0, index);
}

function truncateUtf8(value: string, limit: number): string {
  if (byteLength(value) <= limit) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(value.slice(0, middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
