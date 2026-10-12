import { ToolCallDelta } from "..";

export const MALFORMED_RESPONSE_PREFIX = "MALFORMED_RESPONSE";
export const INVALID_ARGS = "INVALID_ARGS";
export const UNKNOWN_TOOL = "UNKNOWN_TOOL";
export const POLICY_BLOCKED = "POLICY_BLOCKED";

const ARGUMENT_PREVIEW_LIMIT = 500;

export type ParsedToolArguments =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; violations: string[] };

/**
 * Empty or missing arguments become {}. A broken JSON string is not repaired:
 * the original text stays in the violation so execute is never called with {}.
 */
export function parseToolCallArguments(raw: unknown): ParsedToolArguments {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, args: {} };
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ok: true, args: raw as Record<string, unknown> };
  }

  if (typeof raw !== "string") {
    return {
      ok: false,
      violations: [
        "arguments must be a JSON object; the original value was left unchanged",
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const preview =
      raw.length > ARGUMENT_PREVIEW_LIMIT
        ? `${raw.slice(0, ARGUMENT_PREVIEW_LIMIT)}…`
        : raw;
    return {
      ok: false,
      violations: [
        `arguments are not valid JSON (${detail}); the original string was left unchanged: ${preview}`,
      ],
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      violations: ["arguments must be a JSON object"],
    };
  }

  return { ok: true, args: parsed as Record<string, unknown> };
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "null":
      return value === null;
    default:
      return true;
  }
}

/**
 * Collect every top-level schema violation. Missing required fields and type
 * mismatches are reported together so the model can fix the call in one retry.
 */
export function collectSchemaViolations(
  args: Record<string, unknown>,
  schema?: Record<string, any>,
): string[] {
  if (!schema) {
    return [];
  }

  const violations: string[] = [];
  const properties: Record<string, any> = schema.properties ?? {};
  const required: string[] = Array.isArray(schema.required)
    ? schema.required
    : [];

  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      violations.push(`\`${key}\` is required`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!property) {
      if (schema.additionalProperties === false) {
        violations.push(`\`${key}\` is not allowed`);
      }
      continue;
    }
    if (value === undefined) {
      continue;
    }

    const declaredType = property.type;
    if (declaredType) {
      const types = Array.isArray(declaredType) ? declaredType : [declaredType];
      if (!types.some((type) => matchesJsonType(value, String(type)))) {
        violations.push(`\`${key}\` must be of type ${types.join(" | ")}`);
      }
    }

    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      violations.push(
        `\`${key}\` must be one of: ${property.enum.map(String).join(", ")}`,
      );
    }
  }

  return violations;
}

export function formatInvalidArgs(
  toolName: string,
  violations: string[],
): string {
  const lines = violations.map((violation) => `- ${violation}`).join("\n");
  return `${INVALID_ARGS}: Tool "${toolName}" was not executed because the arguments are invalid:\n${lines}\n\nFix the arguments and call again in this response.`;
}

export function formatUnknownTool(toolName: string): string {
  return `${UNKNOWN_TOOL}: Tool "${toolName}" is not available and was not executed.\n\nUse one of the tools in this request instead.`;
}

/**
 * A tool call that cannot be identified is not a tool. Empty id or name means
 * the stream itself is broken and the whole request should fail.
 */
export function malformedToolCallReason(
  toolCall: ToolCallDelta,
): string | undefined {
  if (!toolCall.id?.trim()) {
    return "tool call is missing an id";
  }
  if (!toolCall.function?.name?.trim()) {
    return "tool call is missing a name";
  }
  return undefined;
}

/**
 * A tool call with an id and a name, but arguments that are not a JSON object.
 * The tool must not run; the model receives this as a tool result error.
 * Empty or missing arguments are allowed and parsed as {}.
 */
export function invalidToolArgumentsMessage(
  args: string | undefined,
): string | undefined {
  const parsed = parseToolCallArguments(args);
  if (parsed.ok) {
    return undefined;
  }
  return parsed.violations.join("; ");
}

export function isMalformedStreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(MALFORMED_RESPONSE_PREFIX) ||
    message.includes("Malformed JSON sent from server")
  );
}

export function toMalformedResponseError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(MALFORMED_RESPONSE_PREFIX)) {
    return error instanceof Error ? error : new Error(message);
  }
  return new Error(`${MALFORMED_RESPONSE_PREFIX}: ${message}`);
}
