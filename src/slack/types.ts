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

const stickerOptions = ['Raise hand', 'Be right back', 'Yes', 'No', 'Done'] as const;
const noStickerOption = 'None';
const mqttStickerOptions = [noStickerOption, ...stickerOptions] as const;

export { mqttStickerOptions, noStickerOption, type PageStatus, type SlackStatus, stickerOptions };
