import type { Insight } from '../engine/insights';
import { BanIcon, CheckIcon, DropIcon, WarnIcon } from './icons';

const SEV_STYLE = {
  good: { cls: 'insight-good', icon: <CheckIcon /> },
  warning: { cls: 'insight-warning', icon: <WarnIcon /> },
  critical: { cls: 'insight-critical', icon: <DropIcon /> },
} as const;

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>巡检结论</h2>
        <p className="panel-sub">引擎按确定性规则从时间线中提炼，解释每一次掉帧的成因</p>
      </header>
      <ul className="insight-list">
        {insights.map((ins) => {
          const s = SEV_STYLE[ins.severity];
          return (
            <li key={ins.id} className={`insight ${s.cls}`}>
              <span className="insight-icon">{s.icon}</span>
              <div>
                <div className="insight-title">{ins.title}</div>
                <div className="insight-detail">{ins.detail}</div>
              </div>
            </li>
          );
        })}
        {insights.length === 0 && (
          <li className="insight insight-good">
            <span className="insight-icon"><BanIcon /></span>
            <div>
              <div className="insight-title">暂无可报告项</div>
              <div className="insight-detail">添加任务后这里会给出巡检结论。</div>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}
