import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

/** 揭示全部帧（看最终指标） */
function revealAll() {
  fireEvent.click(screen.getByRole('button', { name: '看结果' }));
}

describe('巡检台 App 冒烟测试', () => {
  it('挂载内置场景并渲染场景说明与四类任务', () => {
    render(<App />);
    expect(screen.getByText('直播控制室 · 帧性能巡检台')).toBeInTheDocument();
    expect(screen.getByText(/内置场景：切换直播画面/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('解码新机位关键帧')).toBeInTheDocument();
    expect(screen.getByDisplayValue('重算画中画布局')).toBeInTheDocument();
    expect(screen.getByDisplayValue('上报切台操作日志')).toBeInTheDocument();
    expect(screen.getByDisplayValue('预加载下一路信号')).toBeInTheDocument();
  });

  it('揭示全部帧后：默认场景掉帧 4 次、完成时间 87ms', () => {
    render(<App />);
    revealAll();
    expect(screen.getByText('4 帧')).toBeInTheDocument();
    expect(screen.getByText('87ms')).toBeInTheDocument();
    // 时间线标出 4 个掉帧帧号
    expect(screen.getAllByText(/▼掉帧/)).toHaveLength(4);
  });

  it('单步推进一帧后事件日志出现帧 0 的掉帧事件，重放后清空', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '单步' }));
    expect(screen.getByText(/帧 0 掉帧/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重放' }));
    expect(screen.queryByText(/帧 0 掉帧/)).not.toBeInTheDocument();
  });

  it('取消预加载后：掉帧降为 1、完成时间变为 32ms，并给出取消结论', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /取消预加载/ }));
    revealAll();
    expect(screen.getByText('1 帧')).toBeInTheDocument();
    expect(screen.getByText('32ms')).toBeInTheDocument();
    expect(screen.getByText(/已在开始前取消/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /恢复预加载任务/ }));
    revealAll();
    expect(screen.getByText('4 帧')).toBeInTheDocument();
    expect(screen.getByText('87ms')).toBeInTheDocument();
  });

  it('把预加载提到用户阻塞优先级后：首帧即发起长任务（指标重算）', () => {
    render(<App />);
    const card = screen.getByDisplayValue('预加载下一路信号').closest('li')!;
    const selects = within(card).getAllByRole('combobox');
    // 第二个下拉是优先级（第一个是类别）
    fireEvent.change(selects[1], { target: { value: '0' } });
    revealAll();
    // 同优先级 FIFO：decode 后立刻 preload，长任务从帧 0 发起
    expect(screen.getAllByText('长任务').length).toBeGreaterThan(0);
    expect(screen.getByText('87ms')).toBeInTheDocument();
  });

  it('加入自定义任务后删除', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /加入任务/ }));
    expect(screen.getByDisplayValue('自定义任务 1')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('删除任务 自定义任务 1'));
    expect(screen.queryByDisplayValue('自定义任务 1')).not.toBeInTheDocument();
  });

  it('切换到 30fps（33ms）预算后默认场景不再因 14+12ms 超预算而首帧掉帧', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('帧率预算'), { target: { value: '33' } });
    revealAll();
    // 33ms 预算下 decode(14)+layout(12)+log(6)=32 恰好放下；只有 55ms 预加载造成掉帧
    expect(screen.getByText('2 帧')).toBeInTheDocument();
  });
});
