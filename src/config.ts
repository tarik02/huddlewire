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
  soundPlayer: string | undefined;
};

function readConfig(): Config {
  const mqttUrl = process.env['MQTT_URL'];
  if (mqttUrl === undefined || mqttUrl === '') {
    throw new Error('MQTT_URL is required');
  }

  const pollIntervalMs = Number(process.env['POLL_INTERVAL_MS'] ?? 1000);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 250) {
    throw new Error('POLL_INTERVAL_MS must be at least 250');
  }

  return {
    deviceId: process.env['HA_DEVICE_ID'] ?? 'huddlewire',
    deviceName: process.env['HA_DEVICE_NAME'] ?? 'Slack huddle',
    haDiscoveryPrefix: process.env['HA_DISCOVERY_PREFIX'] ?? 'homeassistant',
    mqttBaseTopic: process.env['MQTT_BASE_TOPIC'] ?? appName,
    mqttPassword: process.env['MQTT_PASSWORD'],
    mqttUrl,
    mqttUsername: process.env['MQTT_USERNAME'],
    patchNativeScreenShare: process.env['PATCH_NATIVE_SCREEN_SHARE'] !== 'false',
    pollIntervalMs,
    slackCdpUrl: process.env['SLACK_CDP_URL'] ?? 'http://127.0.0.1:9224',
    soundPlayer: process.env['HUDDLEWIRE_SOUND_PLAYER'],
  };
}

export { appName, appVersion, type Config, readConfig };
