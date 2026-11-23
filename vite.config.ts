import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://localhost:3443',
        secure: false,
        changeOrigin: true,
      },
      '/ws': {
        target: 'wss://localhost:3443',
        ws: true,
        secure: false,
      },
    },
  },
});
