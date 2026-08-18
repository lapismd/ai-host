export const READ_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    file_path: { type: "string", minLength: 1, maxLength: 1_024 },
    startLine: { type: "integer", minimum: 1 },
    endLine: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

export const WRITE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    file_path: { type: "string", minLength: 1, maxLength: 1_024 },
    content: { type: "string", maxLength: 262_144 },
  },
  required: ["content"],
  additionalProperties: false,
} as const;

export const EDIT_REPLACEMENT_SCHEMA = {
  type: "object",
  properties: {
    oldText: { type: "string", minLength: 1, maxLength: 16_384 },
    newText: { type: "string", maxLength: 16_384 },
    old_string: { type: "string", minLength: 1, maxLength: 16_384 },
    new_string: { type: "string", maxLength: 16_384 },
    old_str: { type: "string", minLength: 1, maxLength: 16_384 },
    new_str: { type: "string", maxLength: 16_384 },
  },
  additionalProperties: false,
} as const;

export const EDIT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    file_path: { type: "string", minLength: 1, maxLength: 1_024 },
    oldText: { type: "string", minLength: 1, maxLength: 16_384 },
    newText: { type: "string", maxLength: 16_384 },
    old_string: { type: "string", minLength: 1, maxLength: 16_384 },
    new_string: { type: "string", maxLength: 16_384 },
    old_str: { type: "string", minLength: 1, maxLength: 16_384 },
    new_str: { type: "string", maxLength: 16_384 },
    edits: {
      anyOf: [
        {
          type: "array",
          minItems: 1,
          items: EDIT_REPLACEMENT_SCHEMA,
        },
        { type: "string", minLength: 2 },
      ],
    },
  },
  additionalProperties: false,
} as const;

export const APPLY_PATCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    input: { type: "string", minLength: 1, maxLength: 262_144 },
    patch: { type: "string", minLength: 1, maxLength: 262_144 },
  },
  additionalProperties: false,
} as const;
