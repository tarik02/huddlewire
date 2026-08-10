import * as dbus from 'dbus-next';
import type { ClientInterface } from 'dbus-next';

import formatError from './errors.ts';

type GlobalAccelInterface = ClientInterface & {
  doRegister(actionId: string[]): Promise<void>;
  getComponent(componentUnique: string): Promise<string>;
  setShortcut(actionId: string[], keys: number[], flags: number): Promise<number[]>;
  unregister(componentUnique: string, shortcutUnique: string): Promise<boolean>;
};

export default async function registerGlobalMuteShortcut(toggle: () => Promise<void>) {
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

    const removedLegacyShortcut = await globalAccel.unregister(
      'huddlewire-toggle-mute.desktop',
      '_launch',
    );
    if (removedLegacyShortcut) {
      console.log('removed legacy desktop-launcher mute shortcut');
    }

    await globalAccel.doRegister(actionId);
    const assignedKeys = await globalAccel.setShortcut(actionId, [f24], setPresent | noAutoloading);
    if (!assignedKeys.includes(f24)) {
      throw new Error(
        `KGlobalAccel did not assign F24 (assigned: ${assignedKeys.join(', ') || 'none'})`,
      );
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
