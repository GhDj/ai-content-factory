import { AbsoluteFill, Img } from 'remotion';

interface Props {
  logoUrl?: string;
}

export const Watermark = ({ logoUrl }: Props) => (
  <AbsoluteFill>
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        right: 36,
        opacity: 0.35,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {logoUrl ? (
        <Img
          src={logoUrl}
          style={{
            width: 80,
            height: 80,
            objectFit: 'contain',
          }}
        />
      ) : null}
      <span
        style={{
          fontFamily: 'sans-serif',
          fontWeight: 700,
          fontSize: 18,
          color: '#FFFFFF',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        @mindshieldaily
      </span>
    </div>
  </AbsoluteFill>
);
