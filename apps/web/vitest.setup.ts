import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock requestAnimationFrame
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(() => callback(performance.now()), 16) as unknown as number;
  };
}
if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}

// Mock Element.scrollIntoView
if (!window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = function () {};
}
