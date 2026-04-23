import fs from 'fs-extra';
import path from 'path';

const MUSIC_DIR = path.join(process.cwd(), 'assets', 'music');

export function getRandomMusicTrack(): string | null {
  if (!fs.pathExistsSync(MUSIC_DIR)) return null;
  const tracks = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
  if (tracks.length === 0) return null;
  const pick = tracks[Math.floor(Math.random() * tracks.length)];
  return path.join(MUSIC_DIR, pick);
}
