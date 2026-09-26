import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Sempre la 5173: se è occupata Vite si ferma invece di spostarsi su un'altra porta.
  server: { port: 5173, strictPort: true },
})
