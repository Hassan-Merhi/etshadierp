import { beforeEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.hoisted(() => vi.fn<(path: string) => boolean>());

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
}));

import { existingStringPath } from "../server/lib/puppeteerPath";

describe("existingStringPath", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
  });

  it("never passes Promise-valued Puppeteer paths to fs.existsSync", () => {
    expect(existingStringPath(Promise.resolve("/tmp/chrome"))).toBeNull();
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it("rejects other non-path values without touching fs.existsSync", () => {
    for (const candidate of [undefined, null, 42, {}, [], true]) {
      expect(existingStringPath(candidate)).toBeNull();
    }
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it("checks concrete string paths and returns only existing ones", () => {
    existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(existingStringPath("/opt/chrome")).toBe("/opt/chrome");
    expect(existingStringPath("/missing/chrome")).toBeNull();
    expect(existsSyncMock).toHaveBeenNthCalledWith(1, "/opt/chrome");
    expect(existsSyncMock).toHaveBeenNthCalledWith(2, "/missing/chrome");
  });
});
