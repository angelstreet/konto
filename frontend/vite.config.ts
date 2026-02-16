import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const basePath = process.env.VITE_BASE_PATH || '/konto/';

export default defineConfig({
  plugins: [react()],
  base: basePath,
  server: {
    host: true,
    port: parseInt(process.env.VITE_DEV_PORT || '3004'),
    allowedHosts: [
      'konto.angelstreet.io',
      '.angelstreet.io',
      'localhost',
      '65.108.14.251',
    ],
    proxy: {
      [`${basePath}api`]: {
        target: 'http://localhost:5004',
        rewrite: (path) => path.replace(new RegExp(`^${basePath.replace(/\/$/, '')}`), ''),
      },
    },
  },
});
