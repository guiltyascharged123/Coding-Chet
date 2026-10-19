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
        manualChunks: {
          'three-engine': ['three'],
          'three-bindings': ['@react-three/fiber'],
          'three-ui': ['@react-three/drei'],
        },
      },
    },
  },
});
