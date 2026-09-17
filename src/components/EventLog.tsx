import type { SimEvent } from '../engine/types';

const KIND_LABEL: Record<SimEvent['kind'], string> = {
  arrival: '入队',
  start: '开始',
  finish: '完成',
  defer: '推迟',
  cancel: '取消',
  'cancel-ignored': '取消被忽略',
  longtask: '长任务',
  drop: '掉帧',
};

export function EventLog({ events, revealed }: { events: SimEvent[]; revealed: number }) {
  const visible = events.filter((e) => e.frame < revealed).slice(-40);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>事件日志</h2>
        <p className="panel-sub">截至播放头最近的调度事件（按时间确定性排序）</p>
      </header>
      <ol className="event-log">
        {visible.map((e, i) => (
          <li key={i} className={`event event-${e.kind}`}>
            <span className="event-frame">#{e.frame}</span>
            <span className={`event-kind event-kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
            <span className="event-msg">{e.message}</span>
          </li>
        ))}
        {visible.length === 0 && <li className="event-empty">播放后这里出现逐帧调度事件…</li>}
      </ol>
    </section>
  );
}
