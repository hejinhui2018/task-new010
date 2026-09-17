import type { SimulationResult } from '../engine/types';
import { CATEGORY_META } from '../engine/scenario';

interface Props {
  result: SimulationResult;
  /** 已揭示帧数，只展示前 revealed 帧 */
  revealed: number;
}

/** 帧数据表：颜色之外的兜底信息通道（可访问性要求的 table view） */
export function FrameTable({ result, revealed }: Props) {
  const visible = result.frames.slice(0, revealed);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>帧数据表</h2>
        <p className="panel-sub">截至当前播放头；忙/闲以 ms 计，跨帧占用会注明来源任务</p>
      </header>
      <div className="table-wrap">
        <table className="frame-table">
          <thead>
            <tr>
              <th>帧</th>
              <th>窗口 (ms)</th>
              <th>忙碌</th>
              <th>空闲</th>
              <th>状态</th>
              <th>本帧任务</th>
              <th>帧末排队 / 取消</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((fr) => (
              <tr key={fr.index} className={fr.dropped ? 'row-drop' : ''}>
                <td className="num">#{fr.index}</td>
                <td className="num">{fr.startMs}–{fr.endMs}</td>
                <td className="num">{fr.usedMs}</td>
                <td className="num">{fr.idleMs}</td>
                <td>
                  {fr.dropped ? (
                    <span className="tag tag-critical">掉帧 +{fr.overrunMs}ms</span>
                  ) : fr.longTask ? (
                    <span className="tag tag-warning">长任务发起</span>
                  ) : fr.idleMs < result.config.frameBudget * 0.15 ? (
                    <span className="tag tag-tight">零余量</span>
                  ) : (
                    <span className="tag tag-ok">按时</span>
                  )}
                </td>
                <td>
                  {fr.slices.map((s) => {
                    const task = result.tasks.find((t) => t.id === s.taskId)!;
                    return (
                      <span key={s.taskId} className="task-chip">
                        <i className="swatch" style={{ background: CATEGORY_META[task.category].color }} />
                        {task.label}
                        {s.longTask && <em className="long-flag">⚠{s.duration}ms</em>}
                      </span>
                    );
                  })}
                </td>
                <td>
                  {fr.pendingIds.length > 0 && (
                    <span className="muted">排队 {fr.pendingIds.length}：{fr.pendingIds.map((id) => result.tasks.find((t) => t.id === id)?.label).join('、')}</span>
                  )}
                  {fr.cancellations.map((c, i) => (
                    <span key={i} className={c.kind === 'before-start' ? 'cancel-ok-text' : 'cancel-ignore-text'}>
                      {c.kind === 'before-start' ? '⊘ 已取消 ' : '⊘ 取消被忽略 '}
                      {result.tasks.find((t) => t.id === c.taskId)?.label ?? c.taskId}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
