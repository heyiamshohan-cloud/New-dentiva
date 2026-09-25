import { BrowserWindow } from 'electron';
import { PaperSize, PAPER_DIMENSIONS } from './templates';

/**
 * PDF generation via Electron's print engine against the exact document HTML
 * used by the on-screen preview — one representation, two outputs.
 */
export async function htmlToPdf(html: string, size: PaperSize): Promise<Buffer> {
  const dims = PAPER_DIMENSIONS[size];
  const win = new BrowserWindow({
    show: false,
    width: Math.round(dims.width * 3.78),
    height: Math.round(dims.height * 3.78),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: size === '80mm' ? { width: 80000, height: 297000 } : size,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true
    } as Electron.PrintToPDFOptions);
    return Buffer.from(pdf);
  } finally {
    win.destroy();
  }
}

/** Renderer-side print for the system print dialog. */
export async function printHtml(html: string, size: PaperSize): Promise<{ printed: boolean; reason?: string }> {
  const dims = PAPER_DIMENSIONS[size];
  const win = new BrowserWindow({
    show: false,
    width: Math.round(dims.width * 3.78),
    height: Math.round(dims.height * 3.78),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise((resolve) => {
      win.webContents.print(
      { printBackground: true, pageSize: (size === '80mm' ? { width: 80000, height: 297000 } : size) as Electron.Size, margins: { marginType: 'none' } },
      (success, failureReason) => {
        resolve({ printed: success, reason: failureReason || undefined });
      });
    });
  } finally {
    win.destroy();
  }
}
