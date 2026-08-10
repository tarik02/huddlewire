import * as dbus from 'dbus-next';
import type { ClientInterface } from 'dbus-next';
import mqtt, { type MqttClient } from 'mqtt';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { inspect } from 'node:util';

const appName = 'huddlewire';
const appVersion = '0.1.0';

type Config = {
  slackCdpUrl: string;
  patchNativeScreenShare: boolean;
  mqttUrl: string;
  mqttUsername: string | undefined;
  mqttPassword: string | undefined;
  mqttBaseTopic: string;
  haDiscoveryPrefix: string;
  pollIntervalMs: number;
  deviceId: string;
  deviceName: string;
};

type PageStatus = {
  url: string;
  inHuddle: boolean;
  muted: boolean | null;
  muteLabel: string | null;
  huddleTitle: string | null;
  stickerLabel: string | null;
  stickerEmoji: string | null;
  stickerActionLabel: string | null;
  stickerActionEmoji: string | null;
  hasStickerButton: boolean;
  hasStickerPicker: boolean;
  hasMuteButton: boolean;
};

type SlackStatus = {
  slackConnected: boolean;
  inHuddle: boolean;
  muted: boolean;
  huddleState: 'muted' | 'unmuted' | 'not_in_huddle' | 'unknown';
  muteLabel: string | null;
  huddleTitle: string | null;
  stickerLabel: string | null;
  stickerEmoji: string | null;
  stickerActionLabel: string | null;
  stickerActionEmoji: string | null;
  stickerOptions: readonly string[];
  pageUrl: string | null;
  source: 'slack-cdp';
};

type Topics = {
  availability: string;
  state: string;
  attributes: string;
  mute: string;
  muteSet: string;
  huddle: string;
  sticker: string;
  stickerSet: string;
};

const stickerOptions = ['Raise hand', 'Be right back', 'Yes', 'No', 'Done'] as const;
const noStickerOption = 'None';
const mqttStickerOptions = [noStickerOption, ...stickerOptions] as const;

function readConfig(): Config {
  const mqttUrl = process.env.MQTT_URL;
  if (!mqttUrl) {
    throw new Error('MQTT_URL is required');
  }
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1000);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 250) {
    throw new Error('POLL_INTERVAL_MS must be at least 250');
  }

  return {
    slackCdpUrl: process.env.SLACK_CDP_URL ?? 'http://127.0.0.1:9224',
    patchNativeScreenShare: process.env.PATCH_NATIVE_SCREEN_SHARE !== 'false',
    mqttUrl,
    mqttUsername: process.env.MQTT_USERNAME || undefined,
    mqttPassword: process.env.MQTT_PASSWORD || undefined,
    mqttBaseTopic: process.env.MQTT_BASE_TOPIC ?? appName,
    haDiscoveryPrefix: process.env.HA_DISCOVERY_PREFIX ?? 'homeassistant',
    pollIntervalMs,
    deviceId: process.env.HA_DEVICE_ID ?? 'huddlewire',
    deviceName: process.env.HA_DEVICE_NAME ?? 'Slack huddle',
  };
}

function createTopics(config: Config): Topics {
  return {
    availability: `${config.mqttBaseTopic}/availability`,
    state: `${config.mqttBaseTopic}/state`,
    attributes: `${config.mqttBaseTopic}/attributes`,
    mute: `${config.mqttBaseTopic}/mute`,
    muteSet: `${config.mqttBaseTopic}/mute/set`,
    huddle: `${config.mqttBaseTopic}/huddle`,
    sticker: `${config.mqttBaseTopic}/sticker`,
    stickerSet: `${config.mqttBaseTopic}/sticker/set`,
  };
}

function createMqttClient(config: Config, topics: Topics): MqttClient {
  return mqtt.connect(config.mqttUrl, {
    clientId: `${appName}-${process.pid}`,
    reconnectPeriod: 5000,
    will: {
      topic: topics.availability,
      payload: 'offline',
      retain: true,
    },
    ...(config.mqttUsername ? { username: config.mqttUsername } : {}),
    ...(config.mqttPassword ? { password: config.mqttPassword } : {}),
  });
}

function publish(client: MqttClient, topic: string, payload: string, retain = true) {
  client.publish(topic, payload, { retain }, (error) => {
    if (error) {
      console.error(`mqtt publish failed for ${topic}:`, formatError(error));
    }
  });
}

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return inspect(error, { colors: false, depth: 3 });
  }

  const details = {
    name: error.name,
    message: error.message,
    code: 'code' in error ? error.code : undefined,
    errno: 'errno' in error ? error.errno : undefined,
    syscall: 'syscall' in error ? error.syscall : undefined,
    address: 'address' in error ? error.address : undefined,
    port: 'port' in error ? error.port : undefined,
    reasonCode: 'reasonCode' in error ? error.reasonCode : undefined,
    cause: error.cause,
  };

  return inspect(details, { colors: false, depth: 3 });
}

function discoveryPayload(config: Config, topics: Topics) {
  const device = {
    identifiers: [config.deviceId],
    name: config.deviceName,
    manufacturer: 'Slack',
  };
  const origin = {
    name: appName,
    sw_version: appVersion,
  };
  const availability = {
    availability_topic: topics.availability,
    payload_available: 'online',
    payload_not_available: 'offline',
  };

  return {
    muted: {
      name: 'Huddle muted',
      unique_id: `${config.deviceId}_huddle_muted`,
      state_topic: topics.mute,
      payload_on: 'ON',
      payload_off: 'OFF',
      json_attributes_topic: topics.attributes,
      icon: 'mdi:microphone-off',
      device,
      origin,
      ...availability,
    },
    inHuddle: {
      name: 'In huddle',
      unique_id: `${config.deviceId}_in_huddle`,
      state_topic: topics.huddle,
      payload_on: 'ON',
      payload_off: 'OFF',
      json_attributes_topic: topics.attributes,
      icon: 'mdi:phone-in-talk',
      device,
      origin,
      ...availability,
    },
    state: {
      name: 'Huddle state',
      unique_id: `${config.deviceId}_huddle_state`,
      state_topic: topics.state,
      value_template: '{{ value_json.huddle_state }}',
      json_attributes_topic: topics.attributes,
      icon: 'mdi:account-voice',
      device,
      origin,
      ...availability,
    },
    muteSwitch: {
      name: 'Huddle mute',
      unique_id: `${config.deviceId}_huddle_mute_switch`,
      state_topic: topics.mute,
      command_topic: topics.muteSet,
      payload_on: 'ON',
      payload_off: 'OFF',
      state_on: 'ON',
      state_off: 'OFF',
      optimistic: false,
      retain: false,
      json_attributes_topic: topics.attributes,
      icon: 'mdi:microphone-off',
      device,
      origin,
      ...availability,
    },
    stickerSelect: {
      name: 'Huddle sticker',
      unique_id: `${config.deviceId}_huddle_sticker`,
      state_topic: topics.sticker,
      command_topic: topics.stickerSet,
      options: mqttStickerOptions,
      optimistic: false,
      retain: false,
      json_attributes_topic: topics.attributes,
      icon: 'mdi:sticker-emoji',
      device,
      origin,
      ...availability,
    },
  };
}

function publishDiscovery(client: MqttClient, config: Config, topics: Topics) {
  const payload = discoveryPayload(config, topics);
  publish(
    client,
    `${config.haDiscoveryPrefix}/binary_sensor/${config.deviceId}/huddle_muted/config`,
    JSON.stringify(payload.muted),
  );
  publish(
    client,
    `${config.haDiscoveryPrefix}/binary_sensor/${config.deviceId}/in_huddle/config`,
    JSON.stringify(payload.inHuddle),
  );
  publish(
    client,
    `${config.haDiscoveryPrefix}/sensor/${config.deviceId}/huddle_state/config`,
    JSON.stringify(payload.state),
  );
  publish(
    client,
    `${config.haDiscoveryPrefix}/switch/${config.deviceId}/huddle_mute/config`,
    JSON.stringify(payload.muteSwitch),
  );
  publish(
    client,
    `${config.haDiscoveryPrefix}/select/${config.deviceId}/huddle_sticker/config`,
    JSON.stringify(payload.stickerSelect),
  );
}

function publishSlackStatus(client: MqttClient, topics: Topics, status: SlackStatus) {
  const updatedAt = new Date().toISOString();
  const state = {
    slack_connected: status.slackConnected,
    in_huddle: status.inHuddle,
    muted: status.inHuddle && status.muted,
    huddle_state: status.huddleState,
    sticker_label: status.stickerLabel,
    sticker_action_label: status.stickerActionLabel,
    updated_at: updatedAt,
  };
  const attributes = {
    ...state,
    mute_label: status.muteLabel,
    huddle_title: status.huddleTitle,
    sticker_emoji: status.stickerEmoji,
    sticker_action_emoji: status.stickerActionEmoji,
    sticker_options: status.stickerOptions,
    page_url: status.pageUrl,
    source: status.source,
  };

  publish(client, topics.availability, status.slackConnected ? 'online' : 'offline');
  publish(client, topics.mute, status.inHuddle && status.muted ? 'ON' : 'OFF');
  publish(client, topics.huddle, status.inHuddle ? 'ON' : 'OFF');
  publish(client, topics.sticker, status.stickerLabel ?? noStickerOption);
  publish(client, topics.state, JSON.stringify(state));
  publish(client, topics.attributes, JSON.stringify(attributes));
}

export async function connectSlack(slackCdpUrl: string) {
  return await puppeteer.connect({
    browserURL: slackCdpUrl,
    defaultViewport: null,
  });
}

const nativeScreenSharePatchScript = `(() => {
  const patchKey = '__slackWaylandNativeScreenSharePatch';
  const patchVersion = 8;
  const previousPatch = globalThis[patchKey];
  if (previousPatch?.installed && previousPatch.version === patchVersion) {
    return previousPatch.lastStatus || 'already_installed';
  }
  if (previousPatch?.onClick) {
    document.removeEventListener('click', previousPatch.onClick, true);
  }
  const rspackHost = Array.isArray(globalThis.rspackChunkwebapp)
    ? globalThis
    : window.opener && Array.isArray(window.opener.rspackChunkwebapp)
      ? window.opener
      : null;
  if (!rspackHost) {
    return 'rspack_unavailable';
  }

  let rspackRequire = null;
  rspackHost.rspackChunkwebapp.push([
    ['slack-wayland-native-screen-share-' + Date.now() + '-' + Math.random().toString(36).slice(2)],
    {},
    (runtimeRequire) => {
      rspackRequire = runtimeRequire;
    },
  ]);
  if (!rspackRequire) {
    return 'runtime_unavailable';
  }

  const screenShareDescription = 'Start or stop screen share for current user with given mediaSourceId';
  const knownSelector = [
    'button[data-qa="huddle_screen_share_button"]',
    'button[data-qa="huddle_toolbar_screenshare_button"]',
  ].join(',');
  let startScreenShare = null;
  let stopScreenShare = null;
  let updatePeer = null;
  let clientDispatch = null;
  let store = null;

  const patchState = {
    installed: true,
    version: patchVersion,
    onClick: null,
    sequence: 0,
    lastStatus: 'installed',
  };

  const normalize = (value) => value?.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
  const isScreenShareControl = (control) => {
    if (control.matches(knownSelector)) {
      return true;
    }

    const labels = [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.textContent,
    ].map(normalize);
    return labels.some((label) =>
      label === 'share screen' ||
      label === 'share your screen' ||
      label === 'start sharing your screen' ||
      label === 'stop sharing' ||
      label === 'stop sharing screen' ||
      label === 'stop sharing your screen'
    );
  };

  const resolveSlackInternals = () => {
    if (startScreenShare && stopScreenShare && updatePeer && clientDispatch && store) {
      return true;
    }

    // Requiring the toggle thunk loads the lower-level actions we need. The
    // thunk itself cannot be used because Slack's desktop environment state
    // sometimes reports isWayland as undefined and enters its custom picker.
    const toggleModuleId = Object.keys(rspackRequire.m).find((moduleId) => {
      const factory = rspackRequire.m[moduleId];
      return typeof factory === 'function' &&
        Function.prototype.toString.call(factory).includes(screenShareDescription);
    });
    if (toggleModuleId) {
      rspackRequire(toggleModuleId);
    }

    const exportedFunctions = Object.values(rspackRequire.c).flatMap((module) => {
      try {
        return module?.exports ? Object.values(module.exports) : [];
      } catch {
        return [];
      }
    }).filter((value) => typeof value === 'function');
    const actionWithDescription = (description) => exportedFunctions.find(
      (value) => value.meta?.description === description,
    );
    const teamStoreModule = Object.values(rspackRequire.c)
      .map((module) => module?.exports)
      .find((exports) =>
        exports &&
        typeof exports.oK === 'function' &&
        typeof exports.$D === 'function'
      );
    const clientStoreModule = Object.values(rspackRequire.c)
      .map((module) => module?.exports)
      .find((exports) =>
        exports &&
        typeof exports.dispatchForClientStore === 'function' &&
        typeof exports.Ry === 'function'
      );
    const teamPath = window.location.pathname.startsWith('/client/')
      ? window.location.pathname
      : rspackHost.location.pathname;
    const teamId = teamPath.split('/')[2];

    startScreenShare = actionWithDescription(
      'Start screen share for current user with given mediaSourceId',
    ) || null;
    stopScreenShare = actionWithDescription('Stop screen share for current user') || null;
    updatePeer = actionWithDescription('Update a peer') || null;
    clientDispatch = clientStoreModule?.dispatchForClientStore ?? null;
    store = teamId ? teamStoreModule?.oK?.(teamId) ?? null : null;
    return Boolean(
      startScreenShare && stopScreenShare && updatePeer && clientDispatch && store?.dispatch,
    );
  };

  const onClick = (event) => {
    const target = event.target;
    const control = target instanceof Element
      ? target.closest('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"]')
      : null;
    if (
      !control ||
      !isScreenShareControl(control) ||
      control.disabled ||
      control.getAttribute('aria-disabled') === 'true'
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const label = normalize(
      control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent,
    );
    patchState.sequence += 1;
    if (!resolveSlackInternals()) {
      patchState.lastStatus = 'intercepted:' + patchState.sequence + ':internals_unavailable:' + label;
      return;
    }

    const stopping = label.startsWith('stop ');
    patchState.lastStatus = 'intercepted:' + patchState.sequence + ':dispatching:' + label;
    Promise.resolve().then(() => {
      if (stopping) {
        clientDispatch(stopScreenShare());
        store.dispatch(updatePeer({
          id: 'self',
          screens: [],
          thumbnailIndex: 0,
          isDrawEnabled: false,
        }));
      } else {
        clientDispatch(startScreenShare());
        store.dispatch(updatePeer({
          id: 'self',
          isScreenshareEnabled: true,
          screens: [],
          thumbnailIndex: 0,
          isDrawEnabled: false,
        }));
      }
    }).then(
      () => {
        patchState.lastStatus = 'intercepted:' + patchState.sequence + ':resolved:' + label;
      },
      (error) => {
        patchState.lastStatus = 'intercepted:' + patchState.sequence + ':failed:' +
          (error?.message || String(error));
        console.error('[huddlewire] native screen-share action failed', error);
      },
    );
  };

  document.addEventListener('click', onClick, true);
  patchState.onClick = onClick;
  globalThis[patchKey] = patchState;
  return 'installed';
})()`;

async function patchNativeScreenShare(browser: Browser) {
  const pages = await browser.pages();
  const slackPages: Array<{ page: Page; diagnosticUrl: string }> = [];
  for (const [pageIndex, page] of pages.entries()) {
    if (page.url().startsWith('https://app.slack.com/client/')) {
      slackPages.push({ page, diagnosticUrl: `${page.url()} [page ${pageIndex}]` });
    } else if (page.url() === 'about:blank') {
      slackPages.push({ page, diagnosticUrl: `about:blank [page ${pageIndex}]` });
    }
  }

  return await Promise.all(
    slackPages.map(async ({ page, diagnosticUrl }) => {
      try {
        return {
          url: diagnosticUrl,
          status: (await page.evaluate(nativeScreenSharePatchScript)) as string,
        };
      } catch (error) {
        return {
          url: diagnosticUrl,
          status: `error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
}

async function readPageStatus(page: Page): Promise<PageStatus> {
  return (await page.evaluate(`(() => {
    const text = (element) => element?.textContent?.replace(/\\s+/g, ' ').trim() || null;
    const muteButton = document.querySelector('button[data-qa="segmented-mute-button-main"]');
    const muteLabel = muteButton?.getAttribute('aria-label') || muteButton?.getAttribute('title') || text(muteButton);
    const stickerButton = document.querySelector('button[class*="stickerButton"][aria-label]');
    const stickerActionLabel =
      stickerButton?.getAttribute('aria-label') || stickerButton?.getAttribute('title') || text(stickerButton);
    const stickerActionEmoji =
      stickerButton?.querySelector('[data-qa="emoji"]')?.getAttribute('data-stringify-emoji') ??
      stickerButton?.querySelector('[data-qa="emoji"]')?.getAttribute('aria-label') ??
      null;
    const stickerContainer = document.querySelector(
      '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
    );
    const stickerLabel = text(stickerContainer);
    const stickerEmoji =
      stickerContainer?.querySelector('[data-qa="emoji"]')?.getAttribute('data-stringify-emoji') ??
      stickerContainer?.querySelector('[data-qa="emoji"]')?.getAttribute('aria-label') ??
      null;
    const normalizedMuteLabel = muteLabel?.toLowerCase() ?? null;
    const toolbar =
      document.querySelector('[data-qa="huddle_toolbar_buttons_center"]') ??
      document.querySelector('[aria-label="Huddles actions"]');
    const toolbarMicIcon = toolbar?.querySelector('[data-qa^="huddle_mic_icon_"]')?.getAttribute('data-qa') ?? null;
    const huddleTitle = text(
      document.querySelector('[data-qa="huddle_window_titlebar_title"]') ??
        document.querySelector('[data-qa="huddle_details_title"]'),
    );

    let muted = null;
    if (normalizedMuteLabel?.includes('unmute')) {
      muted = true;
    } else if (normalizedMuteLabel?.includes('mute')) {
      muted = false;
    } else if (toolbarMicIcon?.includes('_unmute')) {
      muted = true;
    } else if (toolbarMicIcon?.includes('_mute')) {
      muted = false;
    }

    return {
      url: location.href,
      inHuddle: Boolean(
        muteButton ||
          document.querySelector('button[data-qa="huddle_toolbar__leave_button"]') ||
          document.querySelector('[data-qa="huddle_grid_component"]') ||
          document.querySelector('[data-qa="huddle_bottom_bar_content"]'),
      ),
      muted,
      muteLabel,
      huddleTitle,
      stickerLabel,
      stickerEmoji,
      stickerActionLabel,
      stickerActionEmoji,
      hasStickerButton: Boolean(stickerButton),
      hasStickerPicker: Boolean(document.querySelector('button[data-qa="huddle-toolbar-sticker-picker-popover-button"]')),
      hasMuteButton: Boolean(muteButton),
    };
  })()`)) as PageStatus;
}

async function getSlackPages(browser: Browser) {
  return (await browser.pages()).filter(
    (page) => page.url().startsWith('https://app.slack.com/client/') || page.url() === 'about:blank',
  );
}

export async function readSlackStatus(browser: Browser): Promise<SlackStatus> {
  const pages = await getSlackPages(browser);
  if (pages.length === 0) {
    return {
      slackConnected: true,
      inHuddle: false,
      muted: false,
      huddleState: 'not_in_huddle',
      muteLabel: null,
      huddleTitle: null,
      stickerLabel: null,
      stickerEmoji: null,
      stickerActionLabel: null,
      stickerActionEmoji: null,
      stickerOptions: mqttStickerOptions,
      pageUrl: null,
      source: 'slack-cdp',
    };
  }

  const pageStatuses = await Promise.all(pages.map((page) => readPageStatus(page)));
  const best =
    pageStatuses.find((status) => status.hasMuteButton) ??
    pageStatuses.find((status) => status.inHuddle) ??
    pageStatuses[0];

  if (!best || !best.inHuddle) {
    return {
      slackConnected: true,
      inHuddle: false,
      muted: false,
      huddleState: 'not_in_huddle',
      muteLabel: best?.muteLabel ?? null,
      huddleTitle: best?.huddleTitle ?? null,
      stickerLabel: best?.stickerLabel ?? null,
      stickerEmoji: best?.stickerEmoji ?? null,
      stickerActionLabel: best?.stickerActionLabel ?? null,
      stickerActionEmoji: best?.stickerActionEmoji ?? null,
      stickerOptions: mqttStickerOptions,
      pageUrl: best?.url ?? null,
      source: 'slack-cdp',
    };
  }

  return {
    slackConnected: true,
    inHuddle: true,
    muted: best.muted ?? false,
    huddleState: best.muted === null ? 'unknown' : best.muted ? 'muted' : 'unmuted',
    muteLabel: best.muteLabel,
    huddleTitle: best.huddleTitle,
    stickerLabel: best.stickerLabel,
    stickerEmoji: best.stickerEmoji,
    stickerActionLabel: best.stickerActionLabel,
    stickerActionEmoji: best.stickerActionEmoji,
    stickerOptions: mqttStickerOptions,
    pageUrl: best.url,
    source: 'slack-cdp',
  };
}

export async function setSlackMuted(browser: Browser, muted: boolean | 'toggle') {
  const pages = await getSlackPages(browser);
  const pageStatuses = await Promise.all(pages.map(async (page) => ({ page, status: await readPageStatus(page) })));
  const target =
    pageStatuses.find(({ status }) => status.hasMuteButton) ??
    pageStatuses.find(({ status }) => status.inHuddle);

  if (!target?.status.inHuddle) {
    return 'not_in_huddle';
  }
  if (!target.status.hasMuteButton) {
    return 'mute_button_missing';
  }
  if (muted !== 'toggle' && target.status.muted === muted) {
    return 'already_set';
  }

  await target.page.evaluate(`(() => {
    document.querySelector('button[data-qa="segmented-mute-button-main"]')?.click();
  })()`);
  return 'changed';
}

async function setSlackSticker(browser: Browser, sticker: string) {
  const stickerOption =
    sticker.toLowerCase() === noStickerOption.toLowerCase()
      ? noStickerOption
      : stickerOptions.find((option) => option.toLowerCase() === sticker.toLowerCase());
  if (!stickerOption) {
    return 'unknown_sticker';
  }

  const pages = await getSlackPages(browser);
  const pageStatuses = await Promise.all(pages.map(async (page) => ({ page, status: await readPageStatus(page) })));
  const target =
    pageStatuses.find(({ status }) => status.hasStickerPicker) ??
    pageStatuses.find(({ status }) => status.hasStickerButton) ??
    pageStatuses.find(({ status }) => status.inHuddle);

  if (!target?.status.inHuddle) {
    return 'not_in_huddle';
  }
  if (!target.status.hasStickerButton) {
    return 'sticker_button_missing';
  }
  if (stickerOption === noStickerOption) {
    if (!target.status.stickerLabel) {
      return 'already_set';
    }

    await target.page.click('button[class*="stickerButton"][aria-label]');
    try {
      await target.page.waitForFunction(
        `(() => {
          const stickerContainer = document.querySelector(
            '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
          );
          return !stickerContainer?.textContent?.replace(/\\s+/g, ' ').trim();
        })`,
        { timeout: 3000 },
      );
      return 'changed';
    } catch {
      return 'sticker_clear_failed';
    }
  }
  if (target.status.stickerLabel === stickerOption) {
    return 'already_set';
  }
  if (target.status.stickerActionLabel === stickerOption) {
    await target.page.click('button[class*="stickerButton"][aria-label]');
    try {
      await target.page.waitForFunction(
        (stickerOption: string) => {
          const stickerContainer = document.querySelector(
            '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
          );
          return stickerContainer?.textContent?.replace(/\s+/g, ' ').trim() === stickerOption;
        },
        { timeout: 3000 },
        stickerOption,
      );
      return 'changed';
    } catch {
      return 'sticker_option_failed';
    }
  }
  if (!target.status.hasStickerPicker) {
    return 'sticker_picker_missing';
  }

  const pickerOpen = await target.page.evaluate(`Boolean(document.querySelector('[data-qa="huddle-sticker-grid"]'))`);
  if (!pickerOpen) {
    await target.page.click('button[data-qa="huddle-toolbar-sticker-picker-popover-button"]');
  }
  try {
    await target.page.waitForFunction(
      (stickerOption: string) => [...document.querySelectorAll('[data-qa="huddle-sticker-grid"] button')]
        .some((button) => button.textContent?.replace(/\s+/g, ' ').trim() === stickerOption),
      { timeout: 2000 },
      stickerOption,
    );
  } catch {
    return 'sticker_option_missing';
  }

  const stickerButtonRect = await target.page.evaluate(
    (stickerOption: string) => {
      const stickerButton = [...document.querySelectorAll('[data-qa="huddle-sticker-grid"] button')]
        .find((button) => button.textContent?.replace(/\s+/g, ' ').trim() === stickerOption);
      if (!stickerButton) {
        return null;
      }

      const rect = stickerButton.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    stickerOption,
  );
  if (
    !stickerButtonRect ||
    typeof stickerButtonRect !== 'object' ||
    !('x' in stickerButtonRect) ||
    !('y' in stickerButtonRect) ||
    !('width' in stickerButtonRect) ||
    !('height' in stickerButtonRect) ||
    typeof stickerButtonRect.x !== 'number' ||
    typeof stickerButtonRect.y !== 'number' ||
    typeof stickerButtonRect.width !== 'number' ||
    typeof stickerButtonRect.height !== 'number'
  ) {
    return 'sticker_option_missing';
  }

  await target.page.mouse.click(stickerButtonRect.x + stickerButtonRect.width / 2, stickerButtonRect.y + stickerButtonRect.height / 2);
  try {
    await target.page.waitForFunction(
      (stickerOption: string) => {
        const stickerContainer = document.querySelector(
          '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
        );
        return stickerContainer?.textContent?.replace(/\s+/g, ' ').trim() === stickerOption;
      },
      { timeout: 3000 },
      stickerOption,
    );
    return 'changed';
  } catch {
    return 'sticker_option_failed';
  }
}

function offlineStatus(): SlackStatus {
  return {
    slackConnected: false,
    inHuddle: false,
    muted: false,
    huddleState: 'unknown',
    muteLabel: null,
    huddleTitle: null,
    stickerLabel: null,
    stickerEmoji: null,
    stickerActionLabel: null,
    stickerActionEmoji: null,
    stickerOptions: mqttStickerOptions,
    pageUrl: null,
    source: 'slack-cdp',
  };
}

function stableStatusKey(status: SlackStatus) {
  return JSON.stringify(status);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerGlobalMuteShortcut(toggle: () => Promise<void>) {
  type GlobalAccelInterface = ClientInterface & {
    doRegister(actionId: string[]): Promise<void>;
    getComponent(componentUnique: string): Promise<string>;
    setShortcut(actionId: string[], keys: number[], flags: number): Promise<number[]>;
    unregister(componentUnique: string, shortcutUnique: string): Promise<boolean>;
  };

  const componentUnique = 'huddlewire';
  const shortcutUnique = 'toggleMute';
  const actionId = [componentUnique, shortcutUnique, 'Huddlewire', 'Toggle Slack Huddle mute'];
  const f24 = 0x01000047;
  const setPresent = 0x2;
  const noAutoloading = 0x4;
  const bus = dbus.sessionBus();

  bus.on('error', (error) => {
    console.error('global mute shortcut D-Bus error:', formatError(error));
  });

  try {
    const globalObject = await bus.getProxyObject('org.kde.kglobalaccel', '/kglobalaccel');
    const globalAccel = globalObject.getInterface<GlobalAccelInterface>('org.kde.KGlobalAccel');

    const removedLegacyShortcut = await globalAccel.unregister('huddlewire-toggle-mute.desktop', '_launch');
    if (removedLegacyShortcut) {
      console.log('removed legacy desktop-launcher mute shortcut');
    }

    await globalAccel.doRegister(actionId);
    const assignedKeys = await globalAccel.setShortcut(actionId, [f24], setPresent | noAutoloading);
    if (!assignedKeys.includes(f24)) {
      throw new Error(`KGlobalAccel did not assign F24 (assigned: ${assignedKeys.join(', ') || 'none'})`);
    }

    const componentPath = await globalAccel.getComponent(componentUnique);
    const componentObject = await bus.getProxyObject('org.kde.kglobalaccel', componentPath);
    const component = componentObject.getInterface('org.kde.kglobalaccel.Component');
    let pendingToggle = Promise.resolve();

    component.on('globalShortcutPressed', (pressedComponent: string, pressedShortcut: string) => {
      if (pressedComponent !== componentUnique || pressedShortcut !== shortcutUnique) {
        return;
      }

      pendingToggle = pendingToggle.then(toggle, toggle).catch((error) => {
        console.error('global mute shortcut action failed:', formatError(error));
      });
    });

    console.log('global mute shortcut registered: F24');
    return bus;
  } catch (error) {
    bus.disconnect();
    throw error;
  }
}

export async function runDaemon() {
  const config = readConfig();
  const topics = createTopics(config);
  const client = createMqttClient(config, topics);
  let lastStatusKey: string | null = null;
  const screenSharePatchStatuses = new Map<string, string>();
  let browser: Browser | null = null;

  async function getBrowser() {
    if (!browser) {
      browser = await connectSlack(config.slackCdpUrl);
      browser.once('disconnected', () => {
        browser = null;
      });
    }

    return browser;
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
      const muted = command === 'ON' ? true : command === 'OFF' ? false : null;
      if (muted === null) {
        console.error(`unknown mute command: ${command}`);
        return;
      }

      void (async () => {
        const action = await setSlackMuted(await getBrowser(), muted);
        console.log(`slack huddle mute action: ${action}`);
      })().catch((error) => {
        console.error('slack huddle mute action failed:', error instanceof Error ? error.message : String(error));
      });
    }
    if (topic === topics.stickerSet) {
      const sticker = payload.toString();

      void (async () => {
        const action = await setSlackSticker(await getBrowser(), sticker);
        console.log(`slack huddle sticker action: ${action}`);
      })().catch((error) => {
        console.error('slack huddle sticker action failed:', error instanceof Error ? error.message : String(error));
      });
    }
  });
  client.on('error', (error) => {
    console.error('mqtt error:', formatError(error));
  });

  while (true) {
    try {
      const slackBrowser = await getBrowser();
      if (config.patchNativeScreenShare) {
        const patchResults = await patchNativeScreenShare(slackBrowser);
        for (const result of patchResults) {
          if (screenSharePatchStatuses.get(result.url) !== result.status) {
            screenSharePatchStatuses.set(result.url, result.status);
            console.log(`slack native screen-share patch: ${result.status} (${result.url})`);
          }
        }
      }

      const status = await readSlackStatus(slackBrowser);
      const key = stableStatusKey(status);
      if (key !== lastStatusKey) {
        publishSlackStatus(client, topics, status);
        lastStatusKey = key;
        console.log(`slack huddle state: ${status.huddleState}`);
      }
    } catch (error) {
      const failedBrowser = browser as Browser | null;
      await failedBrowser?.disconnect().catch(() => undefined);
      browser = null;

      const status = offlineStatus();
      const key = stableStatusKey(status);
      if (key !== lastStatusKey) {
        publishSlackStatus(client, topics, status);
        lastStatusKey = key;
      }
      console.error('slack cdp read failed:', error instanceof Error ? error.message : String(error));
    }

    await sleep(config.pollIntervalMs);
  }
}
