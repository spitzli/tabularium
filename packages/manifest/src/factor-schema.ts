const maps = new Set(['properties', 'patternProperties', 'dependentSchemas'])
const lists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const children = new Set(['not', 'if', 'then', 'else', 'items', 'contains', 'additionalProperties', 'propertyNames'])
type Schema = Record<string, unknown>
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value)

/** Share identical, repeated schemas in generated output; never rewrite data literals. */
export function factorSchema(schema: Schema): Schema {
  const occurrences = new Map<string, { count: number; schema: Schema }>()
  let scoped = false
  function visit(node: unknown, root = false): void {
    if (!object(node)) return
    if ('$ref' in node || '$defs' in node || (!root && '$id' in node)) scoped = true
    const key = JSON.stringify(node)
    if (!root && key.length >= 256) {
      const found = occurrences.get(key)
      if (found) found.count++
      else occurrences.set(key, { count: 1, schema: node })
    }
    for (const [keyword, value] of Object.entries(node)) {
      if (maps.has(keyword) && object(value)) for (const child of Object.values(value)) visit(child)
      else if (lists.has(keyword) && Array.isArray(value)) for (const child of value) visit(child)
      else if (children.has(keyword)) visit(value)
    }
  }
  visit(schema, true)
  // Existing references/scopes may have their own identity rules. Raw operator
  // root policies already forbid them; leave other callers' schemas untouched.
  if (scoped) return schema
  const definitions = new Map<string, { name: string; schema: Schema }>()
  for (const [key, value] of occurrences) {
    if (value.count > 1) definitions.set(key, { name: `shared${definitions.size}`, schema: value.schema })
  }
  if (definitions.size === 0) return schema
  function replace(node: unknown, ownKey?: string): unknown {
    if (!object(node)) return node
    const key = JSON.stringify(node)
    const found = definitions.get(key)
    if (found && key !== ownKey) return { $ref: `#/$defs/${found.name}` }
    return Object.fromEntries(
      Object.entries(node).map(([keyword, value]) => {
        if (maps.has(keyword) && object(value))
          return [keyword, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, replace(child)]))]
        if (lists.has(keyword) && Array.isArray(value)) return [keyword, value.map((child) => replace(child))]
        if (children.has(keyword)) return [keyword, replace(value)]
        return [keyword, value]
      }),
    )
  }
  // References always point to a strictly smaller repeated subtree, so this
  // generated graph cannot contain a cycle or resolve outside this document.
  return {
    ...(replace(schema) as Schema),
    $defs: Object.fromEntries([...definitions].map(([key, value]) => [value.name, replace(value.schema, key)])),
  }
}
