import type { Browser } from 'puppeteer-core';
import { connectSlack, readSlackStatus, runDaemon, setSlackMuted } from './main.js';

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
  const browser = await connectSlack(process.env.SLACK_CDP_URL ?? 'http://127.0.0.1:9224');
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
    const target = mode === 'toggle' ? 'toggle' : mode === 'on';
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
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
