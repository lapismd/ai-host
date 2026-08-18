import type { UpdatePatchChunk } from "./types";

const DASH_PUNCTUATION = /[\u2010-\u2015\u2212]/gu;
const SINGLE_QUOTE_PUNCTUATION = /[\u2018-\u201B]/gu;
const DOUBLE_QUOTE_PUNCTUATION = /[\u201C-\u201F]/gu;
const SPACE_PUNCTUATION = /[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu;

export function applyUpdateChunksToText(
  originalContents: string,
  filePath: string,
  chunks: UpdatePatchChunk[],
): string {
  const preserveCrlf = hasOnlyCrlfLineEndings(originalContents);
  const matchingContents = preserveCrlf
    ? originalContents.replace(/\r\n/gu, "\n")
    : originalContents;
  const originalLines = matchingContents.split("\n");
  if (originalLines.at(-1) === "") originalLines.pop();
  const replacements = computeReplacements(originalLines, filePath, chunks);
  let newLines = applyReplacements(originalLines, replacements);
  if (newLines.at(-1) !== "") newLines = [...newLines, ""];
  const updated = newLines.join("\n");
  return preserveCrlf ? updated.replace(/\n/gu, "\r\n") : updated;
}

function hasOnlyCrlfLineEndings(content: string): boolean {
  return content.includes("\r\n") && !/(?<!\r)\n/u.test(content);
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdatePatchChunk[],
): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;
  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const ctxIndex = seekSequence(
        originalLines,
        [chunk.changeContext],
        lineIndex,
        false,
      );
      if (ctxIndex === null) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${filePath}`);
      }
      lineIndex = ctxIndex + 1;
    }
    if (chunk.oldLines.length === 0) {
      const insertionIndex =
        chunk.changeContext && !chunk.isEndOfFile
          ? lineIndex
          : originalLines.length;
      replacements.push([insertionIndex, 0, chunk.newLines]);
      lineIndex = insertionIndex;
      continue;
    }
    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(
      originalLines,
      pattern,
      lineIndex,
      chunk.isEndOfFile,
    );
    if (found === null && pattern.at(-1) === "") {
      pattern = pattern.slice(0, -1);
      if (newSlice.at(-1) === "") newSlice = newSlice.slice(0, -1);
      found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }
    if (found === null) {
      throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`,
      );
    }
    replacements.push([
      found,
      pattern.length,
      keepContextBytes({
        originalLines,
        matchIndex: found,
        patternLength: pattern.length,
        newSlice,
        contextOldIndexes: chunk.contextOldIndexes,
      }),
    ]);
    lineIndex = found + pattern.length;
  }
  return replacements.sort((left, right) => left[0] - right[0]);
}

function keepContextBytes(params: {
  originalLines: string[];
  matchIndex: number;
  patternLength: number;
  newSlice: string[];
  contextOldIndexes: Array<number | undefined>;
}): string[] {
  const { originalLines, matchIndex, patternLength, newSlice, contextOldIndexes } =
    params;
  return newSlice.map((line, index) => {
    const oldIndex = contextOldIndexes.at(index);
    if (oldIndex === undefined || oldIndex >= patternLength) return line;
    return originalLines.at(matchIndex + oldIndex) ?? line;
  });
}

function applyReplacements(
  lines: string[],
  replacements: Array<[number, number, string[]]>,
): string[] {
  const result = [...lines];
  for (const [startIndex, oldLen, newLines] of [...replacements].reverse()) {
    result.splice(startIndex, oldLen, ...newLines);
  }
  return result;
}

function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
): number | null {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;
  const maxStart = lines.length - pattern.length;
  const searchStart = eof && lines.length >= pattern.length ? maxStart : start;
  if (searchStart > maxStart) return null;
  const normalizers = [
    (value: string) => value,
    (value: string) => value.trimEnd(),
    (value: string) => value.trim(),
    (value: string) => normalizePunctuation(value.trim()),
  ];
  for (const normalize of normalizers) {
    for (let index = searchStart; index <= maxStart; index += 1) {
      if (linesMatch(lines, pattern, index, normalize)) return index;
    }
  }
  return null;
}

function linesMatch(
  lines: string[],
  pattern: string[],
  start: number,
  normalize: (value: string) => string,
): boolean {
  return pattern.every((expected, offset) => {
    const line = lines.at(start + offset);
    return line !== undefined && normalize(line) === normalize(expected);
  });
}

function normalizePunctuation(value: string): string {
  return value
    .replace(DASH_PUNCTUATION, "-")
    .replace(SINGLE_QUOTE_PUNCTUATION, "'")
    .replace(DOUBLE_QUOTE_PUNCTUATION, '"')
    .replace(SPACE_PUNCTUATION, " ");
}
