import { defineConfig } from 'vite';
// Each build gets its own name. It is baked into the game (__BUILD__) and written beside it as version.json, so a tab
// left open across a deploy can tell that it is running old code (src/plugins/update.js).
const BUILD = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
const version = () => ({
  name: 'version-json', apply: 'build',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) + '\n' }); },
});
// `npm run dev` serves the game alone (solo). To play against the local server, run `npm run serve` (wrangler on 8787).
export default defineConfig({
  base: './',   // every address in the build is relative, so it runs at the root of its own host and under mann.cool/leave/ alike
  build: { target: 'es2022' },
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [version()],
  resolve: { dedupe: ['three'] },
  // name every three.js add-on up front, or the dev server bundles a second copy of three.js the first time one is seen
  optimizeDeps: { include: ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/SkeletonUtils.js', 'three/addons/utils/BufferGeometryUtils.js'] },
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/api': 'http://localhost:8787' } },
});
