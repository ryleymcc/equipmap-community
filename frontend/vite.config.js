import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import process from 'node:process'

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const appVersion = pkg.version || '1.0.0'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://backend:8000',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
    hmr: {
      clientPort: 5173,
    },
  },
  define: {
    '__BUILD_TIME__': JSON.stringify(new Date().toLocaleString()),
    '__APP_VERSION__': JSON.stringify(appVersion),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      devOptions: {
        // Vite serves mutable source modules in development. A service worker
        // cannot safely precache those modules and can otherwise reload the app.
        enabled: false,
      },
      manifest: false, // use existing manifest.json in public folder
      workbox: {
        importScripts: ['/sw-push.js'],
        navigateFallback: 'index.html',
        // OAuth browser redirects and MCP discovery must always reach the server.
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp(?:\/|$)/, /^\/\.well-known\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,mjs,glb}'],
        maximumFileSizeToCacheInBytes: 20000000, // 20MB to cover large chunks/models
        runtimeCaching: [
          {
            // Wait for live work-order data; use cache only on network failure.
            // A short timeout can bring deleted orders back from stale cache.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/work-orders'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // API calls for entity data: NetworkFirst with short timeout.
            // Exclude uploads, auth/tokens, users/me, and sync checks so session state is always fresh.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/work-orders') &&
              !url.pathname.startsWith('/api/uploads/') &&

              !url.pathname.startsWith('/api/users/me') &&
              !url.pathname.startsWith('/api/token') &&
              !url.pathname.startsWith('/api/refresh-token') &&
              !url.pathname.startsWith('/api/auth/') &&
              !url.pathname.includes('/room-scan') &&
              !url.pathname.startsWith('/api/chatgpt/') &&
              !url.pathname.startsWith('/api/notifications/') &&
              !url.pathname.startsWith('/api/sync/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 1, // Fast fallback to cache if offline
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Floorplan files (images/pdfs): CacheFirst for instant load
            urlPattern: ({ url }) => url.pathname.startsWith('/api/uploads/') || url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 90 // 90 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: ({ url }) => url.host === 'unpkg.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'external-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
})
