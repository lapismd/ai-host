import type { EditApplyResult, FileEdit } from "./types";

function countMatches(content: string, oldText: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = content.indexOf(oldText, offset)) !== -1) {
    count += 1;
    offset += oldText.length;
  }
  return count;
}

export function applyEditsToText(
  content: string,
  edits: FileEdit[],
): EditApplyResult {
  const ranges: Array<{ start: number; end: number; newText: string }> = [];
  for (const [hunkIndex, edit] of edits.entries()) {
    if (edit.oldText === edit.newText) {
      return { ok: false, reason: "no_change", hunkIndex };
    }
    if (!edit.oldText) {
      return { ok: false, reason: "match_not_found", matchCount: 0, hunkIndex };
    }
    const matchCount = countMatches(content, edit.oldText);
    if (matchCount === 0) {
      return { ok: false, reason: "match_not_found", matchCount, hunkIndex };
    }
    if (matchCount !== 1) {
      return { ok: false, reason: "ambiguous_match", matchCount, hunkIndex };
    }
    const start = content.indexOf(edit.oldText);
    const end = start + edit.oldText.length;
    if (
      ranges.some((range) => start < range.end && end > range.start)
    ) {
      return { ok: false, reason: "overlapping_hunks", hunkIndex };
    }
    ranges.push({ start, end, newText: edit.newText });
  }

  ranges.sort((left, right) => right.start - left.start);
  let next = content;
  for (const range of ranges) {
    next = `${next.slice(0, range.start)}${range.newText}${next.slice(range.end)}`;
  }
  if (next === content) return { ok: false, reason: "no_change" };
  return { ok: true, content: next };
}
