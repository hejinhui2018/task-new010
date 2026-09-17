import { useEffect, useMemo, useState } from 'react';
import { runSimulation, validateTasks } from './engine/scheduler';
import { createSceneSwitchPreset, CATEGORY_META } from './engine/scenario';
import { buildInsights } from './engine/insights';
import type { CancelCommand, SimConfig, TaskCategory, TaskSpec } from './engine/types';
import { Timeline } from './components/Timeline';
import { Controls } from './components/Controls';
import { StatsBar } from './components/StatsBar';
import { InsightsPanel } from './components/InsightsPanel';
import { TaskEditor } from './components/TaskEditor';
import { FrameTable } from './components/FrameTable';
import { EventLog } from './components/EventLog';
import { MoonIcon, SunIcon, TextureIcon, ReplayIcon, BanIcon, ListIcon } from './components/icons';

type Theme = 'dark' | 'light';

let customTaskSeq = 0;

function makeTask(partial: Partial<TaskSpec>): TaskSpec {
  customTaskSeq += 1;
  return {
    id: `custom-${Date.now().toString(36)}-${customTaskSeq}`,
    label: `自定义任务 ${customTaskSeq}`,
    category: 'custom',
    priority: 2,
    duration: 8,
    arrivalFrame: 0,
    cancelable: true,
    ...partial,
  };
}

export default function App() {
  const preset = useMemo(() => createSceneSwitchPreset(), []);
  const [tasks, setTasks] = useState<TaskSpec[]>(() => preset.tasks.map((t) => ({ ...t })));
  const [cancelAt, setCancelAt] = useState<Record<string, number | null>>({});
  const [config, setConfig] = useState<SimConfig>({ frameBudget: 16, longTaskThreshold: 50, maxFrames: 240 });
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [theme, setTheme] = useState<Theme>('dark');
  const [texture, setTexture] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const cancels: CancelCommand[] = useMemo(
    () =>
      Object.entries(cancelAt)
        .filter(([, frame]) => frame !== null)
        .map(([taskId, frame]) => ({ taskId, frame: frame as number })),
    [cancelAt],
  );

  const errors = useMemo(() => validateTasks(tasks, config), [tasks, config]);
  const result = useMemo(
    () => runSimulation(tasks, cancels, config),
    // 输入非法时仍以引擎自身的兜底校验运行；validateTasks 已在 UI 报错
    [tasks, cancels, config],
  );
  const insights = useMemo(() => buildInsights(result), [result]);

  const totalFrames = result.frames.length;
  const clampedRevealed = Math.min(revealed, totalFrames);

  // 播放时钟：确定性步进，每 tick 揭示一帧
  useEffect(() => {
    if (!playing) return;
    if (clampedRevealed >= totalFrames) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRevealed((n) => Math.min(n + 1, totalFrames));
    }, 700 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, clampedRevealed, totalFrames, speed]);

  // 数据变化后把播放头夹在合法范围
  useEffect(() => {
    if (revealed > totalFrames) setRevealed(totalFrames);
  }, [revealed, totalFrames]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const changeTask = (id: string, patch: Partial<TaskSpec>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addTask = () => {
    const nt = makeTask({ arrivalFrame: Math.max(0, clampedRevealed) });
    setTasks((prev) => [...prev, nt]);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setCancelAt((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const resetScenario = () => {
    setTasks(preset.tasks.map((t) => ({ ...t })));
    setCancelAt({});
    setConfig({ frameBudget: 16, longTaskThreshold: 50, maxFrames: 240 });
    setRevealed(0);
    setPlaying(false);
  };

  const preloadCancelled = cancelAt[preset.keyTasks.preloadId] !== undefined && cancelAt[preset.keyTasks.preloadId] !== null;
  const togglePreloadCancel = () => {
    const id = preset.keyTasks.preloadId;
    setCancelAt((prev) => ({ ...prev, [id]: prev[id] === null || prev[id] === undefined ? 0 : null }));
  };

  return (
    <div className={`app ${texture ? 'texture-on' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">帧</div>
          <div>
            <h1>直播控制室 · 帧性能巡检台</h1>
            <p className="brand-sub">
              场景「{preset.name}」· 本地确定性仿真（每帧 {config.frameBudget}ms 预算，长任务阈值 {config.longTaskThreshold}ms）· 无真实设备 / 无外部服务
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="config-field">
            帧率预算
            <select value={config.frameBudget} onChange={(e) => setConfig((c) => ({ ...c, frameBudget: Number(e.target.value) }))}>
              <option value={8}>8ms · 120fps</option>
              <option value={16}>16ms · 60fps</option>
              <option value={33}>33ms · 30fps</option>
            </select>
          </label>
          <label className="config-field">
            长任务阈值
            <select value={config.longTaskThreshold} onChange={(e) => setConfig((c) => ({ ...c, longTaskThreshold: Number(e.target.value) }))}>
              <option value={25}>25ms</option>
              <option value={50}>50ms</option>
              <option value={100}>100ms</option>
            </select>
          </label>
          <button className="btn btn-icon" title={texture ? '关闭纹理增强' : '开启纹理增强（色觉/打印兜底）'} onClick={() => setTexture((v) => !v)} aria-pressed={texture}>
            <TextureIcon />
          </button>
          <button className="btn btn-icon" title="切换浅色/深色" onClick={() => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="btn" onClick={resetScenario} title="恢复内置场景初始参数">
            <ReplayIcon />
            <span>重置场景</span>
          </button>
        </div>
      </header>

      <StatsBar result={result} revealed={clampedRevealed} />

      <section className="panel scenario-banner">
        <div>
          <h2>内置场景：{preset.name}</h2>
          <p>{preset.summary}</p>
          <p className="scenario-hint">
            导播切台后，解码与布局必须尽快上屏，日志可以稍后，而预加载是空闲时的投机工作。
            JS 任务整块执行、不可中断 —— 高优先级只能<strong>推迟</strong>排队中的低优先级任务，无法抢占已经运行的任务。
          </p>
        </div>
        <button
          className={`btn ${preloadCancelled ? 'btn-danger-active' : 'btn-danger'}`}
          onClick={togglePreloadCancel}
          aria-pressed={preloadCancelled}
        >
          <BanIcon />
          <span>{preloadCancelled ? '恢复预加载任务' : '取消预加载（第 0 帧）'}</span>
        </button>
      </section>

      <section className="panel">
        <header className="panel-head panel-head-row">
          <div>
            <h2>按帧时间线</h2>
            <p className="panel-sub">
              每个任务条从其实际开始时刻按耗时等宽绘制；红色帧列为掉帧，▼ 标注掉帧帧号，⚠ 标注长任务，✕ 为取消生效、! 为取消被忽略，下方圆点是帧末仍在排队（被推迟）的任务。
            </p>
          </div>
          <Legend />
        </header>
        <Timeline
          result={result}
          revealed={clampedRevealed}
          texture={texture}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
        <Controls
          playing={playing}
          revealed={clampedRevealed}
          totalFrames={totalFrames}
          speed={speed}
          onPlayPause={() => {
            if (clampedRevealed >= totalFrames) setRevealed(0);
            setPlaying((v) => !v);
          }}
          onStep={() => { setPlaying(false); setRevealed((n) => Math.min(n + 1, totalFrames)); }}
          onReplay={() => { setPlaying(false); setRevealed(0); }}
          onEnd={() => { setPlaying(false); setRevealed(totalFrames); }}
          onSpeed={setSpeed}
          onSeek={(n) => { setPlaying(false); setRevealed(n); }}
        />
      </section>

      <div className="grid-2">
        <TaskEditor
          tasks={tasks}
          result={result}
          cancelAt={cancelAt}
          selectedTaskId={selectedTaskId}
          errors={errors}
          onChangeTask={changeTask}
          onAddTask={addTask}
          onRemoveTask={removeTask}
          onCancelAt={(id, frame) => setCancelAt((prev) => ({ ...prev, [id]: frame }))}
          onSelectTask={setSelectedTaskId}
        />
        <div className="grid-stack">
          <InsightsPanel insights={insights} />
          <EventLog events={result.events} revealed={clampedRevealed} />
        </div>
      </div>

      <FrameTable result={result} revealed={clampedRevealed} />

      <footer className="footer">
        <ListIcon width={14} height={14} />
        <span>
          仿真语义：任务整块执行（运行到完成）· 取消仅在任务开始前生效，运行中取消会被忽略 ·
          相同输入永远产生相同结果（确定性重放）· 所有数值在浏览器本地计算
        </span>
      </footer>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      {(Object.keys(CATEGORY_META) as TaskCategory[]).filter((c) => c !== 'custom').map((c) => (
        <span key={c} className="legend-item">
          <i className="swatch" style={{ background: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].label}
        </span>
      ))}
      <span className="legend-item"><i className="swatch" style={{ background: CATEGORY_META.custom.color }} />自定义</span>
      <span className="legend-sep" />
      <span className="legend-item"><i className="swatch swatch-drop" />掉帧</span>
      <span className="legend-item"><i className="swatch swatch-long" />长任务</span>
    </div>
  );
}
