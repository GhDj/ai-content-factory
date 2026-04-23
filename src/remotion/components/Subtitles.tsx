import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Chunk {
  words: Word[];
  chunk_start: number;
  chunk_end: number;
}

interface Props {
  words: Word[];
}

function chunkWords(words: Word[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < words.length; i += 3) {
    const slice = words.slice(i, i + 3);
    if (slice.length === 0) continue;
    chunks.push({
      words: slice,
      chunk_start: slice[0].start,
      chunk_end: slice[slice.length - 1].end,
    });
  }
  return chunks;
}

export const Subtitles = ({ words }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeSeconds = frame / fps;

  const chunks = chunkWords(words);
  const activeChunk = chunks.find(
    (c) => currentTimeSeconds >= c.chunk_start && currentTimeSeconds <= c.chunk_end
  );

  if (!activeChunk) return null;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: '65%',
          left: 0,
          right: 0,
          padding: '0 48px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            background: 'rgba(0,0,0,0.65)',
            borderRadius: 10,
            padding: '14px 28px',
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {activeChunk.words.map((w, i) => {
            const isActive = currentTimeSeconds >= w.start && currentTimeSeconds <= w.end;
            return (
              <span
                key={i}
                style={{
                  fontFamily: 'sans-serif',
                  fontWeight: 900,
                  fontSize: 58,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isActive ? '#CC0000' : '#FFFFFF',
                  textShadow: '2px 2px 6px rgba(0,0,0,0.95)',
                  transition: 'color 0.1s ease',
                  lineHeight: 1.2,
                }}
              >
                {w.word.toUpperCase()}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
