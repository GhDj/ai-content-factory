import fs from 'fs-extra';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'output', 'logs');

function timestamp(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function write(level: string, icon: string, msg: string) {
  const line = `[${timestamp()}] ${icon} ${msg}`;
  console.log(line);
  try {
    fs.ensureDirSync(LOG_DIR);
    fs.appendFileSync(path.join(LOG_DIR, `${dateStamp()}.log`), line + '\n');
  } catch {
    // don't let logging crash the app
  }
}

export const log = {
  info:    (msg: string) => write('info',    'ℹ️ ', msg),
  success: (msg: string) => write('success', '✅', msg),
  warn:    (msg: string) => write('warn',    '⚠️ ', msg),
  error:   (msg: string) => write('error',   '❌', msg),
};
