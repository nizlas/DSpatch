import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The renderer must never access Node or load external code.
 * Development needs two exceptions that production must not have:
 * Vite injects an inline script for hot reload and delivers CSS as inline
 * styles; hot reload also uses a WebSocket.
 */
const DEV_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const BUILD_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'dspatch:content-security-policy',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: context.server === undefined ? BUILD_POLICY : DEV_POLICY,
              },
              injectTo: 'head-prepend',
            },
          ],
        };
      },
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  // Relative paths are required when the main process loads built files directly.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  clearScreen: false,
});
