import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const upstream = new URL(env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1');
  const basePath = upstream.pathname.replace(/\/$/, '');
  return {
    plugins: [react(), tailwind()],
    build: {
      rollupOptions: { output: { manualChunks(id) {
        if (id.includes('/node_modules/')) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('/node_modules/zod/')) return 'validation';
        }
      } } },
    },
    server: {
      proxy: {
        '/api/v1': {
          target: upstream.origin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/v1/, basePath),
        },
      },
    },
  };
});