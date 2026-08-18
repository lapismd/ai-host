import type { ApplyPatchHunk, UpdatePatchChunk } from "./types";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

export function parseApplyPatch(input: string): ApplyPatchHunk[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Invalid patch: input is empty.");
  const lines = checkPatchBoundariesLenient(trimmed.split(/\r?\n/u));
  const hunks: ApplyPatchHunk[] = [];
  let remaining = lines.slice(1, -1);
  let lineNumber = 2;
  while (remaining.length > 0) {
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    lineNumber += consumed;
    remaining = remaining.slice(consumed);
  }
  if (hunks.length === 0) throw new Error("No files were modified.");
  return hunks;
}

function checkPatchBoundariesLenient(lines: string[]): string[] {
  const strictError = checkPatchBoundariesStrict(lines);
  if (!strictError) return lines;
  if (lines.length < 4) throw new Error(strictError);
  const first = lines[0];
  const last = lines.at(-1);
  if (
    last &&
    (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
    last.endsWith("EOF")
  ) {
    const inner = lines.slice(1, -1);
    const innerError = checkPatchBoundariesStrict(inner);
    if (!innerError) return inner;
    throw new Error(innerError);
  }
  throw new Error(strictError);
}

function checkPatchBoundariesStrict(lines: string[]): string | null {
  const firstLine = lines[0]?.trim();
  const lastLine = lines[lines.length - 1]?.trim();
  if (firstLine === BEGIN_PATCH_MARKER && lastLine === END_PATCH_MARKER) {
    return null;
  }
  if (firstLine !== BEGIN_PATCH_MARKER) {
    return "The first line of the patch must be '*** Begin Patch'";
  }
  return "The last line of the patch must be '*** End Patch'";
}

function parseOneHunk(
  lines: string[],
  lineNumber: number,
): { hunk: ApplyPatchHunk; consumed: number } {
  const firstLine = lines[0]?.trim();
  if (!firstLine) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: empty hunk`);
  }
  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const targetPath = firstLine.slice(ADD_FILE_MARKER.length);
    let contents = "";
    let consumed = 1;
    for (const addLine of lines.slice(1)) {
      if (!addLine.startsWith("+")) break;
      contents += `${addLine.slice(1)}\n`;
      consumed += 1;
    }
    return { hunk: { kind: "add", path: targetPath, contents }, consumed };
  }
  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    return {
      hunk: { kind: "delete", path: firstLine.slice(DELETE_FILE_MARKER.length) },
      consumed: 1,
    };
  }
  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const targetPath = firstLine.slice(UPDATE_FILE_MARKER.length);
    let remaining = lines.slice(1);
    let consumed = 1;
    let movePath: string | undefined;
    const moveCandidate = remaining[0]?.trim();
    if (moveCandidate?.startsWith(MOVE_TO_MARKER)) {
      movePath = moveCandidate.slice(MOVE_TO_MARKER.length);
      remaining = remaining.slice(1);
      consumed += 1;
    }
    const chunks: UpdatePatchChunk[] = [];
    while (remaining.length > 0) {
      const next = remaining[0];
      if (next === undefined) break;
      if (next.trim() === "") {
        remaining = remaining.slice(1);
        consumed += 1;
        continue;
      }
      if (next.startsWith("***")) break;
      const { chunk, consumed: chunkLines } = parseUpdateFileChunk(
        remaining,
        lineNumber + consumed,
        chunks.length === 0,
      );
      chunks.push(chunk);
      remaining = remaining.slice(chunkLines);
      consumed += chunkLines;
    }
    if (chunks.length === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber}: Update file hunk for path '${targetPath}' is empty`,
      );
    }
    return {
      hunk: { kind: "update", path: targetPath, movePath, chunks },
      consumed,
    };
  }
  throw new Error(
    `Invalid patch hunk at line ${lineNumber}: '${lines[0]}' is not a valid hunk header.`,
  );
}

function parseUpdateFileChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdatePatchChunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Update hunk does not contain any lines`,
    );
  }
  let changeContext: string | undefined;
  let startIndex = 0;
  const firstLine = lines[0];
  if (firstLine === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (firstLine?.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = firstLine.slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Expected update hunk to start with a @@ context marker, got: '${firstLine}'`,
    );
  }
  const chunk: UpdatePatchChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    contextOldIndexes: [],
    isEndOfFile: false,
  };
  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new Error(
          `Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`,
        );
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }
    const marker = line[0];
    if (!marker) {
      chunk.contextOldIndexes.push(chunk.oldLines.length);
      chunk.oldLines.push("");
      chunk.newLines.push("");
      parsedLines += 1;
      continue;
    }
    if (marker === " ") {
      const content = line.slice(1);
      chunk.contextOldIndexes.push(chunk.oldLines.length);
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }
    if (marker === "+") {
      chunk.contextOldIndexes.push(undefined);
      chunk.newLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }
    if (marker === "-") {
      chunk.oldLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }
    if (parsedLines === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber + 1}: Unexpected line found in update hunk: '${line}'`,
      );
    }
    break;
  }
  return { chunk, consumed: parsedLines + startIndex };
}
