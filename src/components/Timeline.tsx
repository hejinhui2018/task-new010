import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationResult } from '../engine/types';
import { CATEGORY_META } from '../engine/scenario';

const MIN_COL_W = 44;
const MAX_COL_W = 120;
const RULER_H = 26;
const LANE_Y = 42;
const LANE_H = 24;
const AXIS_Y = 80;
const PEND_Y = 94;
const H = 120;

interface HoverState {
  clientX: number;
  clientY: number;
  title: string;
  lines: string[];
  tone?: 'danger' | 'warn' | 'normal';
}

interface Props {
  result: SimulationResult;
  /** 已揭示（播放过）的帧数，范围 0..frames.length；帧 f 在 f < revealed 时可见 */
  revealed: number;
  texture: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}

/** 粗略估算 CJK 混排文本宽度：全角字 ≈ fontSize，半角 ≈ 0.56 */
function textWidth(text: string, fontSize: number) {
  let w = 0;
  for (const ch of text) {
    w += /[ -~]/.test(ch) ? fontSize * 0.56 : fontSize;
  }
  return w;
}

export function Timeline({ result, revealed, texture, selectedTaskId, onSelectTask }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(900);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setViewportW(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const budget = result.config.frameBudget;
  const frameCount = Math.max(result.frames.length, 1);
  // 列宽铺满可用宽度；帧很多时收窄到最小值并横向滚动
  const colW = Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.floor(viewportW / frameCount)));
  const pxPerMs = colW / budget;
  const width = frameCount * colW + 2;
  const x = (ms: number) => ms * pxPerMs;

  const taskById = useMemo(() => new Map(result.tasks.map((t) => [t.id, t])), [result.tasks]);
  const catColor = (taskId: string) => CATEGORY_META[taskById.get(taskId)?.category ?? 'custom'];
  const labelEvery = colW < 56 ? 2 : 1;

  return (
    <div className="timeline-scroll" ref={scrollRef}>
      <svg
        className="timeline-svg"
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`帧时间线，共 ${result.frames.length} 帧，掉帧 ${result.metrics.droppedFrames.length} 次`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="slice-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" />
          </pattern>
        </defs>

        {/* 帧列 */}
        {result.frames.map((fr) => {
          const isCurrent = fr.index === revealed - 1;
          const isRevealed = fr.index < revealed;
          return (
            <g key={`col-${fr.index}`}>
              <rect
                x={x(fr.startMs) + 1}
                y={RULER_H}
                width={colW - 2}
                height={PEND_Y - RULER_H + 10}
                rx={6}
                className={[
                  'frame-col',
                  fr.dropped && isRevealed ? 'frame-col-dropped' : '',
                  isCurrent ? 'frame-col-current' : '',
                  isRevealed ? '' : 'frame-col-future',
                ].join(' ')}
              />
              <line x1={x(fr.startMs)} y1={RULER_H} x2={x(fr.startMs)} y2={PEND_Y + 8} className="gridline" />
              {fr.index % labelEvery === 0 && (
                <text x={x(fr.startMs) + 4} y={16} className="ruler-text">{fr.startMs}</text>
              )}
              <text
                x={x(fr.startMs) + colW / 2}
                y={AXIS_Y}
                textAnchor="middle"
                className={fr.dropped ? 'axis-text-danger' : 'axis-text'}
              >
                #{fr.index}
              </text>
              {fr.dropped && (
                <text x={x(fr.startMs) + colW / 2} y={AXIS_Y + 14} textAnchor="middle" className="drop-mark">
                  ▼掉帧
                </text>
              )}
              {/* 帧命中区 */}
              <rect
                x={x(fr.startMs)}
                y={RULER_H}
                width={colW}
                height={H - RULER_H}
                fill="transparent"
                onMouseMove={(e) =>
                  setHover({
                    clientX: e.clientX,
                    clientY: e.clientY,
                    title: `帧 #${fr.index}（${fr.startMs}–${fr.endMs}ms）`,
                    tone: fr.dropped ? 'danger' : fr.idleMs < budget * 0.15 ? 'warn' : 'normal',
                    lines: [
                      fr.dropped
                        ? `× 掉帧：超出 deadline ${fr.overrunMs}ms${fr.blockedByTaskId ? `，被「${taskById.get(fr.blockedByTaskId)?.label}」占用` : ''}`
                        : '✓ 按时提交',
                      `忙碌 ${fr.usedMs}ms / 空闲 ${fr.idleMs}ms`,
                      fr.longTask ? `⚠ 本帧发起长任务（≥${result.config.longTaskThreshold}ms）` : '',
                      fr.pendingIds.length
                        ? `帧末排队：${fr.pendingIds.map((id) => taskById.get(id)?.label).join('、')}`
                        : '帧末无排队任务',
                      ...fr.cancellations.map((c) =>
                        c.kind === 'before-start'
                          ? `⊘ 取消生效：${taskById.get(c.taskId)?.label}`
                          : `⊘ 取消被忽略：${taskById.get(c.taskId)?.label}`,
                      ),
                    ].filter(Boolean),
                  })
                }
              />
            </g>
          );
        })}

        {/* 任务切片 */}
        {result.slices.map((sl, i) => {
          const meta = catColor(sl.taskId);
          const task = taskById.get(sl.taskId);
          const dim = selectedTaskId !== null && selectedTaskId !== sl.taskId;
          const sliceRevealed = sl.frame < revealed;
          const barW = Math.max(3, sl.duration * pxPerMs - 2);
          const barX = x(sl.startMs) + 1;
          const fontSize = 10.5;
          const badgeW = 24;
          const labelW = textWidth(task?.label ?? '', fontSize);
          const showBadge = sl.longTask && barW >= badgeW + 6;
          const showLabel = barW >= labelW + (showBadge ? badgeW + 8 : 12);
          return (
            <g
              key={`sl-${i}`}
              opacity={dim ? 0.28 : 1}
              className={sliceRevealed ? '' : 'slice-future'}
              onMouseMove={(e) =>
                setHover({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  tone: sl.longTask ? 'warn' : 'normal',
                  title: `${task?.label ?? sl.taskId}（${CATEGORY_META[task?.category ?? 'custom'].label}）`,
                  lines: [
                    `优先级 ${task?.priority} · ${sl.duration}ms`,
                    `${sl.startMs}–${sl.endMs}ms · 起始帧 #${sl.frame}`,
                    sl.longTask
                      ? `⚠ 长任务：连续执行 ≥${result.config.longTaskThreshold}ms，跨越多个 vsync`
                      : '在 deadline 前结束',
                  ],
                })
              }
              onClick={() => onSelectTask(selectedTaskId === sl.taskId ? null : sl.taskId)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={barX} y={LANE_Y} width={barW} height={LANE_H} rx={5} fill={meta.color} className="slice-rect" />
              {sl.longTask && texture && (
                <rect x={barX} y={LANE_Y} width={barW} height={LANE_H} rx={5} fill="url(#slice-hatch)" pointerEvents="none" />
              )}
              {showBadge && (
                <text x={barX + 5} y={LANE_Y + 16} className="slice-badge">⚠</text>
              )}
              {showLabel && (
                <text
                  x={barX + (showBadge ? badgeW : 6)}
                  y={LANE_Y + 16}
                  className="slice-label"
                  fontSize={fontSize}
                >
                  {task?.label}
                </text>
              )}
            </g>
          );
        })}

        {/* 取消标记：帧列右上角 */}
        {result.frames.flatMap((fr) =>
          fr.cancellations.map((c, i) => (
            <g key={`cx-${fr.index}-${i}`}>
              <circle
                cx={x(fr.endMs) - 8 - i * 15}
                cy={RULER_H + 11}
                r={6.5}
                className={c.kind === 'before-start' ? 'cancel-dot' : 'cancel-dot-ignored'}
              />
              <text
                x={x(fr.endMs) - 8 - i * 15}
                y={RULER_H + 15.5}
                textAnchor="middle"
                fontSize={9}
                className="cancel-x"
              >
                {c.kind === 'before-start' ? '✕' : '!'}
              </text>
            </g>
          )),
        )}

        {/* 帧末排队（被推迟）任务 */}
        {result.frames.map((fr) =>
          fr.pendingIds.length ? (
            <g key={`pend-${fr.index}`}>
              {fr.pendingIds.slice(0, 6).map((id, i) => (
                <circle
                  key={id}
                  cx={x(fr.startMs) + 8 + i * 8}
                  cy={PEND_Y + 4}
                  r={3.4}
                  fill={catColor(id).color}
                  className="pend-dot"
                />
              ))}
              {fr.pendingIds.length > 6 && (
                <text x={x(fr.startMs) + 8 + 6 * 8} y={PEND_Y + 8} className="pend-more">
                  +{fr.pendingIds.length - 6}
                </text>
              )}
            </g>
          ) : null,
        )}

        {/* 播放头 */}
        <g>
          <line
            x1={x(Math.min(revealed, frameCount) * budget)}
            y1={RULER_H - 6}
            x2={x(Math.min(revealed, frameCount) * budget)}
            y2={PEND_Y + 10}
            className="playhead"
          />
          <polygon
            points={`${x(Math.min(revealed, frameCount) * budget) - 5},${RULER_H - 6} ${x(Math.min(revealed, frameCount) * budget) + 5},${RULER_H - 6} ${x(Math.min(revealed, frameCount) * budget)},${RULER_H - 1}`}
            className="playhead-head"
          />
        </g>
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}
          data-tone={hover.tone}
        >
          <div className="tooltip-title">{hover.title}</div>
          {hover.lines.map((ln, i) => (
            <div key={i} className="tooltip-line">{ln}</div>
          ))}
        </div>
      )}
    </div>
  );
}
