import { EndIcon, PauseIcon, PlayIcon, ReplayIcon, StepIcon } from './icons';

interface Props {
  playing: boolean;
  /** 已揭示帧数 0..totalFrames */
  revealed: number;
  totalFrames: number;
  speed: number;
  onPlayPause: () => void;
  onStep: () => void;
  onReplay: () => void;
  onEnd: () => void;
  onSpeed: (s: number) => void;
  onSeek: (revealed: number) => void;
}

export function Controls({
  playing,
  revealed,
  totalFrames,
  speed,
  onPlayPause,
  onStep,
  onReplay,
  onEnd,
  onSpeed,
  onSeek,
}: Props) {
  const atEnd = revealed >= totalFrames;
  return (
    <div className="controls">
      <div className="controls-buttons">
        <button
          className="btn btn-primary"
          onClick={onPlayPause}
          title={playing ? '暂停' : '播放'}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? '暂停' : atEnd ? '重播' : '播放'}</span>
        </button>
        <button className="btn" onClick={onStep} disabled={playing || atEnd} title="单步推进一帧" aria-label="单步">
          <StepIcon />
          <span>单步</span>
        </button>
        <button className="btn" onClick={onReplay} title="回到第 0 帧并暂停（确定性重放）" aria-label="重放">
          <ReplayIcon />
          <span>重放</span>
        </button>
        <button className="btn" onClick={onEnd} disabled={atEnd} title="揭示全部帧" aria-label="看结果">
          <EndIcon />
          <span>看结果</span>
        </button>
      </div>

      <div className="seek-wrap">
        <span className="seek-label">
          已揭示 <strong>{revealed}</strong> / {totalFrames} 帧
        </span>
        <input
          className="seek"
          type="range"
          min={0}
          max={totalFrames}
          value={revealed}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="播放位置"
        />
      </div>

      <div className="speed-group" role="group" aria-label="播放速度">
        {[0.5, 1, 2, 4].map((s) => (
          <button
            key={s}
            className={`btn btn-chip ${speed === s ? 'btn-chip-active' : ''}`}
            onClick={() => onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
