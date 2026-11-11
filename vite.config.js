import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', redhaven: 'redhaven.html', snakes: 'snakes.html', tetris: 'tetris.html', arrange: 'arrange.html', spell: 'spell.html', pour: 'pour.html', frost: 'frost.html', mechanics: 'mechanics.html', tumble: 'tumble.html', cafe: 'cafe.html', racing: 'racing.html' }
    }
  },
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg'],
    workbox: {
      // several HTML entry points: don't rewrite every navigation to the landing page
      navigateFallback: null,
      // keep the cartoon fonts available offline after the first visit
      runtimeCaching: [{
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
        handler: 'CacheFirst',
        options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } }
      }]
    },
    manifest: {
      name: 'Red Haven',
      short_name: 'Red Haven',
      description: 'Low-poly cartoon games: Mars colony survival, arcade adventures, colorful puzzles and a mall tycoon sim and a toy-car racer.',
      theme_color: '#111b20',
      background_color: '#111b20',
      display: 'standalone',
            icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    }
  })]
});
