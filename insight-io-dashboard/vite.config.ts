import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/rosbridge': {
        target: 'http://127.0.0.1:9090',
        ws: true,
        changeOrigin: true,
        rewrite: () => '/',
      },
    },
  },
})
