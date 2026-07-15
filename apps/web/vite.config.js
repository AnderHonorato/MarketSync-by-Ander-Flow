import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), 'VITE_');
    return {
        plugins: [react()],
        server: {
            host: '127.0.0.1',
            port: Number(env.VITE_WEB_PORT || 5180),
            proxy: env.VITE_API_PROXY_TARGET
                ? {
                    '/api': {
                        target: env.VITE_API_PROXY_TARGET,
                        changeOrigin: true,
                        secure: false,
                    },
                }
                : undefined,
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
