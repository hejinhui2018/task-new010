/**
 * 仿真引擎的核心类型定义。
 * 时间单位全部为毫秒（ms），所有数值均为确定性整数/定点输入，不依赖时钟或随机数。
 */

/** 任务优先级：数值越小优先级越高（对齐浏览器 scheduler.postTask 的优先级心智模型） */
export type Priority = 0 | 1 | 2 | 3;

export const PRIORITY_META: ReadonlyArray<{ value: Priority; label: string; hint: string }> = [
  { value: 0, label: '用户阻塞', hint: 'user-blocking：点击响应、关键帧解码等绝不能推迟的工作' },
  { value: 1, label: '高', hint: 'user-visible：画面布局、合成所需的可见工作' },
  { value: 2, label: '普通', hint: '默认优先级：日志、上报等可见但不关键的工作' },
  { value: 3, label: '空闲', hint: 'background：预加载、缓存预热，可被任意高优先级工作推迟' },
];

/** 任务业务类别 —— 颜色与图例按类别固定，编辑参数不会让幸存者变色 */
export type TaskCategory = 'decode' | 'layout' | 'log' | 'preload' | 'custom';

export interface TaskSpec {
  id: string;
  label: string;
  category: TaskCategory;
  priority: Priority;
  /** 任务需要占用的主线程时间（ms），整块执行、不可拆分 */
  duration: number;
  /** 任务入队的帧号（该帧开始时进入等待队列） */
  arrivalFrame: number;
  /** 是否响应取消命令；false 表示同步任务一旦排队就不可移除 */
  cancelable: boolean;
  description?: string;
}

/** 取消命令：在 frame 指定的帧开始、调度之前生效 */
export interface CancelCommand {
  taskId: string;
  frame: number;
}

export interface SimConfig {
  /** 每帧主线程预算（ms），默认 16（约 60fps） */
  frameBudget: number;
  /** 长任务阈值（ms），对齐 PerformanceObserver longtask 的 50ms */
  longTaskThreshold: number;
  /** 仿真安全上限帧数 */
  maxFrames: number;
}

export type TaskStatus = 'completed' | 'cancelled' | 'incomplete';

export interface ScheduledSlice {
  taskId: string;
  /** 该次执行开始的帧号（任务不可拆分，每个任务至多一条 slice） */
  frame: number;
  startMs: number;
  endMs: number;
  duration: number;
  /** 连续执行时间达到长任务阈值 */
  longTask: boolean;
}

export interface FrameCancellation {
  taskId: string;
  /** before-start：任务尚未开始即被移除；ignored-running：任务正在同步执行，运行到完成不可中断 */
  kind: 'before-start' | 'ignored-running' | 'ignored-not-cancelable' | 'ignored-already-done' | 'ignored-unknown';
  atMs: number;
}

export interface FrameRecord {
  index: number;
  startMs: number;
  endMs: number;
  /** 本帧窗口内主线程实际忙碌的 ms（封顶为预算） */
  usedMs: number;
  /** 窗口内留给渲染/空闲的 ms */
  idleMs: number;
  /** 仅记录在起始帧：连续执行超出本帧 deadline 的量 */
  overrunMs: number;
  /** 该 vsync 帧是否错过提交 deadline（被长任务跨越，或本帧任务超时） */
  dropped: boolean;
  /** 该帧窗口是否完全被更早帧发起的长任务占用 */
  blockedByTaskId?: string;
  /** 该帧是否发起了一个长任务 */
  longTask: boolean;
  slices: ScheduledSlice[];
  cancellations: FrameCancellation[];
  /** 帧末仍在等待的任务 id（即本帧被推迟者） */
  pendingIds: string[];
}

export type EventKind =
  | 'arrival'
  | 'start'
  | 'finish'
  | 'defer'
  | 'cancel'
  | 'cancel-ignored'
  | 'longtask'
  | 'drop';

export interface SimEvent {
  frame: number;
  atMs: number;
  kind: EventKind;
  taskId?: string;
  message: string;
}

export interface TaskOutcome {
  taskId: string;
  status: TaskStatus;
  startedFrame: number | null;
  startMs: number | null;
  completedFrame: number | null;
  endMs: number | null;
  cancelledFrame: number | null;
  /** 入队后未被调度的帧数（含到达当帧放不下的情况）— 帧间优先级“抢占”的量化指标 */
  deferredFrames: number;
}

export interface SimMetrics {
  totalFrames: number;
  droppedFrames: number[];
  longTaskFrames: number[];
  /** 最后一个任务到达终态的时间点（ms） */
  completionTimeMs: number;
  completionFrame: number;
  completedCount: number;
  cancelledCount: number;
  totalDeferred: number;
  /** 完成时刻前主线程忙碌占比 0–1 */
  busyRatio: number;
  hitSafetyCap: boolean;
}

export interface SimulationResult {
  config: SimConfig;
  tasks: TaskSpec[];
  cancels: CancelCommand[];
  frames: FrameRecord[];
  slices: ScheduledSlice[];
  outcomes: Record<string, TaskOutcome>;
  events: SimEvent[];
  metrics: SimMetrics;
}

export const DEFAULT_CONFIG: SimConfig = {
  frameBudget: 16,
  longTaskThreshold: 50,
  maxFrames: 240,
};
