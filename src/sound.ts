import { spawn } from 'node:child_process';

import type { Config } from './config.ts';
import formatError from './errors.ts';

export default function playMuteStateSound(config: Config, muted: boolean) {
  if (config.sound === undefined) {
    return;
  }

  let soundPath = config.sound.unmutedPath;
  let stateLabel = 'unmuted';
  if (muted) {
    soundPath = config.sound.mutedPath;
    stateLabel = 'muted';
  }

  const player = spawn(config.sound.player, ['--latency', '20ms', soundPath], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  player.on('error', (error) => {
    console.error(`failed to play ${stateLabel} sound:`, formatError(error));
  });
  player.on('exit', (code) => {
    if (code !== 0) {
      console.error(`${stateLabel} sound player exited with code ${code}`);
    }
  });
  player.unref();
}
