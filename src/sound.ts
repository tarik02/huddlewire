import { spawn } from 'node:child_process';

import type { Config } from './config.ts';
import formatError from './errors.ts';

export default function playMuteStateSound(config: Config, muted: boolean) {
  if (config.soundPlayer === undefined || config.soundPlayer === '') {
    return;
  }

  const sampleRate = 48000;
  const durationSeconds = 0.16;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(sampleCount * 2);
  let startFrequency = 380;
  let endFrequency = 620;
  let stateLabel = 'unmuted';
  if (muted) {
    startFrequency = 620;
    endFrequency = 380;
    stateLabel = 'muted';
  }
  let phase = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const progress = sample / sampleCount;
    const frequency = startFrequency + (endFrequency - startFrequency) * progress;
    const envelope = Math.min(progress / 0.08, (1 - progress) / 0.25, 1);
    phase += (2 * Math.PI * frequency) / sampleRate;
    pcm.writeInt16LE(Math.round(Math.sin(phase) * envelope * 32767), sample * 2);
  }

  const player = spawn(
    config.soundPlayer,
    [
      '--raw',
      '--format',
      's16',
      '--rate',
      String(sampleRate),
      '--channels',
      '1',
      '--latency',
      '20ms',
      '-',
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  player.on('error', (error) => {
    console.error(`failed to play ${stateLabel} sound:`, formatError(error));
  });
  player.on('exit', (code) => {
    if (code !== 0) {
      console.error(`${stateLabel} sound player exited with code ${code}`);
    }
  });
  player.stdin.on('error', (error) => {
    console.error(`failed to send ${stateLabel} sound:`, formatError(error));
  });
  player.stdin.end(pcm);
  player.unref();
}
