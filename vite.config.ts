import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  root: 'src/renderer',
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
