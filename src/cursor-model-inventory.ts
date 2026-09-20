export type CursorListedModel = {
  id: string;
  label: string;
  current?: boolean;
  default?: boolean;
};

const MARKERS = /\s+\((?:current|default)\)$/iu;

export function parseCursorListModelsOutput(stdout: string): CursorListedModel[] {
  const models: CursorListedModel[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || /^available models$/iu.test(line)) continue;
    const separator = line.indexOf(" - ");
    const id = (separator >= 0 ? line.slice(0, separator) : line).trim();
    if (!id || seen.has(id)) continue;
    const rest = separator >= 0 ? line.slice(separator + 3).trim() : id;
    const current = /\(current\)/iu.test(rest);
    const isDefault = /\(default\)/iu.test(rest);
    seen.add(id);
    models.push({
      id,
      label: rest.replace(MARKERS, "").trim() || id,
      ...(current ? { current: true } : {}),
      ...(isDefault ? { default: true } : {}),
    });
  }
  return models;
}
