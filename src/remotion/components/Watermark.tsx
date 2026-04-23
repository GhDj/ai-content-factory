import { AbsoluteFill } from 'remotion';

export const Watermark = () => (
  <AbsoluteFill>
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        right: 36,
        opacity: 0.35,
        fontFamily: 'sans-serif',
        fontWeight: 700,
        fontSize: 26,
        color: '#FFFFFF',
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}
    >
      MindShieldDaily
    </div>
  </AbsoluteFill>
);
