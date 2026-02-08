import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/kompta/',
  server: {
    host: true,
    port: 5176,
    proxy: {
      '/kompta/api': {
        target: 'http://localhost:3004',
        rewrite: (path) => path.replace(/^\/kompta/, ''),
      },
    },
  },
});
