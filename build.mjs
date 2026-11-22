import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  minify: true,
});

await build({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/webview.js',
  minify: true,
});
