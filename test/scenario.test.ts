import { describe, expect, it } from 'vitest';
import { buildInsights, diffMetrics } from '../src/engine/insights';
import { normalizeInput, runSimulation } from '../src/engine/scheduler';
import { createSceneSwitchPreset } from '../src/engine/scenario';
import type { SimConfig, TaskSpec } from '../src/engine/types';

const t = (partial: Partial<TaskSpec> & Pick<TaskSpec, 'id' | 'duration'>): TaskSpec => ({
  label: partial.id,
  category: 'custom',
  priority: 2,
  arrivalFrame: 0,
  cancelable: true,
  ...partial,
});

describe('确定性重放', () => {
  it('重复运行同一输入产生完全一致的结果', () => {
    const tasks = [
      t({ id: 'a', duration: 14, priority: 0 }),
      t({ id: 'b', duration: 22, priority: 2 }),
      t({ id: 'c', duration: 5, priority: 1, arrivalFrame: 1 }),
    ];
    const cancels = [{ taskId: 'b', frame: 2 }];
    const r1 = runSimulation(tasks, cancels);
    const r2 = runSimulation(tasks, cancels);
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
  });

  it('任务数组乱序书写不影响结果（规范化为稳定顺序）', () => {
    const tasksA = [
      t({ id: 'a', duration: 7, priority: 0 }),
      t({ id: 'b', duration: 9, priority: 1 }),
      t({ id: 'c', duration: 5, priority: 3 }),
    ];
    const tasksB = [tasksA[2], tasksA[0], tasksA[1]];
    const r1 = runSimulation(tasksA);
    const r2 = runSimulation(tasksB);
    expect(r2.slices).toEqual(r1.slices);
    expect(r2.metrics).toEqual(r1.metrics);
    expect(r2.events).toEqual(r1.events);
  });

  it('取消命令乱序书写不影响结果', () => {
    const tasks = [
      t({ id: 'a', duration: 16, priority: 0 }),
      t({ id: 'b', duration: 4, priority: 3 }),
      t({ id: 'c', duration: 4, priority: 3 }),
    ];
    const r1 = runSimulation(tasks, [
      { taskId: 'c', frame: 1 },
      { taskId: 'b', frame: 1 },
    ]);
    const r2 = runSimulation(tasks, [
      { taskId: 'b', frame: 1 },
      { taskId: 'c', frame: 1 },
    ]);
    expect(r2.metrics).toEqual(r1.metrics);
    expect(r2.outcomes.b.status).toBe('cancelled');
    expect(r2.outcomes.c.status).toBe('cancelled');
  });

  it('normalizeInput 不修改调用方的原数组（重放安全）', () => {
    const original = [t({ id: 'z', duration: 4 }), t({ id: 'a', duration: 4 })];
    const snapshot = JSON.stringify(original);
    normalizeInput(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('逐帧推进与一次性运行看到同样的帧记录（播放/单步/重放一致性）', () => {
    const tasks = [t({ id: 'a', duration: 35 }), t({ id: 'b', duration: 6, priority: 0, arrivalFrame: 2 })];
    const full = runSimulation(tasks);
    // 重放 = 以同样的输入再跑一次，逐帧截取前缀
    const replay = runSimulation(tasks);
    for (let f = 0; f < full.frames.length; f++) {
      expect(replay.frames[f]).toEqual(full.frames[f]);
    }
    expect(replay.events.filter((e) => e.frame <= 2)).toEqual(full.events.filter((e) => e.frame <= 2));
  });

  it('拒绝空 id 与重复 id', () => {
    expect(() => runSimulation([t({ id: '', duration: 4 })])).toThrow();
    expect(() =>
      runSimulation([t({ id: 'x', duration: 4 }), t({ id: 'x', duration: 4 })]),
    ).toThrow(/重复/);
  });
});

describe('安全帧数上限', () => {
  it('正常场景在所有任务终态后自然结束，不标记触顶', () => {
    const r = runSimulation([t({ id: 'a', duration: 1000 })]);
    expect(r.metrics.hitSafetyCap).toBe(false);
    expect(r.outcomes.a.status).toBe('completed');
  });

  it('超长任务跨越安全上限：标记触顶、任务未完成、给出对应巡检结论', () => {
    const cfg: Partial<SimConfig> = { maxFrames: 20 }; // 320ms 窗口
    const r = runSimulation([t({ id: 'giant', duration: 5000, label: '巨型任务' })], [], cfg);
    expect(r.metrics.hitSafetyCap).toBe(true);
    expect(r.frames.length).toBe(20);
    expect(r.outcomes.giant.status).toBe('incomplete');
    expect(r.outcomes.giant.startedFrame).toBe(0);
    const insights = buildInsights(r);
    expect(insights.some((i) => i.id === 'safety-cap')).toBe(true);
    expect(insights.some((i) => i.title.includes('跨越仿真上限'))).toBe(true);
  });

  it('一直排队无法启动的任务触顶时给出“未能开始执行”结论', () => {
    const cfg: Partial<SimConfig> = { maxFrames: 10 };
    const r = runSimulation(
      [
        // 一个持续霸占线程的超长高优任务，让低优任务永远排不上
        t({ id: 'hog', duration: 1000, priority: 0 }),
        t({ id: 'starved', duration: 4, priority: 3 }),
      ],
      [],
      cfg,
    );
    expect(r.metrics.hitSafetyCap).toBe(true);
    expect(r.outcomes.starved.status).toBe('incomplete');
    expect(r.outcomes.starved.startedFrame).toBeNull();
    const insights = buildInsights(r);
    expect(insights.some((i) => i.title.includes('未能开始执行'))).toBe(true);
  });

  it('任务恰好在上限帧的帧末结束不算触顶', () => {
    const cfg: Partial<SimConfig> = { maxFrames: 5 }; // 80ms
    const r = runSimulation([t({ id: 'a', duration: 80 })], [], cfg);
    expect(r.metrics.hitSafetyCap).toBe(false);
    expect(r.outcomes.a.status).toBe('completed');
    expect(r.outcomes.a.endMs).toBe(80);
  });
});

describe('内置场景：切换直播画面', () => {
  const preset = createSceneSwitchPreset();

  it('包含解码、布局、日志、可取消预加载四类任务', () => {
    const ids = preset.tasks.map((x) => x.id);
    expect(ids).toEqual(['decode', 'layout', 'log', 'preload']);
    expect(preset.tasks.find((x) => x.id === 'decode')!.cancelable).toBe(false);
    expect(preset.tasks.find((x) => x.id === 'preload')!.cancelable).toBe(true);
  });

  it('默认配置下出现长任务与掉帧，预加载最后执行', () => {
    const r = runSimulation(preset.tasks, preset.cancels);
    // 帧0：decode 0–14、layout 14–26（掉帧）
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['decode', 'layout']);
    expect(r.frames[0].dropped).toBe(true);
    // 帧1：log 26–32（恰好打满，不掉帧）；帧2：preload 32–87 —— 55ms 长任务，连掉帧 2/3/4
    expect(r.outcomes.log.startMs).toBe(26);
    expect(r.outcomes.preload.status).toBe('completed');
    expect(r.slices.find((s) => s.taskId === 'preload')!.longTask).toBe(true);
    expect(r.metrics.longTaskFrames).toEqual([2]);
    expect(r.metrics.droppedFrames).toEqual([0, 2, 3, 4]);
  });

  it('取消预加载后：掉帧数与完成时间重新计算并显著改善', () => {
    const before = runSimulation(preset.tasks);
    const after = runSimulation(preset.tasks, [{ taskId: 'preload', frame: 1 }]);

    expect(after.outcomes.preload.status).toBe('cancelled');
    expect(after.metrics.droppedFrames.length).toBeLessThan(before.metrics.droppedFrames.length);
    expect(after.metrics.droppedFrames).toEqual([0]);
    expect(after.metrics.longTaskFrames).toEqual([]);
    // 完成时间：取消前最后结束的是 87ms 的预加载；取消后日志在 32ms 完成
    expect(before.metrics.completionTimeMs).toBe(87);
    expect(after.metrics.completionTimeMs).toBe(32);
    const d = diffMetrics(before.metrics, after.metrics);
    expect(d.droppedDelta).toBe(-3);
    expect(d.completionDelta).toBe(-55);
  });

  it('把预加载提升到高优先级会把它提前执行，但长任务掉帧依旧（只是位置变化）', () => {
    const bumped = preset.tasks.map((x) =>
      x.id === 'preload' ? { ...x, priority: 0 as const } : x,
    );
    const r = runSimulation(bumped);
    // 优先级同为 0 时按到达顺序：decode 仍最先，preload 随后（0级 FIFO）
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['decode', 'preload']);
    expect(r.metrics.longTaskFrames).toEqual([0]);
    expect(r.metrics.droppedFrames).toContain(0);
    // 布局与日志被推迟到预加载之后
    expect(r.outcomes.layout.startedFrame).toBeGreaterThan(r.outcomes.preload.startedFrame!);
  });

  it('巡检结论涵盖长任务、推迟、掉帧与取消结果', () => {
    const r = runSimulation(preset.tasks, [{ taskId: 'preload', frame: 1 }]);
    const insights = buildInsights(r);
    const titles = insights.map((i) => i.title).join(' ');
    expect(titles).toContain('掉帧');
    expect(titles).toContain('已在开始前取消');
    expect(insights.some((i) => i.severity === 'critical')).toBe(false);

    const bad = runSimulation(preset.tasks);
    const badInsights = buildInsights(bad);
    expect(badInsights.some((i) => i.severity === 'critical' && i.title.includes('长任务'))).toBe(true);
    expect(badInsights.some((i) => i.title.includes('推迟'))).toBe(true);
  });
});
