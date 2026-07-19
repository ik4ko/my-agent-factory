import { invoke, isTauri } from '@tauri-apps/api/core';

export async function createDesktopFolder(folderName: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('Desktop actions are only available in the native desktop app.');
  }

  const cleaned = folderName.trim();
  if (!cleaned) {
    throw new Error('Folder name cannot be empty.');
  }

  return invoke<string>('create_desktop_folder', { folderName: cleaned });
}

export async function createDesktopShortcut(): Promise<string> {
  if (!isTauri()) {
    throw new Error('Desktop actions are only available in the native desktop app.');
  }
  return invoke<string>('create_desktop_shortcut');
}

export async function openProjectRoot(): Promise<string> {
  if (!isTauri()) {
    throw new Error('Desktop actions are only available in the native desktop app.');
  }
  return invoke<string>('open_project_root');
}

export async function openDesktopRoot(): Promise<string> {
  if (!isTauri()) {
    throw new Error('Desktop actions are only available in the native desktop app.');
  }
  return invoke<string>('open_desktop_root');
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('is_autostart_enabled');
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauri()) {
    throw new Error('Autostart controls are only available in the native desktop app.');
  }
  return invoke<boolean>('set_autostart_enabled', { enabled });
}

export async function startLocalWorker(): Promise<number> {
  if (!isTauri()) {
    throw new Error('Local worker controls are only available in the native desktop app.');
  }
  return invoke<number>('start_local_worker');
}

export async function stopLocalWorker(): Promise<void> {
  if (!isTauri()) {
    throw new Error('Local worker controls are only available in the native desktop app.');
  }
  await invoke('stop_local_worker');
}

export async function getLocalWorkerStatus(): Promise<number | null> {
  if (!isTauri()) return null;
  return invoke<number | null>('local_worker_status');
}
