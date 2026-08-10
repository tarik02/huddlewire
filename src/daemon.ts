import type { Browser, Page } from 'puppeteer-core';

import { readConfig } from './config.ts';
import formatError from './errors.ts';
import registerGlobalMuteShortcut from './global-shortcut.ts';
import { createMqttClient, createTopics, publishDiscovery, publishSlackStatus } from './mqtt.ts';
import { connectSlack } from './slack/client.ts';
import { installMuteStateObservers, setSlackMuted } from './slack/mute.ts';
import patchNativeScreenShare from './slack/screen-share.ts';
import { offlineStatus, readSlackStatus } from './slack/status.ts';
import setSlackSticker from './slack/sticker.ts';
import type { SlackStatus } from './slack/types.ts';
import playMuteStateSound from './sound.ts';

function stableStatusKey(status: SlackStatus) {
  return JSON.stringify(status);
}

export default async function runDaemon() {
  const config = readConfig();
  const topics = createTopics(config);
  const client = createMqttClient(config, topics);
  const slackConnection: { browser: Browser | null } = { browser: null };
  const observedMutePages = new WeakSet<Page>();
  const screenSharePatchStatuses = new Map<string, string>();
  let lastStatusKey: string | null = null;
  let lastMutedState: boolean | null = null;

  function updateMutedState(muted: boolean) {
    if (lastMutedState !== null && lastMutedState !== muted) {
      playMuteStateSound(config, muted);
    }
    lastMutedState = muted;
  }

  async function getBrowser() {
    if (!slackConnection.browser) {
      const browser = await connectSlack(config.slackCdpUrl);
      slackConnection.browser = browser;
      browser.once('disconnected', () => {
        if (slackConnection.browser === browser) {
          slackConnection.browser = null;
        }
      });
    }

    return slackConnection.browser;
  }

  const globalShortcutBus = await registerGlobalMuteShortcut(async () => {
    const action = await setSlackMuted(await getBrowser(), 'toggle');
    console.log(`global mute shortcut action: ${action}`);
  }).catch((error) => {
    console.error('global mute shortcut registration failed:', formatError(error));
    return null;
  });

  // Keep the D-Bus connection alive for as long as the daemon owns the shortcut.
  void globalShortcutBus;

  client.on('connect', () => {
    console.log('mqtt connected');
    publishDiscovery(client, config, topics);
    client.subscribe(`${config.haDiscoveryPrefix}/status`);
    client.subscribe(topics.muteSet);
    client.subscribe(topics.stickerSet);
  });
  client.on('reconnect', () => {
    console.log('mqtt reconnecting');
  });
  client.on('close', () => {
    console.log('mqtt connection closed');
  });
  client.on('offline', () => {
    console.log('mqtt offline');
  });
  client.on('message', (topic, payload) => {
    if (topic === `${config.haDiscoveryPrefix}/status` && payload.toString() === 'online') {
      publishDiscovery(client, config, topics);
    }
    if (topic === topics.muteSet) {
      const command = payload.toString();
      let muted: boolean | null = null;
      if (command === 'ON') {
        muted = true;
      } else if (command === 'OFF') {
        muted = false;
      }
      if (muted === null) {
        console.error(`unknown mute command: ${command}`);
        return;
      }

      void (async () => {
        const action = await setSlackMuted(await getBrowser(), muted);
        console.log(`slack huddle mute action: ${action}`);
      })().catch((error) => {
        console.error('slack huddle mute action failed:', formatError(error));
      });
    }
    if (topic === topics.stickerSet) {
      const sticker = payload.toString();

      void (async () => {
        const action = await setSlackSticker(await getBrowser(), sticker);
        console.log(`slack huddle sticker action: ${action}`);
      })().catch((error) => {
        console.error('slack huddle sticker action failed:', formatError(error));
      });
    }
  });
  client.on('error', (error) => {
    console.error('mqtt error:', formatError(error));
  });

  async function pollSlack() {
    try {
      const browser = await getBrowser();
      await installMuteStateObservers({
        browser,
        observedPages: observedMutePages,
        onMuteState: updateMutedState,
      });
      if (config.patchNativeScreenShare) {
        const patchResults = await patchNativeScreenShare(browser);
        for (const result of patchResults) {
          if (screenSharePatchStatuses.get(result.url) !== result.status) {
            screenSharePatchStatuses.set(result.url, result.status);
            console.log(`slack native screen-share patch: ${result.status} (${result.url})`);
          }
        }
      }

      const status = await readSlackStatus(browser);
      if (status.inHuddle && status.huddleState !== 'unknown') {
        updateMutedState(status.muted);
      } else if (!status.inHuddle) {
        lastMutedState = null;
      }

      const key = stableStatusKey(status);
      if (key !== lastStatusKey) {
        publishSlackStatus(client, topics, status);
        lastStatusKey = key;
        console.log(`slack huddle state: ${status.huddleState}`);
      }
    } catch (error) {
      const failedBrowser = slackConnection.browser;
      slackConnection.browser = null;
      await failedBrowser?.disconnect().catch(() => {});

      const status = offlineStatus();
      const key = stableStatusKey(status);
      if (key !== lastStatusKey) {
        publishSlackStatus(client, topics, status);
        lastStatusKey = key;
      }
      console.error('slack cdp read failed:', formatError(error));
    }
  }

  await new Promise<never>(() => {
    const poll = () => {
      void pollSlack().finally(() => {
        setTimeout(poll, config.pollIntervalMs);
      });
    };

    poll();
  });
}
