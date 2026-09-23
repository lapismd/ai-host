import { catalogEntriesForAgent } from "../acp/acp-model-catalog";
import {
  ACP_MODEL_CATALOG_UNAVAILABLE,
  type AcpConfigOption,
  type AcpModelCatalog,
  type AcpxRuntimeLike,
} from "./types";

export function modelCatalogFromStatus(
  agent: string,
  status: Awaited<ReturnType<NonNullable<AcpxRuntimeLike["getStatus"]>>>,
): AcpModelCatalog {
  const currentModel = status.models?.currentModelId?.trim() || undefined;
  const models = [
    ...new Set(
      (status.models?.availableModelIds ?? [])
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ];
  return {
    agent,
    currentModel,
    models,
    entries: catalogEntriesForAgent(agent, models),
    configOptions: parseAcpConfigOptions(status.details?.configOptions),
  };
}

export function unavailableAcpModelCatalog(agent: string): AcpModelCatalog {
  return {
    agent,
    models: [],
    entries: [],
    configOptions: [],
    error: ACP_MODEL_CATALOG_UNAVAILABLE,
  };
}

export function rememberLastGoodCatalog(
  cache: Map<string, AcpModelCatalog>,
  catalog: AcpModelCatalog,
): void {
  if (catalog.error || catalog.models.length === 0) return;
  cache.set(catalog.agent, {
    agent: catalog.agent,
    ...(catalog.currentModel ? { currentModel: catalog.currentModel } : {}),
    models: [...catalog.models],
    entries: catalog.entries.map((entry) => ({ ...entry })),
    configOptions: catalog.configOptions.map((option) => ({ ...option })),
  });
}

export function parseAcpConfigOptions(value: unknown): AcpConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AcpConfigOption[] => {
    if (!item || typeof item !== "object") return [];
    const option = item as Record<string, unknown>;
    const id = typeof option.id === "string" ? option.id.trim() : "";
    const name = typeof option.name === "string" ? option.name.trim() : "";
    const type = option.type;
    const currentValue = option.currentValue;
    if (
      !id ||
      !name ||
      (type !== "select" && type !== "boolean") ||
      (typeof currentValue !== "string" && typeof currentValue !== "boolean")
    )
      return [];
    const values =
      type === "select" && Array.isArray(option.options)
        ? option.options.flatMap(
            (entry): NonNullable<AcpConfigOption["options"]> => {
              if (!entry || typeof entry !== "object") return [];
              const candidate = entry as Record<string, unknown>;
              const value =
                typeof candidate.value === "string"
                  ? candidate.value.trim()
                  : "";
              const label =
                typeof candidate.name === "string" ? candidate.name.trim() : "";
              return value && label
                ? [
                    {
                      value,
                      name: label,
                      ...(typeof candidate.description === "string" &&
                      candidate.description.trim()
                        ? { description: candidate.description.trim() }
                        : {}),
                    },
                  ]
                : [];
            },
          )
        : undefined;
    if (type === "select" && (!values || values.length === 0)) return [];
    return [
      {
        id,
        name,
        type,
        currentValue,
        ...(typeof option.description === "string" && option.description.trim()
          ? { description: option.description.trim() }
          : {}),
        ...(typeof option.category === "string" && option.category.trim()
          ? { category: option.category.trim() }
          : {}),
        ...(values ? { options: values } : {}),
      },
    ];
  });
}
