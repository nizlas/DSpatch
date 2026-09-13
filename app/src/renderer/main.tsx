import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const host = document.getElementById('root');

if (host === null) {
  throw new Error('Renderarens rotelement #root saknas i index.html.');
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
