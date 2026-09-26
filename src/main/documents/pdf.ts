import { BrowserWindow } from 'electron';
import { PaperSize, PAPER_DIMENSIONS, PAGE_MARGINS_MM } from './templates';

/**
 * PDF generation via Electron's print engine against the exact document HTML
 * used by the on-screen preview — one representation, two outputs.
 *
 * Geometry contract (spec: Document Design System — "preview and final PDF
 * match"): the document CSS sets `@page` size and margins; the sheet renders
 * identical padding on screen. For PDF export, the template zeroes the sheet
 * padding in print media and the engine reproduces the same margins on every
 * page (fixes the old zero-margin continuation-page clipping). Multi-page
 * documents get a discreet footer with the document number and page x of y;
 * 80mm roll receipts are single-strip and get none.
 */
const MM_TO_PX = 96 / 25.4;

function marginsPx(size: PaperSize) {
  const m = PAGE_MARGINS_MM[size];
  return {
    marginType: 'custom' as const,
    top: Math.round(m.top * MM_TO_PX),
    bottom: Math.round(m.bottom * MM_TO_PX),
    left: Math.round(m.left * MM_TO_PX),
    right: Math.round(m.right * MM_TO_PX)
  };
}

function footerTemplate(docLabel: string): string {
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#6b7885;width:100%;text-align:center;padding-bottom:2mm;">${docLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} &nbsp;·&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
}

function hiddenWindow(dims: { width: number; height: number }): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: Math.round(dims.width * 3.78),
    height: Math.round(dims.height * 3.78),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
}

export async function htmlToPdf(html: string, size: PaperSize, docLabel?: string): Promise<Buffer> {
  const dims = PAPER_DIMENSIONS[size];
  const win = hiddenWindow(dims);
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const paginate = !!docLabel && size !== '80mm';
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: size === '80mm' ? { width: 80000, height: 297000 } : size,
      margins: marginsPx(size),
      preferCSSPageSize: true,
      ...(paginate
        ? { displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: footerTemplate(docLabel) }
        : {})
    } as Electron.PrintToPDFOptions);
    return Buffer.from(pdf);
  } finally {
    win.destroy();
  }
}

/** Renderer-side print for the system print dialog. */
export async function printHtml(html: string, size: PaperSize): Promise<{ printed: boolean; reason?: string }> {
  const dims = PAPER_DIMENSIONS[size];
  const win = hiddenWindow(dims);
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise((resolve) => {
      win.webContents.print(
        { printBackground: true, pageSize: (size === '80mm' ? { width: 80000, height: 297000 } : size) as Electron.Size, margins: marginsPx(size) },
        (success, failureReason) => {
          resolve({ printed: success, reason: failureReason || undefined });
        }
      );
    });
  } finally {
    win.destroy();
  }
}
