import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { ProxyOptions } from 'vite'

const API_TARGET = 'https://api.jolpi.ca'
const USER_AGENT = 'F1Explorer/1.0.0'

// Browsers are not allowed to set a User-Agent header from JavaScript, but the
// jolpica-f1 API asks callers to identify themselves. These dev proxies forward
// /ergast/* (stable endpoints) and /f1/* (alpha session results) to the real API
// and attach the header for us.
const proxy = {
  // The results cache Worker. `wrangler dev` listens on 8787, and Vercel
  // mirrors this path with an external rewrite in production.
  '/api': {
    target: 'http://127.0.0.1:8787',
    changeOrigin: true,
  },
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

  // The news feeds. RSS is XML served from the publishers' own hosts, and none
  // of them send CORS headers, so the browser cannot read a feed directly. Each
  // one is served under its own /news/<id> path instead, which keeps the request
  // same-origin. `vercel.json` mirrors these rewrites for production, so the two
  // files have to be kept in step.
  '/news/autosport': feed('https://www.autosport.com/rss/f1/news/'),
  '/news/motorsport': feed('https://www.motorsport.com/rss/f1/news/'),
  '/news/racefans': feed('https://www.racefans.net/feed/'),
  '/news/bbc': feed('https://feeds.bbci.co.uk/sport/formula1/rss.xml'),
  '/news/therace': feed('https://www.the-race.com/rss/'),
}

/** Rewrites one `/news/<id>` path onto the feed's own path on its own origin. */
function feed(url: string): ProxyOptions {
  const target = new URL(url)
  return {
    target: target.origin,
    changeOrigin: true,
    rewrite: () => target.pathname,
    headers: { 'User-Agent': USER_AGENT },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
