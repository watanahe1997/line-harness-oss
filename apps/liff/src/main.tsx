import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { initLiff } from './lib/liff-auth.js';
import './index.css';

// three-surfaces bundle（2026-08-24）: このアプリが `/liff-app` のようなサブパスで
// 配信されるとき、クライアント側ルーティングもそのプレフィックス配下で動く必要がある。
// `import.meta.env.BASE_URL`（vite が vite.config.ts の `base` から自動で埋める。
// 末尾 '/' 付き）を react-router の basename に渡す — root 配信（'/'）のときは
// basename='' になり、これまでどおり動く。
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '');

(async () => {
  try {
    await initLiff();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  } catch (err) {
    const root = document.getElementById('root')!;
    const container = document.createElement('div');
    container.style.padding = '2rem';
    container.style.fontFamily = 'sans-serif';
    container.style.color = '#b91c1c';

    const heading = document.createElement('h1');
    heading.style.fontSize = '1.25rem';
    heading.style.marginBottom = '1rem';
    heading.textContent = '起動できませんでした';

    const message = document.createElement('p');
    message.textContent = err instanceof Error ? err.message : String(err);

    container.append(heading, message);
    root.replaceChildren(container);
  }
})();
