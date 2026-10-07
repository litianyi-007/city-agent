import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

function environmentPort(name: string, fallback: number): number {
  const value = process.env[name] || String(fallback);
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new Error(`${name} must be 1–65535.`);
  return Number(value);
}
const apiPort = environmentPort('PORT', 4320);
const webPort = environmentPort('CITY_AGENT_WEB_PORT', 5180);

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/city-agent/' : '/',
  build: { outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
  resolve: { alias: { 'node:crypto': fileURLToPath(new URL('./src/browser-crypto.ts', import.meta.url)) } },
  plugins: [react(), ...(mode === 'pages' ? [{ name: 'pages-entry', transformIndexHtml: { order: 'pre' as const, handler(html: string) { return html.replace('/src/main.tsx', '/src/pages-main.tsx').replace('City Agent · 自主研发工作台', 'City Agent · 虚拟社会调查'); } } }] : [])],
  server: {
    host: '127.0.0.1', port: webPort, strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
}));
