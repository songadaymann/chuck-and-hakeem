import { defineConfig } from 'vite';
// `npm run dev` serves the game alone (solo). To play against the local server, run `npm run serve` (wrangler on 8787).
export default defineConfig({
  base: './',   // every address in the build is relative, so it runs at the root of its own host and under mann.cool/leave/ alike
  build: { target: 'es2022' },
  resolve: { dedupe: ['three'] },
  // name every three.js add-on up front, or the dev server bundles a second copy of three.js the first time one is seen
  optimizeDeps: { include: ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/SkeletonUtils.js', 'three/addons/utils/BufferGeometryUtils.js'] },
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/api': 'http://localhost:8787' } },
});
