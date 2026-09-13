import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Renderaren ska aldrig nå Node, och den ska inte kunna ladda kod utifrån.
 * Utvecklingsläget behöver två lättnader som produktionsläget inte ska ha:
 * Vite injicerar ett inline-skript för hot reload och levererar CSS som
 * inline-stil, och hot reload använder en websocket.
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
  // Relativa sökvägar krävs när huvudprocessen laddar de byggda filerna direkt.
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
