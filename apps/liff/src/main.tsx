import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { initLiff } from './lib/liff-auth.js';
import './index.css';

(async () => {
  try {
    await initLiff();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
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
