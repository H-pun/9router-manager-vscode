import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * vscode-icon requires codicons.css linked with id="vscode-codicon-stylesheet",
 * so ship the stylesheet + font as standalone files next to the bundle.
 */
function copyCodicons(): Plugin {
  return {
    name: 'copy-codicons',
    closeBundle() {
      const src = resolve(__dirname, 'node_modules/@vscode/codicons/dist');
      const out = resolve(__dirname, 'dist/codicons');
      mkdirSync(out, { recursive: true });
      for (const file of ['codicon.css', 'codicon.ttf']) {
        const target = resolve(out, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(src, file), target);
      }
    },
  };
}

// Built assets are loaded by the extension via webview.asWebviewUri(),
// so file names must be stable (no hashes) and paths relative.
export default defineConfig({
  plugins: [react(), copyCodicons()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
