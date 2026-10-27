/** JSON paths deliberately support only dotted keys and array indices, never scripts or expressions. */
export function atPath(value: unknown, path: string): unknown {
  if (!path || path === "$") return value;
  const parts = path
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "")
    .split(".");
  if (parts.length > 20 || parts.some((p) => !p || ["__proto__", "prototype", "constructor"].includes(p)))
    throw new Error("Use a plain field path, such as data.results or company.domain.");
  let out = value;
  for (const part of parts) {
    if (out === null || typeof out !== "object" || !Object.hasOwn(out, part)) return undefined;
    out = (out as Record<string, unknown>)[part];
  }
  return out;
}
export function mapRows(value: unknown, path: string, fields: Record<string, string>): Record<string, unknown>[] {
  const data = atPath(value, path);
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : null;
  if (!rows) throw new Error("The result path doesn't contain records. Preview the response and choose its array field.");
  if (rows.length > 5000) throw new Error("Use at most 5,000 records per import.");
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(fields)
        .filter(([, source]) => source.trim())
        .map(([name, source]) => [name, atPath(row, source)]),
    ),
  );
}
export function fieldPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 4) return prefix ? [prefix] : [];
  if (Array.isArray(value)) return fieldPaths(value[0], prefix ? `${prefix}[0]` : "[0]", depth + 1);
  return Object.entries(value)
    .slice(0, 80)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return child && typeof child === "object" ? [path, ...fieldPaths(child, path, depth + 1)] : [path];
    });
}

/** Small, bounded JSON Schema validator for imported read tools. Unsupported contracts fail visibly. */
export function checkInput(schema: Record<string, unknown>, input: unknown, path = "input", depth = 0): void {
  if (depth > 12) throw new Error("Tool input schema is too deeply nested.");
  if (schema.$ref) throw new Error("Unresolved tool schema reference.");
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    if (!Array.isArray(schema[key])) continue;
    const options = schema[key] as Record<string, unknown>[];
    if (options.length > 20) throw new Error("This tool schema has too many alternatives.");
    let matches = 0;
    for (const option of options) {
      try {
        checkInput(option, input, path, depth + 1);
        matches++;
      } catch {
        /* try the other declared alternatives */
      }
    }
    if (key === "allOf" ? matches !== options.length : key === "oneOf" ? matches !== 1 : !matches)
      throw new Error(`${path} doesn't match the tool's input contract.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(input)))
    throw new Error(`${path} must be one of the tool's allowed values.`);
  const type = schema.type;
  if (Array.isArray(type)) {
    if (input === null && type.includes("null")) return;
    return checkInput({ ...schema, type: type.find((t) => t !== "null") }, input, path, depth + 1);
  }
  if (input === null && schema.nullable === true) return;
  if (type === "object" || schema.properties) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${path} must be an object.`);
    const data = input as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required ?? []) as string[]) if (data[key] === undefined) throw new Error(`Provide the required field ${key}.`);
    for (const [key, value] of Object.entries(data)) {
      if (!props[key] && schema.additionalProperties === false) throw new Error(`${key} is not accepted by this tool.`);
      if (props[key]) checkInput(props[key], value, `${path}.${key}`, depth + 1);
    }
  } else if (type === "array") {
    if (!Array.isArray(input)) throw new Error(`${path} must be a list.`);
    if (input.length > Number(schema.maxItems ?? 1000) || input.length < Number(schema.minItems ?? 0))
      throw new Error(`${path} has the wrong number of items.`);
    for (const item of input) checkInput((schema.items ?? {}) as Record<string, unknown>, item, path, depth + 1);
  } else if (type === "string") {
    if (typeof input !== "string" || input.length > Number(schema.maxLength ?? 20000) || input.length < Number(schema.minLength ?? 0))
      throw new Error(`${path} must be text within the tool's length limits.`);
  } else if (type === "number" || type === "integer") {
    if (
      typeof input !== "number" ||
      !Number.isFinite(input) ||
      (type === "integer" && !Number.isInteger(input)) ||
      input < Number(schema.minimum ?? -Infinity) ||
      input > Number(schema.maximum ?? Infinity)
    )
      throw new Error(`${path} must be a number within the tool's limits.`);
  } else if (type === "boolean" && typeof input !== "boolean") throw new Error(`${path} must be true or false.`);
}
