import 'dotenv/config';
import http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { google, type Auth } from 'googleapis';
import { log } from '../utils/logger';

const TOKEN_PATH = path.join(process.cwd(), 'assets', 'youtube-token.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function buildClient(): Auth.OAuth2Client {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirect = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
  if (!clientId || !clientSecret) {
    throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set in .env');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirect);
}

async function waitForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '', `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Auth failed: ${error}</h1>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authorized! You can close this tab.</h1>');
          server.close();
          resolve(code);
        } else {
          res.writeHead(404);
          res.end();
        }
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.listen(port);
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

export async function authenticateYouTube(): Promise<void> {
  const oauth2 = buildClient();
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  log.info('Opening browser for Google consent screen...');
  log.info(`If the browser does not open, visit:\n  ${authUrl}`);
  exec(`open "${authUrl}"`);

  const code = await waitForCode(3000);
  const { tokens } = await oauth2.getToken(code);

  await fs.ensureDir(path.dirname(TOKEN_PATH));
  await fs.writeJson(TOKEN_PATH, tokens, { spaces: 2 });
  log.success(`YouTube token saved to ${TOKEN_PATH}`);
}

export async function loadYouTubeClient(): Promise<Auth.OAuth2Client> {
  const oauth2 = buildClient();
  if (!(await fs.pathExists(TOKEN_PATH))) {
    throw new Error(`No YouTube token at ${TOKEN_PATH}. Run: npm run auth:youtube`);
  }
  const tokens = await fs.readJson(TOKEN_PATH);
  oauth2.setCredentials(tokens);
  return oauth2;
}

if (require.main === module) {
  authenticateYouTube().catch((err) => {
    log.error(String(err));
    process.exit(1);
  });
}
