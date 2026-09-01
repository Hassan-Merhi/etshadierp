import { zodResolver as baseZodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";

/**
 * Zod 4's input/output distinction is intentionally broader than the
 * form-value type used by these existing screens (coercion and defaults are
 * applied by the resolver). Keep that runtime behavior while exposing the
 * screen's explicit form type to react-hook-form.
 */
type CompatibleResolver = <Input extends FieldValues, Context = object>(
  schema: Parameters<typeof baseZodResolver>[0],
  schemaOptions?: Parameters<typeof baseZodResolver>[1],
  resolverOptions?: Parameters<typeof baseZodResolver>[2]
) => Resolver<Input, Context, Input>;

export const zodResolver = ((
  schema: Parameters<typeof baseZodResolver>[0],
  schemaOptions: Parameters<typeof baseZodResolver>[1],
  resolverOptions: Parameters<typeof baseZodResolver>[2]
) => baseZodResolver(schema, schemaOptions, resolverOptions)) as unknown as CompatibleResolver;
