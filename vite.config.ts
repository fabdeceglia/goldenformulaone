import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = 'https://api.jolpi.ca'
const USER_AGENT = 'F1Explorer/1.0.0'

// Browsers are not allowed to set a User-Agent header from JavaScript, but the
// jolpica-f1 API asks callers to identify themselves. These dev proxies forward
// /ergast/* (stable endpoints) and /f1/* (alpha session results) to the real API
// and attach the header for us.
const proxy = {
  '/ergast': {
    target: API_TARGET,
    changeOrigin: true,
    headers: { 'User-Agent': USER_AGENT },
  },
  '/f1': {
    target: API_TARGET,
    changeOrigin: true,
    headers: { 'User-Agent': USER_AGENT },
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
