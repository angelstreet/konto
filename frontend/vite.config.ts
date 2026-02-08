import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const basePath = process.env.VITE_BASE_PATH || '/kompta/';

export default defineConfig({
  plugins: [react()],
  base: basePath,
  server: {
    host: true,
    port: 5176,
    proxy: {
      [`${basePath}api`]: {
        target: 'http://localhost:3004',
        rewrite: (path) => path.replace(new RegExp(`^${basePath.replace(/\/$/, '')}`), ''),
      },
    },
  },
});
