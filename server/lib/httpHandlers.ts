import type { NextFunction, Request, RequestHandler, Response } from "express";

// Intersect with the globally-augmented `Request["user"]` shape (see the
// Express namespace augmentation in server/index.ts) so this stays a valid
// subtype of Request. User IDs are varchar in the schema, hence `string`.
export interface AuthenticatedRequest extends Request {
  user?: NonNullable<Request["user"]> & {
    id?: string;
    role?: string;
  };
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function getAuthenticatedUserId(request: AuthenticatedRequest): string {
  const userId = request.user?.id;
  if (!userId) {
    throw new HttpError(401, "Not authenticated");
  }
  return userId;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

export function sendHttpError(response: Response, error: unknown): void {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ message: error.message });
    return;
  }

  response.status(500).json({ message: getErrorMessage(error) });
}

export function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
