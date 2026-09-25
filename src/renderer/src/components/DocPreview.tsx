import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, Dialog, Select, toast } from './ui';
import { IconPdf, IconPrint } from '../icons';

export type DocKind = 'prescription' | 'invoice' | 'receipt' | 'statement';

const CHANNELS: Record<DocKind, string> = {
  prescription: 'documents.prescriptionHtml',
  invoice: 'documents.invoiceHtml',
  receipt: 'documents.receiptHtml',
  statement: 'documents.statementHtml'
};

const DEFAULT_SIZE: Record<DocKind, string> = {
  prescription: 'A4',
  invoice: 'A4',
  receipt: '80mm',
  statement: 'A4'
};

/**
 * Document preview — the HTML shown here is exactly what the PDF generator
 * and printer receive (one representation, verified by tests).
 */
export function DocPreviewDialog(props: {
  title: string;
  kind: DocKind;
  payload: Record<string, unknown>;
  onClose: () => void;
}) {
  const [size, setSize] = useState(DEFAULT_SIZE[props.kind]);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);

  const [iframeDims, setIframeDims] = useState({ w: 794, h: 1123 });
  useEffect(() => {
    const dims: Record<string, { w: number; h: number }> = {
      A4: { w: 794, h: 1123 }, A5: { w: 559, h: 794 }, Letter: { w: 816, h: 1056 }, '80mm': { w: 302, h: 1000 }
    };
    setIframeDims(dims[size] ?? dims.A4);
  }, [size]);

  useEffect(() => {
    setError('');
    api<string>(CHANNELS[props.kind], { ...props.payload, size })
      .then(setHtml)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not build the document.'));
  }, [props.kind, size, JSON.stringify(props.payload)]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePdf = async () => {
    setBusy('pdf');
    try {
      const picked = await api<{ path: string | null }>('dialog.saveFile', {
        defaultName: `${props.title.replace(/\s+/g, '-')}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      });
      if (!picked.path) { setBusy(null); return; }
      const res = await api<{ path: string; bytes: number }>('documents.pdf', { html, size, path: picked.path });
      toast.success(`PDF saved (${Math.round(res.bytes / 1024)} KB) to ${res.path}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF export failed.');
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    setBusy('print');
    try {
      await api('documents.printDoc', { html, size });
      toast.success('Sent to the printer.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Printing failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={props.title} size="xl" onClose={props.onClose} footer={
      <>
        <Select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: 120, marginRight: 'auto' }}>
          <option value="A4">A4</option>
          <option value="A5">A5</option>
          <option value="Letter">Letter</option>
          <option value="80mm">80mm</option>
        </Select>
        <Button onClick={props.onClose}>Close</Button>
        <Button icon={<IconPrint size={15} />} loading={busy === 'print'} onClick={() => void print()}>Print</Button>
        <Button variant="primary" icon={<IconPdf size={15} />} loading={busy === 'pdf'} onClick={() => void savePdf()}>Export PDF</Button>
      </>
    }>
      {error && <div className="dlg-error">{error}</div>}
      <div className="doc-preview" style={{ overflowX: 'auto' }}>
        {html ? (
          <iframe title="Document preview" srcDoc={html} style={{ width: iframeDims.w, height: Math.min(iframeDims.h, 980) }} sandbox="" />
        ) : (
          !error && <div className="skeleton" style={{ width: iframeDims.w, height: 600 }} />
        )}
      </div>
    </Dialog>
  );
}
