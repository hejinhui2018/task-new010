import type { ReactNode } from 'react';
import type { SimulationResult } from '../engine/types';
import { ClockIcon, DropIcon, GaugeIcon, WaitIcon, WarnIcon, CheckIcon, BanIcon } from './icons';

interface Props {
  result: SimulationResult;
  revealed: number;
}

function Tile({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  tone: 'good' | 'warn' | 'critical' | 'neutral';
  icon: ReactNode;
}) {
  return (
    <div className={`tile tile-${tone}`}>
      <div className="tile-top">
        <span className="tile-label">{label}</span>
        <span className="tile-icon">{icon}</span>
      </div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

export function StatsBar({ result, revealed }: Props) {
  const m = result.metrics;
  const budget = result.config.frameBudget;
  const atMs = revealed * budget;

  // 截至播放头的前缀指标：让单步/播放能看到掉帧逐帧发生
  const dropped = m.droppedFrames.filter((f) => f < revealed);
  const longTasks = m.longTaskFrames.filter((f) => f < revealed);
  const completedSlices = result.slices.filter((s) => s.endMs <= atMs);
  const cancelled = Object.values(result.outcomes).filter(
    (o) => o.cancelledFrame !== null && o.cancelledFrame < revealed,
  );
  const deferredEvents = result.events.filter((e) => e.kind === 'defer' && e.frame < revealed).length;
  const completionMs = completedSlices.reduce((mx, s) => Math.max(mx, s.endMs), 0);

  const nominalFps = 1000 / budget;
  // 标称档位文案与顶栏帧率选项保持一致（16ms≈60fps，而非 62.5 的四舍五入）
  const nominalLabel = budget <= 8 ? 120 : budget <= 16 ? 60 : 30;
  const effectiveFps = revealed
    ? (nominalFps * (revealed - dropped.length)) / revealed
    : nominalFps;
  const tone = revealed === 0 ? 'neutral' : dropped.length === 0 ? 'good' : dropped.length >= 3 ? 'critical' : 'warn';
  const scopeSub = revealed === 0
    ? '尚未播放（单步或播放后逐帧统计）'
    : revealed < m.totalFrames
      ? `截至帧 #${revealed - 1}（播放头前缀）`
      : `全部 ${m.totalFrames} 帧（最终结果）`;

  return (
    <div className="tiles">
      <Tile
        label="掉帧"
        value={`${dropped.length} 帧`}
        sub={`${scopeSub} · 帧号 ${dropped.slice(0, 5).join('、') || '—'}${dropped.length > 5 ? '…' : ''}`}
        tone={tone}
        icon={<DropIcon />}
      />
      <Tile
        label="完成时间"
        value={completedSlices.length ? `${completionMs}ms` : '—'}
        sub={completedSlices.length ? `最近完成于 ${completionMs}ms 处` : '尚无任务完成'}
        tone={completionMs > budget * 3 ? 'warn' : completedSlices.length ? 'good' : 'neutral'}
        icon={<ClockIcon />}
      />
      <Tile
        label="长任务"
        value={`${longTasks.length} 个`}
        sub={longTasks.length ? `起始帧 ${longTasks.join('、')}（≥${result.config.longTaskThreshold}ms）` : `无 ≥${result.config.longTaskThreshold}ms 连续执行`}
        tone={longTasks.length ? 'critical' : 'good'}
        icon={<WarnIcon />}
      />
      <Tile
        label="有效帧率"
        value={revealed === 0 ? '—' : `${Math.round(effectiveFps)} fps`}
        sub={`目标 ${nominalLabel}fps（${budget}ms/帧）`}
        tone={revealed === 0 ? 'neutral' : effectiveFps >= nominalFps - 1 ? 'good' : effectiveFps >= nominalFps * 0.7 ? 'warn' : 'critical'}
        icon={<GaugeIcon />}
      />
      <Tile
        label="任务结局"
        value={
          <span className="tile-outcomes">
            <span className="outcome-chip outcome-ok"><CheckIcon width={13} height={13} />{completedSlices.length}</span>
            <span className="outcome-chip outcome-cx"><BanIcon width={13} height={13} />{cancelled.length}</span>
          </span>
        }
        sub={`完成 / 取消 · 已推迟 ${deferredEvents} 帧次`}
        tone="neutral"
        icon={<WaitIcon />}
      />
    </div>
  );
}
