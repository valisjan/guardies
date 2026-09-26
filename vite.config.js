import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pkg from './package.json' with { type: 'json' };

// Genera /sw.js a cada build amb un identificador nou i la llista de fitxers
// d'aquesta versió, perquè cada desplegament instal·li el seu service worker.
function serviceWorkerPlugin() {
  return {
    name: 'guardies-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/') && /\.(js|css|png|svg|woff2?)$/.test(file))
        .map((file) => `/${file}`);
      const precache = ['/', '/manifest.webmanifest', '/logo_IESJSB_nav.png', '/favicon.png', ...assets];
      const source = readFileSync(resolve(import.meta.dirname, 'labs/guardies/sw-template.js'), 'utf8')
        .replace('__BUILD_ID__', JSON.stringify(String(Date.now())))
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [vue(), serviceWorkerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        diagnostics: resolve(import.meta.dirname, 'diagnostics.html'),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase')) return 'vendor-firebase';
          if (id.includes('vue') || id.includes('pinia')) return 'vendor-vue';
          return 'vendor';
        },
      },
    },
  },
});
