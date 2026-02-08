import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/kompta/',
  server: {
    port: 5173,
    proxy: {
      '/kompta/api': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/kompta/, ''),
      },
    },
  },
});
