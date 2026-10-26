import { useEffect, useState, useCallback, useContext, useRef } from 'preact/hooks';
import { createContext } from 'preact';
import { errorText } from './lib/text.js';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// 讀資料：資料一變動（任何人做了動作）就重新讀
export function useData(fn, args, deps = []) {
  const { api, version } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const v = await api.rpc(fn, args || {});
      if (mine !== seq.current) return; // 比較晚送出的讀取已經回來了，舊的結果丟掉
      setData(v);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    }
  }, [api, fn, JSON.stringify(args)]);
  useEffect(() => {
    load();
  }, [load, version, ...deps]);
  return [data, error, load];
}

// 送出動作：成功顯示提示，失敗顯示原因
export function useAction() {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn, args, okText) => {
    if (busy) return null;
    setBusy(true);
    try {
      const v = await api.runAction(fn, args);
      if (okText) toast(okText);
      return v === null || v === undefined || v === '' ? true : v; // 沒有回傳值的動作（例如取消、熄滅）成功時回傳 true
    } catch (e) {
      toast(errorText(e), true);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

export function Flame({ size = 22, color = 'currentColor', stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={stroke}
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3c2 2.5 3 4.2 3 6a3 3 0 0 1-6 0c0-1.8 1-3.5 3-6z" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function Leaf({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" /><path d="M5 19l7-7" />
    </svg>
  );
}

export function Icon({ d, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {d.map((p) => <path d={p} />)}
    </svg>
  );
}

export const ICONS = {
  back: ['M15 18l-6-6 6-6'],
  next: ['M9 18l6-6-6-6'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  cal: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M16 3v4M8 3v4M3 10h18'],
  check: ['M9 11l3 3 8-8', 'M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9'],
  list: ['M4 6h16M4 12h16M4 18h10'],
  pen: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13 7l4 4'],
  up: ['M18 15l-6-6-6 6'],
  down: ['M6 9l6 6 6-6'],
  x: ['M6 6l12 12M18 6L6 18'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
};

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" class="switch" role="switch" aria-checked={on ? 'true' : 'false'} aria-label={label}
      onClick={() => onChange(!on)}><span /></button>
  );
}

export function Stepper({ value, min = 1, max = 30, onChange, label }) {
  return (
    <div class="stepper">
      <button type="button" aria-label={`減少${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <b>{value}</b>
      <button type="button" aria-label={`增加${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>＋</button>
    </div>
  );
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="spread">
          <h2>{title}</h2>
          <button class="icon-btn" aria-label="關閉" onClick={onClose}><Icon d={ICONS.x} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name }) {
  return <span class="avatar" aria-hidden="true">{name.slice(0, 1)}</span>;
}

export function Back({ onClick, title, right }) {
  return (
    <div class="top" style="padding-left:4px">
      <div class="row" style="gap:4px">
        <button class="icon-btn" aria-label="返回" onClick={onClick}><Icon d={ICONS.back} /></button>
        <h1 class="page" style="font-size:18px">{title}</h1>
      </div>
      {right}
    </div>
  );
}
