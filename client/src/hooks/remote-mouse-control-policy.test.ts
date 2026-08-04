// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRemoteMouseCommand,
  isAllowedRemoteClickElement,
  isRemoteMouseBlockedElement,
  normalizeRemoteMousePoint,
  type RemoteMouseCommandType,
  type RemoteMouseCommandView,
} from "./remote-mouse-control-policy";

function command(
  type: RemoteMouseCommandType,
  overrides: Partial<RemoteMouseCommandView> = {}
): RemoteMouseCommandView {
  return {
    id: "command-1",
    sessionId: "session-1",
    type,
    sequence: 1,
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}

describe("remote mouse execution policy", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  });

  it("normalizes points only inside the displayed screen image", () => {
    expect(normalizeRemoteMousePoint(250, 150, { left: 0, top: 0, width: 500, height: 300 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(normalizeRemoteMousePoint(501, 150, { left: 0, top: 0, width: 500, height: 300 })).toBeNull();
    expect(normalizeRemoteMousePoint(10, 10, { left: 0, top: 0, width: 0, height: 300 })).toBeNull();
  });

  it("blocks fields, forms, disabled controls, and protected surfaces", () => {
    const form = document.createElement("form");
    const viewButton = document.createElement("button");
    viewButton.textContent = "View details";
    form.appendChild(viewButton);
    document.body.appendChild(form);

    const input = document.createElement("input");
    document.body.appendChild(input);
    const destructive = document.createElement("button");
    destructive.textContent = "Delete voucher";
    document.body.appendChild(destructive);
    const protectedControl = document.createElement("button");
    protectedControl.dataset.remoteControlBlocked = "true";
    protectedControl.textContent = "View";
    document.body.appendChild(protectedControl);

    expect(isRemoteMouseBlockedElement(viewButton)).toBe(true);
    expect(isRemoteMouseBlockedElement(input)).toBe(true);
    expect(isRemoteMouseBlockedElement(destructive)).toBe(true);
    expect(isRemoteMouseBlockedElement(protectedControl)).toBe(true);
  });

  it("allows safe tabs, read-only actions, and same-origin navigation", () => {
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    tab.textContent = "Overview";
    document.body.appendChild(tab);

    const viewButton = document.createElement("button");
    viewButton.textContent = "View details";
    document.body.appendChild(viewButton);

    const internalLink = document.createElement("a");
    internalLink.href = "/reports";
    internalLink.textContent = "Reports";
    document.body.appendChild(internalLink);

    const externalLink = document.createElement("a");
    externalLink.href = "https://outside.example.com/";
    externalLink.textContent = "Outside";
    document.body.appendChild(externalLink);

    expect(isAllowedRemoteClickElement(tab)).toBe(true);
    expect(isAllowedRemoteClickElement(viewButton)).toBe(true);
    expect(isAllowedRemoteClickElement(internalLink)).toBe(true);
    expect(isAllowedRemoteClickElement(externalLink)).toBe(false);
  });

  it("requires generic buttons to be explicitly allowlisted", () => {
    const generic = document.createElement("button");
    generic.textContent = "Run action";
    document.body.appendChild(generic);

    const explicitSafe = document.createElement("button");
    explicitSafe.dataset.remoteControlSafe = "true";
    explicitSafe.textContent = "Read-only inspector";
    document.body.appendChild(explicitSafe);

    expect(isAllowedRemoteClickElement(generic)).toBe(false);
    expect(isAllowedRemoteClickElement(explicitSafe)).toBe(true);
  });

  it("executes allowlisted clicks and blocks save or unknown actions", () => {
    const viewButton = document.createElement("button");
    viewButton.textContent = "View history";
    const viewClick = vi.spyOn(viewButton, "click").mockImplementation(() => {});
    document.body.appendChild(viewButton);
    document.elementFromPoint = vi.fn(() => viewButton);

    expect(applyRemoteMouseCommand(command("click"))).toEqual({
      status: "executed",
      reason: null,
      clientX: 500,
      clientY: 300,
    });
    expect(viewClick).toHaveBeenCalledTimes(1);

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save changes";
    document.body.appendChild(saveButton);
    document.elementFromPoint = vi.fn(() => saveButton);
    expect(applyRemoteMouseCommand(command("click"))).toMatchObject({
      status: "blocked",
      reason: "protected-element",
    });

    const unknownButton = document.createElement("button");
    unknownButton.textContent = "Run action";
    document.body.appendChild(unknownButton);
    document.elementFromPoint = vi.fn(() => unknownButton);
    expect(applyRemoteMouseCommand(command("click"))).toMatchObject({
      status: "blocked",
      reason: "action-not-allowlisted",
    });
  });

  it("moves the visible support pointer without activating the page", () => {
    document.elementFromPoint = vi.fn(() => null);
    expect(applyRemoteMouseCommand(command("pointer-move", { x: 0.25, y: 0.75 }))).toEqual({
      status: "executed",
      reason: null,
      clientX: 250,
      clientY: 450,
    });
  });

  it("scrolls the nearest local scroll container before falling back to the window", () => {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    const child = document.createElement("span");
    container.appendChild(child);
    document.body.appendChild(container);
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 100 },
    });
    const scrollBy = vi.fn();
    container.scrollBy = scrollBy;
    document.elementFromPoint = vi.fn(() => child);

    expect(applyRemoteMouseCommand(command("scroll", { deltaX: 0, deltaY: 240 }))).toMatchObject({
      status: "executed",
      reason: null,
    });
    expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 240, behavior: "auto" });

    const plainTarget = document.createElement("div");
    document.body.appendChild(plainTarget);
    document.elementFromPoint = vi.fn(() => plainTarget);
    const windowScrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expect(applyRemoteMouseCommand(command("scroll", { deltaX: 10, deltaY: 40 }))).toMatchObject({
      status: "executed",
      reason: null,
    });
    expect(windowScrollBy).toHaveBeenCalledWith({ left: 10, top: 40, behavior: "auto" });
  });

  it("ignores malformed coordinates, empty scrolls, and missing targets", () => {
    document.elementFromPoint = vi.fn(() => null);
    expect(applyRemoteMouseCommand(command("click", { x: 2 }))).toMatchObject({
      status: "ignored",
      reason: "invalid-coordinates",
    });
    expect(applyRemoteMouseCommand(command("click"))).toMatchObject({
      status: "ignored",
      reason: "no-target",
    });

    const target = document.createElement("div");
    document.body.appendChild(target);
    document.elementFromPoint = vi.fn(() => target);
    expect(applyRemoteMouseCommand(command("scroll", { deltaX: 0, deltaY: 0 }))).toMatchObject({
      status: "ignored",
      reason: "empty-scroll",
    });
  });
});
