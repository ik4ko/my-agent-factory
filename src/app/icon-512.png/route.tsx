import { ImageResponse } from 'next/og';

export const runtime = 'edge';

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
            fontSize: 290,
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
