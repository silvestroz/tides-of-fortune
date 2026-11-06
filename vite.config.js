import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` → dist/tides-of-fortune.html : one self-contained file (all JS/CSS/assets inlined;
// only the Google Fonts stylesheet is fetched externally). See tools/build.mjs.
export default defineConfig(({ command }) => ({
  // single-file publish build excludes the optional GLB duel captain (?captain=glb stays a dev-only toggle)
  define: { __NO_GLB_CAPTAIN__: command === 'build' ? 'true' : 'false' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, hmr: false },
  build: { target: 'es2022', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 50000, cssCodeSplit: false, modulePreload: false },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
}));
