import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'Redhaven: Mars Colony',
      short_name: 'Redhaven',
      description: 'A low-poly colony survival strategy game on a habitable Mars.',
      theme_color: '#111b20',
      background_color: '#111b20',
      display: 'standalone',
      orientation: 'landscape',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    }
  })]
});
