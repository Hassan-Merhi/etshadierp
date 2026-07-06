import "@testing-library/jest-dom";

// jsdom does not implement ResizeObserver — stub it so components using it don't crash
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
