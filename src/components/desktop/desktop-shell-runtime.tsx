'use client';

import { useEffect } from 'react';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createDesktopFolder,
  createDesktopShortcut,
  getLocalWorkerStatus,
  isAutostartEnabled,
  openDesktopRoot,
  openProjectRoot,
  setAutostartEnabled,
  startLocalWorker,
  stopLocalWorker,
} from '@/lib/desktop/native';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function DesktopShellRuntime() {
  useEffect(() => {
    if (!inTauri()) return;

    let tray: TrayIcon | null = null;
    let unlistenClose: (() => void) | undefined;
    const win = getCurrentWindow();

    const showWindow = async () => {
      await win.show();
      await win.setFocus();
    };

    const hideWindow = async () => {
      await win.hide();
    };

    const toggleWindow = async () => {
      if (await win.isVisible()) {
        await hideWindow();
        return;
      }
      await showWindow();
    };

    void (async () => {
      try {
        const icon = await defaultWindowIcon();
        const menu = await Menu.new({
          items: [
            {
              id: 'toggle-window',
              text: 'Show / Hide Dashboard',
              action: () => {
                void toggleWindow().catch((error) => console.error('Failed to toggle the dashboard window', error));
              },
            },
            { item: 'Separator' },
            {
              id: 'open-project-root',
              text: 'Open Project Root',
              action: () => {
                void openProjectRoot().catch((error) => console.error('Failed to open the project root', error));
              },
            },
            {
              id: 'open-desktop-root',
              text: 'Open Desktop Folder',
              action: () => {
                void openDesktopRoot().catch((error) => console.error('Failed to open the desktop folder', error));
              },
            },
            {
              id: 'create-desktop-folder',
              text: 'Create Desktop Folder',
              action: () => {
                const folderName = window.prompt('Create a Desktop folder for this session', 'My Agent Factory');
                if (!folderName) return;
                void createDesktopFolder(folderName)
                  .then((folderPath) => window.alert(`Created Desktop folder:\n${folderPath}`))
                  .catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    window.alert(`Desktop action failed:\n${message}`);
                  });
              },
            },
            {
              id: 'create-desktop-shortcut',
              text: 'Install Desktop Shortcut',
              action: () => {
                void createDesktopShortcut()
                  .then((shortcutPath) => window.alert(`Desktop shortcut installed:\n${shortcutPath}`))
                  .catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    window.alert(`Desktop shortcut failed:\n${message}`);
                  });
              },
            },
            { item: 'Separator' },
            {
              id: 'toggle-worker',
              text: 'Start / Stop Local Worker',
              action: () => {
                void (async () => {
                  const workerPid = await getLocalWorkerStatus();
                  if (workerPid !== null) {
                    await stopLocalWorker();
                    return;
                  }
                  await startLocalWorker();
                })().catch((error) => console.error('Failed to toggle the local worker', error));
              },
            },
            {
              id: 'toggle-autostart',
              text: 'Toggle Autostart',
              action: () => {
                void (async () => {
                  const enabled = await isAutostartEnabled();
                  await setAutostartEnabled(!enabled);
                })().catch((error) => console.error('Failed to toggle autostart', error));
              },
            },
            { item: 'Separator' },
            {
              id: 'quit-app',
              text: 'Quit App',
              action: () => {
                void win.destroy().catch((error) => console.error('Failed to quit the desktop app', error));
              },
            },
          ],
        });

        tray = await TrayIcon.new({
          icon: icon ?? undefined,
          tooltip: 'Nova • My Agent Factory',
          menu,
          menuOnLeftClick: false,
          action: (event) => {
            if (event.type !== 'Click' || event.button !== 'Left' || event.buttonState !== 'Up') return;
            void toggleWindow().catch((error) => console.error('Failed to toggle the dashboard window', error));
          },
        });

        unlistenClose = await win.onCloseRequested((event) => {
          event.preventDefault();
          void hideWindow().catch((error) => console.error('Failed to hide the dashboard window', error));
        });
      } catch (error) {
        console.error('Failed to initialize the desktop tray runtime', error);
      }
    })();

    return () => {
      unlistenClose?.();
      void tray?.close();
      tray = null;
    };
  }, []);

  return null;
}

export default DesktopShellRuntime;
