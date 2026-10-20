import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> normal multi-file build in dist/
// `npm run build:single` -> one self-contained dist-single/index.html (easy to share / host anywhere)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  // During `npm run dev`, online play talks to the server started with `npm run dev:server`.
  server: { proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } } },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
}));
