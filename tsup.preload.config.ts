import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/preload/index.ts'], format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist/preload', outExtension: () => ({ js: '.cjs' }), external: ['electron'] });
