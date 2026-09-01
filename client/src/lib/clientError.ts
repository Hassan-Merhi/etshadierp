/** Shared client-side error surface used by query/mutation callbacks. */
export interface ClientErrorLike {
  message?: string;
  name?: string;
  _handledGlobally?: boolean;
  description?: string;
  code?: string | number;
}
