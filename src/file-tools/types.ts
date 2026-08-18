export type FileToolPathKind = "file" | "directory" | "other";

export type FileToolStat = {
  type: FileToolPathKind;
  size: number;
};

export interface FileToolOperations {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  stat(path: string): Promise<FileToolStat | null>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export type ResolveFileToolPath = (path: string) => string;

export type FileEdit = {
  oldText: string;
  newText: string;
};

export type NormalizedEditInput = {
  path: string;
  edits: FileEdit[];
};

export type NormalizedWriteInput = {
  path: string;
  content: string;
};

export type NormalizedReadInput = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type EditApplySuccess = {
  ok: true;
  content: string;
};

export type EditApplyFailure = {
  ok: false;
  reason: "match_not_found" | "ambiguous_match" | "overlapping_hunks" | "no_change";
  matchCount?: number;
  hunkIndex?: number;
};

export type EditApplyResult = EditApplySuccess | EditApplyFailure;

export type WritePlanResult = {
  path: string;
  content: string;
  created: boolean;
};

export type ApplyPatchSummary = {
  added: string[];
  modified: string[];
  deleted: string[];
};

export type UpdatePatchChunk = {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  contextOldIndexes: Array<number | undefined>;
  isEndOfFile: boolean;
};

export type AddFileHunk = {
  kind: "add";
  path: string;
  contents: string;
};

export type DeleteFileHunk = {
  kind: "delete";
  path: string;
};

export type UpdateFileHunk = {
  kind: "update";
  path: string;
  movePath?: string;
  chunks: UpdatePatchChunk[];
};

export type ApplyPatchHunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;
