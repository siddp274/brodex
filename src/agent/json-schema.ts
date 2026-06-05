// Minimal Zod -> JSON Schema converter, covering exactly the shapes Brodex's
// tools use (objects, strings, numbers, booleans, optional, descriptions).
// Avoids pulling in a full converter dependency. Extend as new shapes appear.
import { z } from "zod"

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema)
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def
  const description = def?.description as string | undefined
  const withDesc = (obj: Record<string, unknown>) =>
    description ? { ...obj, description } : obj

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value)
      if (!isOptional(value)) required.push(key)
    }
    return withDesc({
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    })
  }

  if (schema instanceof z.ZodString) return withDesc({ type: "string" })
  if (schema instanceof z.ZodNumber) return withDesc({ type: "number" })
  if (schema instanceof z.ZodBoolean) return withDesc({ type: "boolean" })

  if (schema instanceof z.ZodArray) {
    return withDesc({ type: "array", items: convert((schema as any)._def.type) })
  }

  if (schema instanceof z.ZodEnum) {
    return withDesc({ type: "string", enum: (schema as any)._def.values })
  }

  if (schema instanceof z.ZodOptional) {
    return convert((schema as any)._def.innerType)
  }
  if (schema instanceof z.ZodDefault) {
    return convert((schema as any)._def.innerType)
  }

  // Fallback: permissive.
  return withDesc({})
}

function isOptional(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault
}
