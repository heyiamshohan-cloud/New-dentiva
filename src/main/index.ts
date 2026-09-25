import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { AppContext } from './context';
import { registerIpc } from './ipc';

/**
 * Dentiva Pro main process. Offline-first: no remote calls, no telemetry,
 * single-instance, hardened BrowserWindow (sandboxed renderer, context
 * isolation, no Node integration, navigation and window-open blocked).
 */
const isDev = !!process.env.ELECTRON_RENDERER_URL;
let ctx: AppContext | null = null;
let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    const dataDir = path.join(app.getPath('userData'));
    ctx = new AppContext(dataDir, app.getVersion());

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1180,
      minHeight: 700,
      show: false,
      title: 'Dentiva Pro',
      backgroundColor: '#f4f6f8',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        webSecurity: true
      }
    });

    registerIpc(ctx, () => mainWindow);

    // Block in-app navigation and external window opening (privacy: nothing
    // leaves the machine; links open in the user's default browser).
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return;
      event.preventDefault();
    });

    mainWindow.once('ready-to-show', () => mainWindow?.show());

    if (isDev) {
      await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
    } else {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    // Refresh rule-based notifications on start (real data only).
    try {
      ctx.services.notifications.refresh();
    } catch (e) {
      console.error('[dentiva] notification refresh failed', e);
    }
  });

  app.on('window-all-closed', () => {
    void onShutdown().finally(() => app.quit());
  });

  app.on('before-quit', () => {
    void onShutdown();
  });
}

let shuttingDown = false;
async function onShutdown(): Promise<void> {
  if (shuttingDown || !ctx) return;
  shuttingDown = true;
  try {
    const settings = ctx.services.settings;
    if (settings.get('autoBackupOnExit')) {
      const actor = ctx.session.current();
      await ctx.backup.createBackup(actor?.username ?? 'system', settings.get('backupDirectory') || undefined);
    }
  } catch (e) {
    console.error('[dentiva] shutdown backup failed', e);
    try {
      fs.appendFileSync(path.join(ctx.dataDir, 'shutdown-errors.log'), `${new Date().toISOString()} shutdown backup failed: ${(e as Error).message}\n`);
    } catch {
      // nothing further sensible to do at shutdown time
    }
  } finally {
    ctx.close();
  }
}
