// Bundle the server (and the shared game engine) into one file: dist-server/server.mjs
import { build } from 'esbuild';
await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist-server/server.mjs',
  external: ['ws'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
