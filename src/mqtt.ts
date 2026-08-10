import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

import { appName, appVersion, type Config } from './config.ts';
import formatError from './errors.ts';
import { mqttStickerOptions, noStickerOption, type SlackStatus } from './slack/types.ts';

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

function createTopics(config: Config): Topics {
  return {
    attributes: `${config.mqttBaseTopic}/attributes`,
    availability: `${config.mqttBaseTopic}/availability`,
    huddle: `${config.mqttBaseTopic}/huddle`,
    mute: `${config.mqttBaseTopic}/mute`,
    muteSet: `${config.mqttBaseTopic}/mute/set`,
    state: `${config.mqttBaseTopic}/state`,
    sticker: `${config.mqttBaseTopic}/sticker`,
    stickerSet: `${config.mqttBaseTopic}/sticker/set`,
  };
}

function createMqttClient(config: Config, topics: Topics): MqttClient {
  const options: IClientOptions = {
    clientId: `${appName}-${process.pid}`,
    reconnectPeriod: 5000,
    will: {
      payload: 'offline',
      retain: true,
      topic: topics.availability,
    },
  };
  if (config.mqttPassword !== undefined && config.mqttPassword !== '') {
    options.password = config.mqttPassword;
  }
  if (config.mqttUsername !== undefined && config.mqttUsername !== '') {
    options.username = config.mqttUsername;
  }
  return mqtt.connect(config.mqttUrl, options);
}

function publish(client: MqttClient, topic: string, payload: string, retain = true) {
  client.publish(topic, payload, { retain }, (error) => {
    if (error !== undefined && error !== null) {
      console.error(`mqtt publish failed for ${topic}:`, formatError(error));
    }
  });
}

function discoveryPayload(config: Config, topics: Topics) {
  const device = {
    identifiers: [config.deviceId],
    manufacturer: 'Slack',
    name: config.deviceName,
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
    inHuddle: {
      device,
      icon: 'mdi:phone-in-talk',
      json_attributes_topic: topics.attributes,
      name: 'In huddle',
      origin,
      payload_off: 'OFF',
      payload_on: 'ON',
      state_topic: topics.huddle,
      unique_id: `${config.deviceId}_in_huddle`,
      ...availability,
    },
    muteSwitch: {
      command_topic: topics.muteSet,
      device,
      icon: 'mdi:microphone-off',
      json_attributes_topic: topics.attributes,
      name: 'Huddle mute',
      optimistic: false,
      origin,
      payload_off: 'OFF',
      payload_on: 'ON',
      retain: false,
      state_off: 'OFF',
      state_on: 'ON',
      state_topic: topics.mute,
      unique_id: `${config.deviceId}_huddle_mute_switch`,
      ...availability,
    },
    muted: {
      device,
      icon: 'mdi:microphone-off',
      json_attributes_topic: topics.attributes,
      name: 'Huddle muted',
      origin,
      payload_off: 'OFF',
      payload_on: 'ON',
      state_topic: topics.mute,
      unique_id: `${config.deviceId}_huddle_muted`,
      ...availability,
    },
    state: {
      device,
      icon: 'mdi:account-voice',
      json_attributes_topic: topics.attributes,
      name: 'Huddle state',
      origin,
      state_topic: topics.state,
      unique_id: `${config.deviceId}_huddle_state`,
      value_template: '{{ value_json.huddle_state }}',
      ...availability,
    },
    stickerSelect: {
      command_topic: topics.stickerSet,
      device,
      icon: 'mdi:sticker-emoji',
      json_attributes_topic: topics.attributes,
      name: 'Huddle sticker',
      optimistic: false,
      options: mqttStickerOptions,
      origin,
      retain: false,
      state_topic: topics.sticker,
      unique_id: `${config.deviceId}_huddle_sticker`,
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

function onOff(value: boolean) {
  if (value) {
    return 'ON';
  }
  return 'OFF';
}

function publishSlackStatus(client: MqttClient, topics: Topics, status: SlackStatus) {
  const updatedAt = new Date().toISOString();
  let availability = 'offline';
  if (status.slackConnected) {
    availability = 'online';
  }
  const state = {
    huddle_state: status.huddleState,
    in_huddle: status.inHuddle,
    muted: status.inHuddle && status.muted,
    slack_connected: status.slackConnected,
    sticker_action_label: status.stickerActionLabel,
    sticker_label: status.stickerLabel,
    updated_at: updatedAt,
  };
  const attributes = {
    ...state,
    huddle_title: status.huddleTitle,
    mute_label: status.muteLabel,
    page_url: status.pageUrl,
    source: status.source,
    sticker_action_emoji: status.stickerActionEmoji,
    sticker_emoji: status.stickerEmoji,
    sticker_options: status.stickerOptions,
  };

  publish(client, topics.attributes, JSON.stringify(attributes));
  publish(client, topics.availability, availability);
  publish(client, topics.huddle, onOff(status.inHuddle));
  publish(client, topics.mute, onOff(status.inHuddle && status.muted));
  publish(client, topics.state, JSON.stringify(state));
  publish(client, topics.sticker, status.stickerLabel ?? noStickerOption);
}

export { createMqttClient, createTopics, publishDiscovery, publishSlackStatus, type Topics };
