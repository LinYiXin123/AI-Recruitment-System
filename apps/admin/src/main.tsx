import './index.css';
import '@douyinfe/semi-ui/react19-adapter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('未找到应用入口');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
