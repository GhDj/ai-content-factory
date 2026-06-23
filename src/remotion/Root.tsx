import { Composition } from 'remotion';
import { MindShieldVideo } from './Video';

export const Root = () => (
  <Composition
    id="MindShieldVideo"
    component={MindShieldVideo}
    durationInFrames={1800}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{
      backgroundPath: '',
      isBackgroundImage: true,
      backgroundDurationFrames: 150,
      thumbnailText: 'MIND SHIELD DAILY',
      words: [] as Array<{ word: string; start: number; end: number }>,
      audioPath: '',
      audioDurationSeconds: 60,
      musicPath: '',
      logoPath: '',
    }}
  />
);
