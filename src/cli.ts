#!/usr/bin/env node

import type { Browser } from 'puppeteer-core';

import runDaemon from './daemon.ts';
import { connectSlack } from './slack/client.ts';
import { setSlackMuted } from './slack/mute.ts';
import { readSlackStatus } from './slack/status.ts';

function printUsage() {
  console.log(`Usage:
  huddlewire daemon
  huddlewire mute toggle|on|off
  huddlewire status [--json]

Environment:
  SLACK_CDP_URL   Slack DevTools endpoint (default: http://127.0.0.1:9224)
  MQTT_URL        MQTT broker URL required by the daemon`);
}

async function runOneShot<T>(command: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await connectSlack(process.env['SLACK_CDP_URL'] ?? 'http://127.0.0.1:9224');
  try {
    return await command(browser);
  } finally {
    await browser.disconnect();
  }
}

async function runCli(args: string[]) {
  const [command, ...commandArgs] = args;
  if (command === 'daemon') {
    await runDaemon();
    return;
  }
  if (command === 'mute') {
    const mode = commandArgs[0] ?? 'toggle';
    if (mode !== 'toggle' && mode !== 'on' && mode !== 'off') {
      throw new Error(`unknown mute mode: ${mode}`);
    }
    let target: boolean | 'toggle' = mode === 'on';
    if (mode === 'toggle') {
      target = 'toggle';
    }
    const result = await runOneShot((browser) => setSlackMuted(browser, target));
    console.log(result);
    if (result !== 'changed' && result !== 'already_set') {
      process.exitCode = 2;
    }
    return;
  }
  if (command === 'status') {
    const status = await runOneShot(readSlackStatus);
    if (commandArgs.includes('--json')) {
      console.log(JSON.stringify(status));
    } else {
      console.log(status.huddleState);
    }
    return;
  }
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  let message = String(error);
  if (error instanceof Error) {
    message = error.message;
  }
  console.error(message);
  process.exit(1);
}
