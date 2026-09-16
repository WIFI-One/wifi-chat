import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared')
    }
  },
  server: {
    port: 5173,
    host: true,
    // Allow opening the dev UI via the LAN hostname (Vite blocks unknown
    // Host headers by default). Served alongside `http://<LAN-IP>:5173`.
    allowedHosts: ['wifichat.local', 'wifichat'],
    hmr: {
      port: 5173
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});