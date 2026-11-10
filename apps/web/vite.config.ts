import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入（PRD §13.4：禁止全量注册）
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期代理到本地 api（生产由 nginx 转发，见 deploy/nginx.conf）
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  preview: {
    // 生产构建本地预览（vite preview），与 server 同样的代理
    port: 4173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
