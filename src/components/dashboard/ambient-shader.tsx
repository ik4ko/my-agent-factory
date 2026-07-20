'use client';

import { MeshGradient } from '@paper-design/shaders-react';

/** One deliberately restrained GPU layer shared by every room. */
export function AmbientShader() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-[0.18]">
      <MeshGradient
        className="size-full"
        colors={['#0b0c0e', '#101115', '#a3b1f7', '#b7a8f7', '#8ec5ff']}
        distortion={0.16}
        swirl={0.08}
        grainMixer={0.04}
        grainOverlay={0}
        speed={0.08}
        maxPixelCount={1_200_000}
      />
    </div>
  );
}
