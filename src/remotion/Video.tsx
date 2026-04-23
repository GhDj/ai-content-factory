import { AbsoluteFill, Audio, useVideoConfig } from 'remotion';
import { Background } from './components/Background';
import { ThumbnailText } from './components/ThumbnailText';
import { Subtitles } from './components/Subtitles';
import { Watermark } from './components/Watermark';

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Props {
  backgroundPath: string;
  isBackgroundImage: boolean;
  thumbnailText: string;
  words: Word[];
  audioPath: string;
  audioDurationSeconds: number;
  musicPath?: string;
}

export const MindShieldVideo = ({
  backgroundPath,
  isBackgroundImage,
  thumbnailText,
  words,
  audioPath,
  musicPath,
}: Props) => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', width, height }}>
      <Background path={backgroundPath} isImage={isBackgroundImage} />
      <ThumbnailText text={thumbnailText} />
      <Subtitles words={words} />
      <Watermark />
      {/* Background music (YouTube only) — quiet bed, loops if shorter than video */}
      {musicPath ? <Audio src={musicPath} volume={0.12} loop /> : null}
      {/* Voiceover — full volume, rendered after music so it's mixed on top */}
      {audioPath ? <Audio src={audioPath} volume={1} /> : null}
    </AbsoluteFill>
  );
};
