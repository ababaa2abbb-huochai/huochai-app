import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { loadBackend } from './api/index.js';
import { App } from './App.jsx';
import { Flame } from './ui.jsx';

function Root() {
  const [api, setApi] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const b = await loadBackend();
        await b.init();
        setApi(b);
      } catch (e) {
        console.error(e);
        setErr(String(e?.message || e));
      }
    })();
  }, []);
  if (err) {
    return <div class="loading"><Flame size={36} color="#C2410C" /><p class="empty">打不開小火柴：{err}<br />請重新整理再試一次。</p></div>;
  }
  if (!api) {
    return (
      <div class="loading">
        <Flame size={36} color="#C2410C" />
        <span>{import.meta.env.MODE === 'demo' || import.meta.env.DEV ? '正在準備試玩資料，第一次大約需要 10 秒…' : '正在登入…'}</span>
      </div>
    );
  }
  return <App api={api} />;
}

render(<Root />, document.getElementById('app'));
