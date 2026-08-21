import { zodResolver as baseZodResolver } from "@hookform/resolvers/zod";

/**
 * Zod 4's input/output distinction is intentionally broader than the
 * form-value type used by these existing screens (coercion and defaults are
 * applied by the resolver). Keep that runtime behavior while exposing the
 * screen's explicit form type to react-hook-form.
 */
export const zodResolver = ((schema: any, schemaOptions?: any, resolverOptions?: any) =>
  baseZodResolver(schema, schemaOptions, resolverOptions)) as (...args: any[]) => any;