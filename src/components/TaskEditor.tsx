import type { Priority, SimulationResult, TaskCategory, TaskSpec } from '../engine/types';
import { PRIORITY_META } from '../engine/types';
import { CATEGORY_META } from '../engine/scenario';
import { BanIcon, PlusIcon, TrashIcon, WaitIcon, CheckIcon } from './icons';

interface Props {
  tasks: TaskSpec[];
  result: SimulationResult;
  cancelAt: Record<string, number | null>;
  selectedTaskId: string | null;
  errors: string[];
  onChangeTask: (id: string, patch: Partial<TaskSpec>) => void;
  onAddTask: () => void;
  onRemoveTask: (id: string) => void;
  onCancelAt: (id: string, frame: number | null) => void;
  onSelectTask: (id: string | null) => void;
}

const CATEGORIES: TaskCategory[] = ['decode', 'layout', 'log', 'preload', 'custom'];

export function TaskEditor({
  tasks,
  result,
  cancelAt,
  selectedTaskId,
  errors,
  onChangeTask,
  onAddTask,
  onRemoveTask,
  onCancelAt,
  onSelectTask,
}: Props) {
  return (
    <section className="panel task-panel">
      <header className="panel-head panel-head-row">
        <div>
          <h2>主线程任务队列</h2>
          <p className="panel-sub">调整优先级 / 耗时 / 可取消性，掉帧数与完成时间即时重算</p>
        </div>
        <button className="btn btn-secondary" onClick={onAddTask}>
          <PlusIcon />
          <span>加入任务</span>
        </button>
      </header>

      {errors.length > 0 && (
        <div className="error-box" role="alert">
          {errors.map((e, i) => (
            <div key={i}>⚠ {e}</div>
          ))}
        </div>
      )}

      <ul className="task-list">
        {tasks.map((task) => {
          const meta = CATEGORY_META[task.category];
          const oc = result.outcomes[task.id];
          const cx = cancelAt[task.id] ?? null;
          const selected = selectedTaskId === task.id;
          return (
            <li
              key={task.id}
              className={`task-card ${selected ? 'task-card-selected' : ''}`}
              style={{ ['--task-color' as string]: meta.color }}
              onMouseEnter={() => onSelectTask(task.id)}
              onMouseLeave={() => onSelectTask(null)}
            >
              <div className="task-card-head">
                <span className="task-grip" aria-hidden>
                  <i className="swatch-lg" style={{ background: meta.color }} />
                </span>
                <input
                  className="task-name-input"
                  value={task.label}
                  aria-label="任务名称"
                  onChange={(e) => onChangeTask(task.id, { label: e.target.value })}
                />
                <span
                  className={`status-pill ${oc?.status === 'completed' ? 'pill-ok' : oc?.status === 'cancelled' ? 'pill-cx' : 'pill-wait'}`}
                  title={
                    oc?.status === 'completed'
                      ? `帧 #${oc.startedFrame} 开始，等待 ${oc.deferredFrames} 帧后执行`
                      : oc?.status === 'cancelled'
                        ? `帧 #${oc.cancelledFrame} 被取消`
                        : '未进入终态'
                  }
                >
                  {oc?.status === 'completed' ? <CheckIcon width={12} height={12} /> : oc?.status === 'cancelled' ? <BanIcon width={12} height={12} /> : <WaitIcon width={12} height={12} />}
                  {oc?.status === 'completed' ? `帧#${oc.startedFrame}完成` : oc?.status === 'cancelled' ? `帧#${oc.cancelledFrame}取消` : '未完成'}
                </span>
                <button
                  className="btn btn-icon"
                  onClick={() => onRemoveTask(task.id)}
                  aria-label={`删除任务 ${task.label}`}
                  title="删除任务"
                >
                  <TrashIcon />
                </button>
              </div>

              {task.description && <p className="task-desc">{task.description}</p>}

              <div className="task-grid">
                <label className="field">
                  <span>类别</span>
                  <select
                    value={task.category}
                    onChange={(e) => onChangeTask(task.id, { category: e.target.value as TaskCategory })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>优先级</span>
                  <select
                    value={task.priority}
                    className={`pri-select pri-${task.priority}`}
                    title={PRIORITY_META[task.priority].hint}
                    onChange={(e) => onChangeTask(task.id, { priority: Number(e.target.value) as Priority })}
                  >
                    {PRIORITY_META.map((p) => (
                      <option key={p.value} value={p.value}>{p.value} · {p.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>耗时 (ms)</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={task.duration}
                    onChange={(e) => onChangeTask(task.id, { duration: Math.max(1, Number(e.target.value) || 0) })}
                  />
                </label>

                <label className="field">
                  <span>入队帧</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={task.arrivalFrame}
                    onChange={(e) => onChangeTask(task.id, { arrivalFrame: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  />
                </label>
              </div>

              <div className="task-flags">
                <label className={`switch ${task.cancelable ? '' : 'switch-off'}`}>
                  <input
                    type="checkbox"
                    checked={task.cancelable}
                    onChange={(e) => {
                      onChangeTask(task.id, { cancelable: e.target.checked });
                      if (!e.target.checked) onCancelAt(task.id, null);
                    }}
                  />
                  <span>可取消</span>
                </label>

                <label className={`switch cancel-toggle ${cx !== null ? 'cancel-toggle-on' : ''} ${!task.cancelable ? 'switch-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={!task.cancelable}
                    checked={cx !== null}
                    onChange={(e) => onCancelAt(task.id, e.target.checked ? task.arrivalFrame : null)}
                  />
                  <span>
                    在第
                    <input
                      type="number"
                      min={task.arrivalFrame}
                      className="cancel-frame-input"
                      value={cx ?? task.arrivalFrame}
                      disabled={!task.cancelable || cx === null}
                      onChange={(e) => onCancelAt(task.id, Math.max(task.arrivalFrame, Math.floor(Number(e.target.value) || 0)))}
                    />
                    帧开始前取消
                  </span>
                </label>

                {oc?.status === 'completed' && oc.deferredFrames > 0 && (
                  <span className="defer-badge" title="该任务入队后等待了多少个帧周期才启动">
                    <WaitIcon width={12} height={12} /> 被推迟 {oc.deferredFrames} 帧
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
