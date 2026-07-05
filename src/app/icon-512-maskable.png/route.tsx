import { ImageResponse } from 'next/og';

export const runtime = 'edge';

// Maskable icon: background must bleed to every edge (no transparency) and
// the glyph must sit inside the ~80%-diameter safe-zone circle so OS icon
// masks (circle/squircle/etc.) never clip it.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090c',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 190,
            color: '#1dc98a',
          }}
        >
          ⚡
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
