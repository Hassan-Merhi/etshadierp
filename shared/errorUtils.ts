export interface ErrorDetails {
  message: string;
  optionalMessage?: string;
  name?: string;
  status?: number;
  code?: string | number;
}

function isPropertyBag(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function getErrorDetails(error: unknown): ErrorDetails {
  const bag = isPropertyBag(error) ? error : undefined;
  const objectMessage = typeof bag?.message === "string" ? bag.message : undefined;
  const stringMessage = typeof error === "string" ? error : undefined;
  const optionalMessage = objectMessage ?? stringMessage;
  const name = typeof bag?.name === "string" ? bag.name : undefined;
  const status = typeof bag?.status === "number" ? bag.status : undefined;
  const code = typeof bag?.code === "string" || typeof bag?.code === "number" ? bag.code : undefined;
  return { message: optionalMessage ?? "Unknown error", optionalMessage, name, status, code };
}
