import { AbsoluteFill, Video, Img, useVideoConfig, useCurrentFrame, interpolate } from 'remotion';

interface Props {
  path: string;
  isImage: boolean;
}

export const Background = ({ path, isImage }: Props) => {
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

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video src={path} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
