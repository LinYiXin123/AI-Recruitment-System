import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [
    // Semi 的组件自带 CSS，在 Vite 中统一放入 Tailwind base 与 utilities 之间。
    {
      name: 'semi-css-layer',
      enforce: 'pre',
      transform(code, id) {
        if (id.includes('/@douyinfe/') && id.split('?')[0].endsWith('.css'))
          return { code: `@layer semi {${code}}`, map: null };
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api': { target: process.env.API_TARGET || 'http://127.0.0.1:8100', changeOrigin: false },
    },
  },
});
