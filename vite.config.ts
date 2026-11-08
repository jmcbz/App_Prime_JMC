import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.API_PROXY || 'http://127.0.0.1:4100',
        // Keep the browser Host so the API can verify same-origin cookie writes.
        changeOrigin: false,
      },
    },
  },
});
