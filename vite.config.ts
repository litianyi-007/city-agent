import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { productionEnvironment } from './config/production-environment';

const production = productionEnvironment();

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/city-agent/' : '/',
  build: { outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
  resolve: { alias: { 'node:crypto': fileURLToPath(new URL('./src/browser-crypto.ts', import.meta.url)) } },
  plugins: [react(), ...(mode === 'pages' ? [{ name: 'pages-entry', transformIndexHtml: { order: 'pre' as const, handler(html: string) { return html.replace('/src/main.tsx', '/src/pages-main.tsx').replace('City Agent · 自主研发工作台', 'City Agent · 虚拟社会调查'); } } }] : [])],
  server: {
    host: '127.0.0.1', port: production.webPort, strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${production.apiPort}` },
  },
  preview: { host: '127.0.0.1', port: production.previewPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${production.apiPort}` } },
}));
