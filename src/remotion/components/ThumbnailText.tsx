import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig } from 'remotion';

interface Props {
  text: string;
}

export const ThumbnailText = ({ text }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({ frame, fps, config: { damping: 20 }, durationInFrames: 20 });
  const raise = spring({
    frame,
    fps,
    config: { damping: 15 },
    durationInFrames: 25,
  });
  const translateY = -30 + raise * 30; // from -30 to 0

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: '10%',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 40px',
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            background: 'rgba(0,0,0,0.72)',
            borderRadius: 12,
            padding: '18px 32px',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'sans-serif',
              fontWeight: 900,
              fontSize: 68,
              color: '#FFFFFF',
              textTransform: 'uppercase',
              letterSpacing: 2,
              textShadow: '2px 2px 8px rgba(0,0,0,0.9)',
              lineHeight: 1.15,
              display: 'block',
            }}
          >
            {text}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
