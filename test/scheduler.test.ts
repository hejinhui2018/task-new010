import { describe, expect, it } from 'vitest';
import { runSimulation, validateTasks } from '../src/engine/scheduler';
import { DEFAULT_CONFIG, type TaskSpec } from '../src/engine/types';

const t = (partial: Partial<TaskSpec> & Pick<TaskSpec, 'id' | 'duration'>): TaskSpec => ({
  label: partial.id,
  category: 'custom',
  priority: 2,
  arrivalFrame: 0,
  cancelable: true,
  ...partial,
});

describe('帧预算（16ms budget）', () => {
  it('恰好打满预算：按时提交、零空闲但不掉帧', () => {
    const r = runSimulation([t({ id: 'a', duration: 16 })]);
    expect(r.frames[0].dropped).toBe(false);
    expect(r.frames[0].usedMs).toBe(16);
    expect(r.frames[0].idleMs).toBe(0);
    expect(r.metrics.droppedFrames).toEqual([]);
  });

  it('超出 1ms：起始帧掉帧，下一帧只被占用 1ms 且不再掉帧', () => {
    const r = runSimulation([t({ id: 'a', duration: 17 })]);
    expect(r.frames[0].dropped).toBe(true);
    expect(r.frames[0].overrunMs).toBe(1);
    expect(r.frames[1].dropped).toBe(false);
    expect(r.frames[1].usedMs).toBe(1);
    expect(r.frames[1].idleMs).toBe(15);
    expect(r.frames[1].blockedByTaskId).toBe('a');
  });

  it('两个任务之和恰好等于预算：同帧完成，不掉帧', () => {
    const r = runSimulation([
      t({ id: 'a', duration: 8 }),
      t({ id: 'b', duration: 8 }),
    ]);
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['a', 'b']);
    expect(r.metrics.droppedFrames).toEqual([]);
  });

  it('两个任务之和超出预算：第二个在帧内余量中启动并跨过 deadline，仅起始帧掉帧', () => {
    const r = runSimulation([
      t({ id: 'a', duration: 9 }),
      t({ id: 'b', duration: 9 }),
    ]);
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['a', 'b']);
    expect(r.frames[0].dropped).toBe(true);
    expect(r.frames[0].overrunMs).toBe(2);
    expect(r.frames[1].slices).toEqual([]);
    expect(r.frames[1].blockedByTaskId).toBe('b');
    expect(r.frames[1].usedMs).toBe(2);
    expect(r.frames[1].dropped).toBe(false);
    expect(r.metrics.droppedFrames).toEqual([0]);
  });

  it('帧内有余量时连续调度多个任务，忙碌/空闲时间精确记账', () => {
    const r = runSimulation([
      t({ id: 'a', duration: 5 }),
      t({ id: 'b', duration: 4 }),
    ]);
    expect(r.frames[0].usedMs).toBe(9);
    expect(r.frames[0].idleMs).toBe(7);
  });

  it('支持自定义帧预算（如 8ms / 120fps）', () => {
    const r = runSimulation([t({ id: 'a', duration: 9 })], [], { frameBudget: 8 });
    expect(r.frames[0].dropped).toBe(true);
    expect(r.frames[0].overrunMs).toBe(1);
    expect(r.frames[1].usedMs).toBe(1);
  });

  it('validateTasks 拒绝非正耗时、非法帧号与非法优先级', () => {
    const errors = validateTasks(
      [
        t({ id: 'a', duration: 0 }),
        t({ id: 'b', duration: 4, arrivalFrame: -1 }),
        t({ id: 'c', duration: 4, priority: 9 as TaskSpec['priority'] }),
      ],
      DEFAULT_CONFIG,
    );
    expect(errors.length).toBe(3);
    expect(validateTasks([t({ id: 'a', duration: 4 })], DEFAULT_CONFIG)).toEqual([]);
  });
});

describe('优先级调度', () => {
  it('同帧到达时严格按优先级取任务，与数组书写顺序无关', () => {
    const r = runSimulation([
      t({ id: 'low', duration: 4, priority: 3 }),
      t({ id: 'high', duration: 4, priority: 0 }),
      t({ id: 'mid', duration: 4, priority: 1 }),
    ]);
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['high', 'mid', 'low']);
  });

  it('同优先级按到达顺序（FIFO）执行', () => {
    const r = runSimulation([
      t({ id: 'x', duration: 4, priority: 1 }),
      t({ id: 'y', duration: 4, priority: 1 }),
    ]);
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['x', 'y']);
  });

  it('低优先级任务被推迟：deferredFrames 按等待帧周期计数', () => {
    const r = runSimulation([
      t({ id: 'hi', duration: 10, priority: 0 }),
      t({ id: 'mid', duration: 10, priority: 1 }),
      t({ id: 'lo', duration: 10, priority: 3 }),
    ]);
    // 帧0：hi 0–10、mid 10–20（掉帧）；帧1：lo 20–30
    expect(r.frames[0].dropped).toBe(true);
    expect(r.outcomes.lo.startedFrame).toBe(1);
    expect(r.outcomes.lo.deferredFrames).toBe(1);
    expect(r.frames[0].pendingIds).toContain('lo');
  });

  it('后到达的高优先级任务不能中断正在运行的低优先级任务（运行到完成）', () => {
    const r = runSimulation([
      t({ id: 'work', duration: 14, priority: 3, arrivalFrame: 0 }),
      t({ id: 'urgent', duration: 20, priority: 0, arrivalFrame: 1 }),
    ]);
    // 帧0 只有 work，0–14 在预算内完成
    expect(r.outcomes.work.startMs).toBe(0);
    expect(r.outcomes.work.endMs).toBe(14);
    expect(r.outcomes.work.completedFrame).toBe(0);
    // urgent 在帧1 开始（16ms 处），并未在帧0 抢占 work
    expect(r.outcomes.urgent.startMs).toBe(16);
    expect(r.frames[1].dropped).toBe(true);
  });

  it('尚未开始的低优先级任务会被高优先级新任务挤到后面', () => {
    const r = runSimulation([
      t({ id: 'filler', duration: 16, priority: 1, arrivalFrame: 0 }),
      t({ id: 'bg', duration: 6, priority: 3, arrivalFrame: 0 }),
      t({ id: 'urgent', duration: 16, priority: 0, arrivalFrame: 1 }),
    ]);
    // 帧0：filler 恰好打满 0–16，bg 未获启动；帧1：urgent 16–32，bg 继续等待；帧2：bg 32–38
    expect(r.outcomes.bg.startedFrame).toBe(2);
    expect(r.outcomes.bg.deferredFrames).toBe(2);
    expect(r.outcomes.urgent.startedFrame).toBe(1);
  });
});

describe('取消 / 抢占语义', () => {
  it('可取消任务在开始前被取消：不产生 slice、状态为 cancelled', () => {
    const r = runSimulation(
      [
        t({ id: 'a', duration: 14, priority: 0 }),
        t({ id: 'victim', duration: 10, priority: 3, cancelable: true }),
      ],
      [{ taskId: 'victim', frame: 0 }],
    );
    expect(r.outcomes.victim.status).toBe('cancelled');
    expect(r.outcomes.victim.cancelledFrame).toBe(0);
    expect(r.slices.some((s) => s.taskId === 'victim')).toBe(false);
    expect(r.metrics.cancelledCount).toBe(1);
    expect(r.frames[0].cancellations[0]).toMatchObject({ taskId: 'victim', kind: 'before-start' });
  });

  it('不可取消任务收到取消命令：忽略并照常完成', () => {
    const r = runSimulation([t({ id: 'a', duration: 4, cancelable: false })], [
      { taskId: 'a', frame: 0 },
    ]);
    expect(r.outcomes.a.status).toBe('completed');
    expect(r.frames[0].cancellations[0].kind).toBe('ignored-not-cancelable');
  });

  it('正在同步执行的任务无法取消：跨帧取消被忽略（运行到完成）', () => {
    const r = runSimulation([t({ id: 'long', duration: 40, cancelable: true })], [
      { taskId: 'long', frame: 1 },
    ]);
    expect(r.outcomes.long.status).toBe('completed');
    expect(r.outcomes.long.endMs).toBe(40);
    expect(r.frames[1].cancellations[0].kind).toBe('ignored-running');
  });

  it('完成后才到达的取消命令：ignored-already-done', () => {
    const r = runSimulation([t({ id: 'a', duration: 4 })], [{ taskId: 'a', frame: 2 }]);
    expect(r.frames[2].cancellations[0].kind).toBe('ignored-already-done');
  });

  it('取消未知任务：ignored-unknown，不影响其余仿真', () => {
    const r = runSimulation([t({ id: 'a', duration: 4 })], [{ taskId: 'ghost', frame: 0 }]);
    expect(r.frames[0].cancellations[0].kind).toBe('ignored-unknown');
    expect(r.outcomes.a.status).toBe('completed');
  });

  it('取消一个会跨越多帧的排队任务后，后续帧不再被阻塞', () => {
    const r = runSimulation(
      [
        t({ id: 'hi', duration: 16, priority: 0 }),
        t({ id: 'hog', duration: 55, priority: 3, cancelable: true }),
      ],
      [{ taskId: 'hog', frame: 1 }],
    );
    // 帧0：hi 恰好打满预算，hog 整帧排队；帧1 开始前 hog 被取消，没有任何长任务发生
    expect(r.metrics.longTaskFrames).toEqual([]);
    expect(r.metrics.droppedFrames).toEqual([]);
    expect(r.outcomes.hog.status).toBe('cancelled');
  });
});

describe('长任务（longtask ≥ 50ms）', () => {
  it('恰好 50ms 标记为长任务，49ms 不标记（阈值取 >=）', () => {
    const a = runSimulation([t({ id: 'a', duration: 50 })]);
    expect(a.frames[0].longTask).toBe(true);
    expect(a.slices[0].longTask).toBe(true);
    expect(a.metrics.longTaskFrames).toEqual([0]);

    const b = runSimulation([t({ id: 'b', duration: 49 })]);
    expect(b.metrics.longTaskFrames).toEqual([]);
  });

  it('自定义阈值生效', () => {
    const r = runSimulation([t({ id: 'a', duration: 30 })], [], { longTaskThreshold: 30 });
    expect(r.metrics.longTaskFrames).toEqual([0]);
  });

  it('长任务跨过的每个 vsync 都掉帧，并记录 blockedByTaskId', () => {
    const r = runSimulation([t({ id: 'a', duration: 55 })]);
    // 55ms：帧0(0–16) 掉帧、帧1、帧2 被占满掉帧，帧3 仅占用 7ms
    expect(r.metrics.droppedFrames).toEqual([0, 1, 2]);
    expect(r.frames[1].blockedByTaskId).toBe('a');
    expect(r.frames[2].blockedByTaskId).toBe('a');
    expect(r.frames[3].blockedByTaskId).toBe('a');
    expect(r.frames[3].dropped).toBe(false);
    expect(r.events.some((e) => e.kind === 'longtask' && e.taskId === 'a')).toBe(true);
  });
});
