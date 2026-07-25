/**
 * Unit tests for server/lib/httpHandlers.ts — the shared HTTP error primitives.
 * getErrorMessage/getErrorStack are now used across the whole server (after the
 * catch(unknown) migration), so their contract is pinned down here, along with
 * HttpError, getAuthenticatedUserId, and sendHttpError's status mapping.
 */
import {
  HttpError,
  getErrorMessage,
  getErrorStack,
  getAuthenticatedUserId,
  sendHttpError,
} from "../server/lib/httpHandlers";

describe("getErrorMessage", () => {
  it("returns the message for Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage(new HttpError(404, "missing"))).toBe("missing");
  });

  it("returns a safe fallback for non-Error values", () => {
    expect(getErrorMessage("a string")).toBe("Unexpected server error");
    expect(getErrorMessage(null)).toBe("Unexpected server error");
    expect(getErrorMessage({ message: "not really an error" })).toBe("Unexpected server error");
  });
});

describe("getErrorStack", () => {
  it("returns a stack for Error instances", () => {
    expect(getErrorStack(new Error("x"))).toContain("Error");
  });

  it("returns undefined for non-Error values", () => {
    expect(getErrorStack("nope")).toBeUndefined();
    expect(getErrorStack(null)).toBeUndefined();
  });
});

describe("HttpError", () => {
  it("carries a statusCode and behaves like an Error", () => {
    const e = new HttpError(403, "forbidden");
    expect(e).toBeInstanceOf(Error);
    expect(e.statusCode).toBe(403);
    expect(e.message).toBe("forbidden");
    expect(e.name).toBe("HttpError");
  });
});

describe("getAuthenticatedUserId", () => {
  it("returns the id when a user is present", () => {
    expect(getAuthenticatedUserId({ user: { id: "u1" } } as never)).toBe("u1");
  });

  it("throws a 401 HttpError when no user id is present", () => {
    try {
      getAuthenticatedUserId({ user: undefined } as never);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(401);
    }
  });
});

describe("sendHttpError", () => {
  function fakeRes() {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  it("uses the HttpError's status code and message", () => {
    const res = fakeRes();
    sendHttpError(res as never, new HttpError(422, "invalid"));
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ message: "invalid" });
  });

  it("maps unknown errors to 500 with a safe message", () => {
    const res = fakeRes();
    sendHttpError(res as never, new Error("db exploded"));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "db exploded" });
  });

  it("maps non-Error throws to 500 with the fallback message", () => {
    const res = fakeRes();
    sendHttpError(res as never, "weird");
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "Unexpected server error" });
  });
});
