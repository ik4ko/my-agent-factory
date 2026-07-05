import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'My Agent Factory',
    short_name: 'Agent Factory',
    description: 'Control room for the federated AI brains — loops, trading, and the kill switch, from your phone.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#09090c',
    theme_color: '#09090c',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
