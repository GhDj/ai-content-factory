import { AbsoluteFill, OffthreadVideo, Loop, Img, useVideoConfig, useCurrentFrame, interpolate } from 'remotion';

interface Props {
  path: string;
  isImage: boolean;
  // Source clip duration in frames — required to loop video backgrounds
  // when the composition is longer than the clip. Falls back to 150
  // (5 s @ 30 fps) which matches the shortest Pexels clip we accept.
  backgroundDurationFrames?: number;
}

export const Background = ({ path, isImage, backgroundDurationFrames }: Props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  if (isImage) {
    // Ken Burns slow zoom
    const scale = interpolate(frame, [0, durationInFrames], [1, 1.15]);
    return (
      <AbsoluteFill>
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            backgroundColor: '#000',
          }}
        >
          <Img
            src={path}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
            }}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // Loop the clip until the composition ends. OffthreadVideo decodes
  // through ffmpeg (reliable for arbitrary Pexels codecs); muted so the
  // clip's native audio never bleeds into the voiceover mix.
  const loopFrames = Math.max(30, backgroundDurationFrames ?? 150);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Loop durationInFrames={loopFrames}>
        <OffthreadVideo
          src={path}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Loop>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
        }}
      />
    </AbsoluteFill>
  );
};
