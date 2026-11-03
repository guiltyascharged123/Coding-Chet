import { z, type ZodError } from 'zod';

/** Field paths and sizes only; never echo credential values from rejected requests. */
export function validationMessages(error: ZodError, input?: unknown, prefix = 'input') {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.map((key) => String(key)).join('.') || prefix;
    const value = issue.path.reduce<unknown>(
      (entry, key) =>
        entry && typeof entry === 'object'
          ? (entry as Record<PropertyKey, unknown>)[key]
          : undefined,
      input,
    );
    const measured =
      typeof value === 'string'
        ? `${value.length} characters`
        : Array.isArray(value)
          ? `${value.length} items`
          : typeof value === 'number'
            ? String(value)
            : '';
    return `${path}: ${issue.message}${measured && ['too_big', 'too_small'].includes(issue.code) ? ` (received ${measured})` : ''}`;
  });
}

/** Native structured output requires every declared property and no defaults.
 * Derive bounds from the validator so grammar and acceptance rules cannot drift.
 */
export function strictResponseSchema(schema: z.ZodType): Record<string, any> {
  const source = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  function strict(value: any): any {
    if (Array.isArray(value)) return value.map(strict);
    if (!value || typeof value !== 'object') return value;
    const next = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$schema' && key !== 'default')
        .map(([key, item]) => [key, strict(item)]),
    );
    if (next.type === 'object' && next.properties) {
      next.additionalProperties = false;
      next.required = Object.keys(next.properties);
    }
    return next;
  }
  return strict(source);
}

/** Preserve the field name even when an endpoint validates one body/query value. */
export function parseField<T extends z.ZodType>(
  schema: T,
  key: string,
  container: unknown,
): z.infer<T> {
  return z.object({ [key]: schema }).parse(container)[key] as z.infer<T>;
}
