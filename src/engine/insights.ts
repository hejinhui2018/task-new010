/**
 * 巡检结论：从仿真结果中提炼“为什么掉帧”的可读解释。纯函数，便于测试。
 */
import type { SimulationResult, TaskOutcome } from './types';

export type Severity = 'good' | 'warning' | 'critical';

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export function frameStatus(
  result: SimulationResult,
  frame: number,
): 'dropped' | 'longtask' | 'tight' | 'idle' {
  const rec = result.frames[frame];
  if (!rec) return 'idle';
  if (rec.dropped) return 'dropped';
  if (rec.longTask) return 'longtask';
  if (rec.idleMs < result.config.frameBudget * 0.15) return 'tight';
  return 'idle';
}

export function buildInsights(result: SimulationResult): Insight[] {
  const insights: Insight[] = [];
  const { metrics, config, outcomes, tasks } = result;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (metrics.droppedFrames.length === 0 && metrics.longTaskFrames.length === 0) {
    insights.push({
      id: 'clean',
      severity: 'good',
      title: '所有帧按时提交',
      detail: `全部 ${metrics.totalFrames} 帧都在 ${config.frameBudget}ms 预算内完成，未观察到长任务或掉帧。`,
    });
  }

  const longSlices = result.slices.filter((s) => s.longTask);
  for (const slice of longSlices) {
    const task = byId.get(slice.taskId);
    const span = slice.endMs - slice.startMs;
    const crossed = Math.ceil(slice.endMs / config.frameBudget) - slice.frame - 1;
    insights.push({
      id: `long-${slice.taskId}`,
      severity: 'critical',
      title: `长任务：${task?.label ?? slice.taskId}（${span}ms）`,
      detail: `该任务从帧 ${slice.frame} 起连续运行 ${span}ms，跨过约 ${crossed} 个后续 vsync，期间主线程无法响应用户输入或提交新帧。建议拆分（时间切片）或将其移出主线程（Worker）。`,
    });
  }

  const deferredWorst = [...Object.values(outcomes)]
    .filter((o) => o.status === 'completed' && o.deferredFrames > 0)
    .sort((a, b) => b.deferredFrames - a.deferredFrames)[0];
  if (deferredWorst) {
    const task = byId.get(deferredWorst.taskId)!;
    insights.push({
      id: 'defer',
      severity: metrics.droppedFrames.length > 0 ? 'warning' : 'good',
      title: `「${task.label}」被推迟 ${deferredWorst.deferredFrames} 帧`,
      detail: `优先级 ${task.priority} 的该任务在队列中等待了 ${deferredWorst.deferredFrames} 个帧周期才开始。JS 任务整块执行、不可中断，高优先级任务只能推迟它而无法抢占正在运行的任务 —— 这正是“抢占式调度”与浏览器主线程模型的关键差别。`,
    });
  }

  const cancelled = Object.values(outcomes).filter((o) => o.status === 'cancelled');
  for (const oc of cancelled) {
    const task = byId.get(oc.taskId)!;
    insights.push({
      id: `cancel-${oc.taskId}`,
      severity: 'good',
      title: `「${task.label}」已在开始前取消`,
      detail: `取消命令于帧 ${oc.cancelledFrame} 生效，任务尚未启动即从队列移除，未消耗任何主线程时间。可取消任务必须在启动前取消；一旦开始执行，取消会被忽略（运行到完成）。`,
    });
  }

  const ignoredCancels = result.frames.flatMap((fr) =>
    fr.cancellations
      .filter((c) => c.kind !== 'before-start')
      .map((c) => ({ frame: fr.index, ...c })),
  );
  for (const ig of ignoredCancels) {
    const task = byId.get(ig.taskId);
    const reason =
      ig.kind === 'ignored-not-cancelable'
        ? '任务不可取消或已经在同步执行中'
        : ig.kind === 'ignored-already-done'
          ? '任务已经执行完成'
          : '找不到对应任务';
    insights.push({
      id: `ignored-${ig.taskId}-${ig.frame}`,
      severity: 'warning',
      title: `取消「${task?.label ?? ig.taskId}」被忽略（帧 ${ig.frame}）`,
      detail: `${reason}，取消命令没有产生任何效果。`,
    });
  }

  const incomplete = Object.values(outcomes).filter((o) => o.status === 'incomplete');
  for (const oc of incomplete) {
    const task = byId.get(oc.taskId)!;
    insights.push(
      oc.startedFrame === null
        ? {
            id: `incomplete-${oc.taskId}`,
            severity: 'critical',
            title: `「${task.label}」在 ${config.maxFrames} 帧内未能开始执行`,
            detail: `任务一直在队列中等待（已推迟 ${oc.deferredFrames} 帧），仿真到达安全帧数上限。请减少工作量或提高其优先级后重试。`,
          }
        : {
            id: `incomplete-${oc.taskId}`,
            severity: 'critical',
            title: `「${task.label}」跨越仿真上限仍未结束`,
            detail: `任务从帧 ${oc.startedFrame} 开始连续执行，预计耗时 ${task.duration}ms，超出 ${config.maxFrames} 帧安全窗口。这本身就是一个需要拆分的超长任务。`,
          },
    );
  }
  if (metrics.hitSafetyCap) {
    insights.push({
      id: 'safety-cap',
      severity: 'warning',
      title: `仿真在 ${config.maxFrames} 帧安全上限处停止`,
      detail: '仍有任务未进入终态，指标仅覆盖已仿真的帧范围。',
    });
  }

  if (metrics.droppedFrames.length > 0) {
    insights.push({
      id: 'drops',
      severity: metrics.droppedFrames.length >= 3 ? 'critical' : 'warning',
      title: `共 ${metrics.droppedFrames.length} 帧掉帧（帧号 ${metrics.droppedFrames.slice(0, 8).join('、')}${metrics.droppedFrames.length > 8 ? '…' : ''}）`,
      detail: `掉帧期间观众感知为卡顿。掉帧率 ${((metrics.droppedFrames.length / metrics.totalFrames) * 100).toFixed(0)}%，全部工作在 ${metrics.completionTimeMs}ms（帧 ${metrics.completionFrame}）后进入终态。`,
    });
  }

  const tight = result.frames.filter((f) => !f.dropped && f.idleMs < config.frameBudget * 0.15);
  if (tight.length > 0 && metrics.droppedFrames.length === 0) {
    insights.push({
      id: 'tight',
      severity: 'warning',
      title: `${tight.length} 个帧余量不足 15%`,
      detail: '这些帧虽未掉帧，但几乎没有空闲时间，任何额外抖动都可能演化为掉帧。',
    });
  }

  return insights;
}

/** 对比两次仿真（通常为“改动前 vs 改动后”），生成指标差异说明 */
export function diffMetrics(before: SimulationResult['metrics'], after: SimulationResult['metrics']) {
  return {
    droppedDelta: after.droppedFrames.length - before.droppedFrames.length,
    longTaskDelta: after.longTaskFrames.length - before.longTaskFrames.length,
    completionDelta: after.completionTimeMs - before.completionTimeMs,
    deferredDelta: after.totalDeferred - before.totalDeferred,
  };
}

export function outcomeOf(result: SimulationResult, taskId: string): TaskOutcome | undefined {
  return result.outcomes[taskId];
}
