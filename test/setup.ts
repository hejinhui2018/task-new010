import '@testing-library/jest-dom/vitest';

// jsdom 不提供 ResizeObserver；时间线组件依赖它自适应列宽，测试中给一个固定宽度的桩
class ResizeObserverStub {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    // 异步触发，对齐真实 ResizeObserver 的触发时机
    queueMicrotask(() => {
      const entry = {
        target,
        contentRect: { width: 960, height: 200, top: 0, left: 0, right: 960, bottom: 200, x: 0, y: 0, toJSON: () => ({}) },
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this);
    });
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
