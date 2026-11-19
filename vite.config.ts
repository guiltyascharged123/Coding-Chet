import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          // Keep shared React and Vite helpers outside graphics chunks. Otherwise
          // the main UI imports a helper from a 3D chunk and eagerly loads it.
          if (
            /\/node_modules\/(?:react|react-dom|react-is|scheduler)\//.test(id) ||
            id.includes('vite/preload-helper') ||
            id.includes('commonjsHelpers')
          )
            return 'ui-runtime';
          if (id.includes('/node_modules/three/')) return 'three-engine';
          if (id.includes('/node_modules/@react-three/fiber/')) return 'three-bindings';
          if (id.includes('/node_modules/@react-three/drei/')) return 'three-ui';
        },
      },
    },
  },
});
