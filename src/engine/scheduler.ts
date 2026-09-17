/**
 * 确定性主线程帧调度仿真器。
 *
 * 模型（刻意简化，便于巡检台解释“为什么掉帧”）：
 * - 时间被切成等长 vsync 帧，每帧主线程预算 frameBudget ms（默认 16）。
 * - 任务整块执行、运行到完成（JS 单线程语义）：一旦开始就不可中断；
 *   因此“抢占/取消”只可能发生在任务开始之前 —— 高优先级任务只能推迟
 *   （而非中断）尚未开始的低优先级任务。
 * - 每帧开始时依次处理：新任务入队 → 取消命令生效 → 按 (优先级, 到达顺序) 调度。
 * - 一个任务即便超过本帧剩余预算也会启动并运行到完成，造成后续 vsync 连续掉帧
 *   （长任务，PerformanceObserver longtask 阈值 50ms 会标出）。
 * - 全部计算为纯函数，无时钟、无随机数：相同输入（含乱序输入规范化后）必得相同结果。
 */
import type {
  CancelCommand,
  FrameRecord,
  SimConfig,
  SimEvent,
  SimulationResult,
  ScheduledSlice,
  TaskOutcome,
  TaskSpec,
} from './types';
import { DEFAULT_CONFIG } from './types';

interface PendingTask {
  spec: TaskSpec;
  seq: number;
}

/** 稳定地规范化输入：拷贝、排序、编号，使仿真结果不受数组书写顺序影响 */
export function normalizeInput(
  tasks: readonly TaskSpec[],
  cancels: readonly CancelCommand[] = [],
): { tasks: TaskSpec[]; cancels: CancelCommand[] } {
  if (tasks.some((t) => !t.id)) {
    throw new Error('每个任务必须拥有非空 id');
  }
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`任务 id 重复: ${t.id}`);
    ids.add(t.id);
  }
  const sortedTasks = tasks
    .map((t) => ({ ...t }))
    .sort((a, b) =>
      a.arrivalFrame !== b.arrivalFrame
        ? a.arrivalFrame - b.arrivalFrame
        : a.priority !== b.priority
          ? a.priority - b.priority
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );
  const sortedCancels = cancels
    .map((c) => ({ ...c }))
    .sort((a, b) => (a.frame !== b.frame ? a.frame - b.frame : a.taskId < b.taskId ? -1 : 1));
  return { tasks: sortedTasks, cancels: sortedCancels };
}

export function validateTasks(tasks: readonly TaskSpec[], config: SimConfig = DEFAULT_CONFIG): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    if (!t.id) errors.push('存在没有 id 的任务');
    if (seen.has(t.id)) errors.push(`任务 id 重复: ${t.id}`);
    seen.add(t.id);
    if (!Number.isFinite(t.duration) || t.duration <= 0) {
      errors.push(`任务「${t.label || t.id}」的预计耗时必须为正数（当前 ${t.duration}ms）`);
    }
    if (!Number.isInteger(t.arrivalFrame) || t.arrivalFrame < 0) {
      errors.push(`任务「${t.label || t.id}」的入队帧号必须是非负整数`);
    }
    if (t.priority < 0 || t.priority > 3) {
      errors.push(`任务「${t.label || t.id}」的优先级必须在 0–3 之间`);
    }
  }
  if (config.frameBudget <= 0) errors.push('帧预算必须为正数');
  if (config.longTaskThreshold <= 0) errors.push('长任务阈值必须为正数');
  return [...new Set(errors)];
}

export function runSimulation(
  rawTasks: readonly TaskSpec[],
  rawCancels: readonly CancelCommand[] = [],
  configOverrides: Partial<SimConfig> = {},
): SimulationResult {
  const config: SimConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const { tasks, cancels } = normalizeInput(rawTasks, rawCancels);

  const budget = config.frameBudget;
  const events: SimEvent[] = [];
  const slices: ScheduledSlice[] = [];
  const frames: FrameRecord[] = [];

  /** 到达顺序编号（按规范化后的稳定顺序），同时作为 FIFO tie-break */
  const arrivalSeq = new Map<string, number>();
  tasks.forEach((t, i) => arrivalSeq.set(t.id, i));

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const queue = new Map<string, PendingTask>();
  const outcomes: Record<string, TaskOutcome> = {};
  for (const t of tasks) {
    outcomes[t.id] = {
      taskId: t.id,
      status: 'incomplete',
      startedFrame: null,
      startMs: null,
      completedFrame: null,
      endMs: null,
      cancelledFrame: null,
      deferredFrames: 0,
    };
    events.push({
      frame: t.arrivalFrame,
      atMs: t.arrivalFrame * budget,
      kind: 'arrival',
      taskId: t.id,
      message: `「${t.label}」入队（优先级 ${t.priority}，预计 ${t.duration}ms${t.cancelable ? '，可取消' : '，不可取消'}）`,
    });
  }

  /** 主线程忙碌到的绝对时间点；runUntil > frameStart 表示正在执行长任务 */
  let runUntil = 0;
  let runningTaskId: string | null = null;
  let taskCursor = 0;
  let cancelCursor = 0;
  let hitSafetyCap = false;
  let finishedNaturally = false;

  const pickNext = (): PendingTask | undefined => {
    let best: PendingTask | undefined;
    for (const p of queue.values()) {
      if (!best || p.spec.priority < best.spec.priority || (p.spec.priority === best.spec.priority && p.seq < best.seq)) {
        best = p;
      }
    }
    return best;
  };

  for (let f = 0; f < config.maxFrames; f++) {
    const frameStart = f * budget;
    const frameEnd = frameStart + budget;
    const record: FrameRecord = {
      index: f,
      startMs: frameStart,
      endMs: frameEnd,
      usedMs: 0,
      idleMs: budget,
      overrunMs: 0,
      dropped: false,
      longTask: false,
      slices: [],
      cancellations: [],
      pendingIds: [],
    };

    // 0) 若跨帧执行的任务已在本帧开始前跑完，确认其完成状态
    if (runningTaskId !== null && runUntil <= frameStart) {
      outcomes[runningTaskId].status = 'completed';
      runningTaskId = null;
    }

    // 1) 本帧新到达任务入队
    while (taskCursor < tasks.length && tasks[taskCursor].arrivalFrame === f) {
      const spec = tasks[taskCursor];
      queue.set(spec.id, { spec, seq: arrivalSeq.get(spec.id)! });
      taskCursor++;
    }

    // 2) 取消命令在调度之前生效（任务整块执行，开始后不可取消）
    while (cancelCursor < cancels.length && cancels[cancelCursor].frame === f) {
      const cmd = cancels[cancelCursor];
      cancelCursor++;
      const spec = byId.get(cmd.taskId);
      const atMs = frameStart;
      if (!spec) {
        record.cancellations.push({ taskId: cmd.taskId, kind: 'ignored-unknown', atMs });
        events.push({ frame: f, atMs, kind: 'cancel-ignored', taskId: cmd.taskId, message: `取消被忽略：找不到任务 ${cmd.taskId}` });
        continue;
      }
      const oc = outcomes[spec.id];
      const pending = queue.get(spec.id);
      if (oc.status === 'completed') {
        record.cancellations.push({ taskId: spec.id, kind: 'ignored-already-done', atMs });
        events.push({ frame: f, atMs, kind: 'cancel-ignored', taskId: spec.id, message: `取消「${spec.label}」被忽略：任务已经执行完成` });
      } else if (runningTaskId === spec.id) {
        record.cancellations.push({ taskId: spec.id, kind: 'ignored-running', atMs });
        events.push({ frame: f, atMs, kind: 'cancel-ignored', taskId: spec.id, message: `取消「${spec.label}」被忽略：任务正在同步执行，JS 运行到完成不可中断` });
      } else if (pending) {
        if (!spec.cancelable) {
          record.cancellations.push({ taskId: spec.id, kind: 'ignored-not-cancelable', atMs });
          events.push({ frame: f, atMs, kind: 'cancel-ignored', taskId: spec.id, message: `取消「${spec.label}」被忽略：该任务不可取消` });
        } else {
          queue.delete(spec.id);
          oc.status = 'cancelled';
          oc.cancelledFrame = f;
          record.cancellations.push({ taskId: spec.id, kind: 'before-start', atMs });
          events.push({ frame: f, atMs, kind: 'cancel', taskId: spec.id, message: `「${spec.label}」在开始前被取消，释放其等待位` });
        }
      }
    }

    // 3) 记账：本帧开始时是否仍被上一帧发起的长任务占据
    const blockedAtStart = runUntil > frameStart;
    if (blockedAtStart) {
      record.blockedByTaskId = runningTaskId ?? undefined;
    }

    // 4) 调度：只要线程在本帧 deadline 前变空闲，就按 (优先级, FIFO) 启动下一个任务。
    //    任务即便超出剩余预算也会启动并运行到完成 —— 这正是长任务导致连续掉帧的机制。
    while (runUntil < frameEnd) {
      const chosen = pickNext();
      if (!chosen) break;
      // 能进入循环说明上一个任务已在 frameEnd 前结束：确认其完成状态
      if (runningTaskId !== null) {
        outcomes[runningTaskId].status = 'completed';
        runningTaskId = null;
      }
      queue.delete(chosen.spec.id);
      const start = Math.max(runUntil, frameStart);
      const end = start + chosen.spec.duration;
      const isLong = chosen.spec.duration >= config.longTaskThreshold;
      const slice: ScheduledSlice = {
        taskId: chosen.spec.id,
        frame: f,
        startMs: start,
        endMs: end,
        duration: chosen.spec.duration,
        longTask: isLong,
      };
      slices.push(slice);
      record.slices.push(slice);
      record.longTask = record.longTask || isLong;
      if (isLong) {
        events.push({ frame: f, atMs: start, kind: 'longtask', taskId: chosen.spec.id, message: `长任务：「${chosen.spec.label}」连续执行 ${chosen.spec.duration}ms（阈值 ${config.longTaskThreshold}ms）` });
      }
      const oc = outcomes[chosen.spec.id];
      oc.startedFrame = f;
      oc.startMs = start;
      oc.completedFrame = Math.ceil(end / budget) - 1;
      oc.endMs = end;
      runUntil = end;
      runningTaskId = chosen.spec.id;
      // 注意：此刻状态仍为 incomplete —— 任务可能要跨越多帧才结束。
      // 帧末确认线程已空闲时才转为 completed，这样跨帧执行期间的取消能被正确识别为 ignored-running。
      events.push({ frame: f, atMs: start, kind: 'start', taskId: chosen.spec.id, message: `「${chosen.spec.label}」开始执行` });
      events.push({ frame: oc.completedFrame, atMs: end, kind: 'finish', taskId: chosen.spec.id, message: `「${chosen.spec.label}」执行完成，共 ${chosen.spec.duration}ms` });
    }
    // 本帧启动的最后一个任务若在 deadline 前（含恰好打满）结束，立即确认完成，
    // 否则它保持 incomplete 直到下一帧帧首 —— 终帧/无后续帧场景必须在帧末落账。
    if (runningTaskId !== null && runUntil <= frameEnd) {
      outcomes[runningTaskId].status = 'completed';
      runningTaskId = null;
    }

    // 5) 帧末核算：deadline 时刻线程仍被占用（严格超出）即掉帧；
    //    恰好打满预算（runUntil === frameEnd）算按时提交但 idleMs=0，属于零余量风险帧。
    if (runUntil > frameEnd && (record.slices.length > 0 || blockedAtStart)) {
      record.dropped = true;
      record.overrunMs = runUntil - frameEnd;
      events.push({
        frame: f,
        atMs: frameEnd,
        kind: 'drop',
        message: blockedAtStart
          ? `帧 ${f} 掉帧：vsync deadline 时主线程仍被长任务「${byId.get(runningTaskId ?? '')?.label ?? ''}」占用`
          : `帧 ${f} 掉帧：任务超出帧预算 ${record.overrunMs}ms，本帧无渲染时间`,
      });
    }
    if (runUntil > frameStart) {
      record.usedMs = Math.min(budget, runUntil - frameStart);
    }
    record.idleMs = Math.max(0, budget - record.usedMs);

    // 6) 推迟记账：队列中每个仍在等待的任务多等了一帧
    for (const p of queue.values()) {
      outcomes[p.spec.id].deferredFrames++;
      events.push({
        frame: f,
        atMs: frameEnd,
        kind: 'defer',
        taskId: p.spec.id,
        message: `「${p.spec.label}」被推迟到下一帧（${blockedAtStart ? '线程被长任务占用' : '本帧预算已被更高优先级任务占用'}）`,
      });
    }

    record.pendingIds = [...queue.keys()].sort((a, b) => arrivalSeq.get(a)! - arrivalSeq.get(b)!);
    frames.push(record);

    // 终止条件：所有任务已到达且队列清空、线程空闲
    const allArrived = taskCursor >= tasks.length;
    const allCancelsApplied = cancelCursor >= cancels.length;
    if (allArrived && allCancelsApplied && queue.size === 0 && runUntil <= frameEnd) {
      finishedNaturally = true;
      break;
    }
  }

  hitSafetyCap = !finishedNaturally;

  // 事件在推进过程中可能提前入列（如长任务的 finish），按 (帧, 时间, 帧内语义次序) 稳定排序，
  // 保证事件日志与重放逐帧推进的次序完全确定。
  const eventRank: Record<SimEvent['kind'], number> = {
    arrival: 0,
    cancel: 1,
    'cancel-ignored': 1,
    start: 2,
    longtask: 3,
    finish: 4,
    drop: 5,
    defer: 6,
  };
  events.sort((a, b) =>
    a.frame !== b.frame
      ? a.frame - b.frame
      : a.atMs !== b.atMs
        ? a.atMs - b.atMs
        : eventRank[a.kind] - eventRank[b.kind],
  );

  // 指标汇总
  const droppedFrames = frames.filter((fr) => fr.dropped).map((fr) => fr.index);
  const longTaskFrames = frames.filter((fr) => fr.longTask).map((fr) => fr.index);
  const completed = Object.values(outcomes).filter((o) => o.status === 'completed');
  const cancelledCount = Object.values(outcomes).filter((o) => o.status === 'cancelled').length;
  const completionTimeMs = completed.reduce((m, o) => Math.max(m, o.endMs ?? 0), 0);
  const completionFrame = completed.reduce((m, o) => Math.max(m, o.completedFrame ?? 0), 0);
  const busyMs = frames.reduce((sum, fr) => sum + fr.usedMs, 0);
  const windowMs = Math.max(budget, completionTimeMs);
  const totalDeferred = Object.values(outcomes).reduce((s, o) => s + o.deferredFrames, 0);

  return {
    config,
    tasks,
    cancels,
    frames,
    slices,
    outcomes,
    events,
    metrics: {
      totalFrames: frames.length,
      droppedFrames,
      longTaskFrames,
      completionTimeMs,
      completionFrame,
      completedCount: completed.length,
      cancelledCount,
      totalDeferred,
      busyRatio: Math.min(1, busyMs / windowMs),
      hitSafetyCap,
    },
  };
}
