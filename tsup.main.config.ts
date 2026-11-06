import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/main/index.ts'], format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist/main', outExtension: () => ({ js: '.mjs' }), external: ['electron'], noExternal: ['zod'] });
