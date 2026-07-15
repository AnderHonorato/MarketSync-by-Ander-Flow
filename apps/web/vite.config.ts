import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_WEB_PORT || 5180),
      strictPort: false,
      proxy: {
            '/api': {
              target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3100',
              changeOrigin: true,
              secure: false,
            },
          },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
      css: true,
      restoreMocks: true,
    },
  };
});
