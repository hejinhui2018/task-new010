import type { CancelCommand, TaskCategory, TaskSpec } from './types';

export const CATEGORY_META: Record<
  TaskCategory,
  { label: string; color: string; colorDark: string; glyph: string }
> = {
  decode: { label: '解码', color: '#2a78d6', colorDark: '#3987e5', glyph: 'D' },
  layout: { label: '布局', color: '#eb6834', colorDark: '#d95926', glyph: 'L' },
  log: { label: '日志', color: '#1baf7a', colorDark: '#199e70', glyph: 'J' },
  preload: { label: '预加载', color: '#eda100', colorDark: '#c98500', glyph: 'P' },
  custom: { label: '自定义', color: '#e87ba4', colorDark: '#d55181', glyph: 'C' },
};

export interface ScenarioPreset {
  id: string;
  name: string;
  summary: string;
  tasks: TaskSpec[];
  cancels: CancelCommand[];
  /** 巡检结论模板中引用的关键任务 id */
  keyTasks: { preloadId: string };
}

/**
 * 内置场景：导播在直播中「切换直播画面」。
 *
 * 一次切台动作在帧 0 同时入队四类主线程工作：
 * - 解码新机位关键帧（用户阻塞，14ms，不可取消）
 * - 重新计算画中画布局（高优先级，12ms）
 * - 上报切台日志（普通，6ms）
 * - 预加载下一路信号的缓存片段（空闲，55ms，可取消）
 *
 * 16ms 预算下解码+布局在首帧放不下，而空闲预加载一旦启动会连续跨过多个 vsync
 * （55ms 同时越过 longtask 的 50ms 阈值）。取消预加载或调整优先级后，
 * 掉帧数与完成时间由引擎确定性地重新计算。
 */
export function createSceneSwitchPreset(): ScenarioPreset {
  const tasks: TaskSpec[] = [
    {
      id: 'decode',
      label: '解码新机位关键帧',
      category: 'decode',
      priority: 0,
      duration: 14,
      arrivalFrame: 0,
      cancelable: false,
      description: '切台后必须先解码新信号的关键帧，用户阻塞且不可取消',
    },
    {
      id: 'layout',
      label: '重算画中画布局',
      category: 'layout',
      priority: 1,
      duration: 12,
      arrivalFrame: 0,
      cancelable: true,
      description: '布局测量与样式重算，决定观众看到的新画面能否按时合成',
    },
    {
      id: 'log',
      label: '上报切台操作日志',
      category: 'log',
      priority: 2,
      duration: 6,
      arrivalFrame: 0,
      cancelable: true,
      description: '写审计日志并上报埋点，不影响观众画面',
    },
    {
      id: 'preload',
      label: '预加载下一路信号',
      category: 'preload',
      priority: 3,
      duration: 55,
      arrivalFrame: 0,
      cancelable: true,
      description: '空闲时预热下一位主播的信号缓存；切台瞬间属于可牺牲的投机工作',
    },
  ];
  return {
    id: 'scene-switch',
    name: '切换直播画面',
    summary:
      '导播切台：解码、布局、日志与一路 55ms 的空闲预加载同时入队，观察它们如何争抢 16ms 帧预算。',
    tasks,
    cancels: [],
    keyTasks: { preloadId: 'preload' },
  };
}

export const PRESETS: Array<() => ScenarioPreset> = [createSceneSwitchPreset];
