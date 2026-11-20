import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import process from 'node:process'

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const appVersion = pkg.version || '1.0.0'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        // PDF.js workers are ESM assets, not transformed entry points. Emit a
        // fresh .js URL so installed clients bypass old .mjs responses cached
        // before Nginx's JavaScript MIME mapping was corrected. Keep the module
        // bytes/exports intact for both real-worker and fake-worker loading.
        assetFileNames: asset => asset.names.some(name => name.endsWith('.mjs'))
          ? 'assets/[name]-[hash].js'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
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
        importScripts: ['offline-cache-policy.js'],
        navigateFallback: 'index.html',
        // API routes, discovery URLs, and direct links to uploaded files are not app pages.
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads(?:\/|$)/, /^\/mcp(?:\/|$)/, /^\/\.well-known\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,mjs,glb}'],
        maximumFileSizeToCacheInBytes: 20000000, // 20MB to cover large chunks/models
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/entity-photos/') && url.pathname.endsWith('.thumb.webp'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'entity-photo-thumbnails-v1',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/entity-photos/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => globalThis.isPublicMapApi(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 1, // Fast fallback to cache if offline
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              plugins: [{
                cacheKeyWillBeUsed: async ({ request }) => request.url,
                cacheWillUpdate: async ({ response }) =>
                  response.status === 200 && !/\b(private|no-store)\b/i.test(response.headers.get('Cache-Control') || '')
                    ? response : null,
              }],
            }
          },
          {
            // Reference documents always use the external online viewer.
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/equipment-documents/') || /^\/api\/equipment\/\d+\/documents/.test(url.pathname),
            handler: 'NetworkOnly'
          },
          {
            // Floorplan files (images/pdfs): CacheFirst for instant load
            urlPattern: ({ url }) => url.pathname.startsWith('/api/uploads/') || url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-cache',
              fetchOptions: { cache: 'reload' },
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
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            options: { fetchOptions: { cache: 'no-store' } },
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
