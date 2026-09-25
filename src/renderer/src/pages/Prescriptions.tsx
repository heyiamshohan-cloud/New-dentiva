import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useSession } from '../session';
import { Button, DataTable, Empty, Input, toast } from '../components/ui';
import { DocPreviewDialog } from '../components/DocPreview';
import { PatientPicker } from '../components/PatientPicker';
import { RxBuilderDialog } from '../components/RxBuilderDialog';
import { IconRx, IconPlus, IconPrint } from '../icons';
import type { Page, PatientSummary } from '@shared/types';

interface RxRow { id: number; number: string; prescribedAt: string; dentistName: string; patientId: number; patientName: string; patientCode: string; cc: string[]; items: Array<{ medicineName: string }> }

export function PrescriptionsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const patientId = patient?.id ?? 0;
  const [search, setSearch] = useState('');
  const [data, setData] = useState<Page<RxRow> | null>(null);
  const [dentists, setDentists] = useState<Array<{ id: number; name: string }>>([]);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<Page<RxRow>>('prescriptions.list', { patientId: patientId || undefined, search: search || undefined, page, pageSize: 25 }));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load prescriptions.'); }
  }, [patientId, search, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api<Array<{ id: number; name: string }>>('dentists.list').then(setDentists).catch(() => setDentists([]));
  }, []);

  useEffect(() => {
    const pid = Number(params.get('patient')) || 0;
    if (pid) {
      api<PatientSummary>('patients.get', { id: pid }).then((p) => setPatient(p)).catch(() => setPatient(null));
    }
    if (params.get('new') === '1') setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-head">
        <div><h1>Prescriptions</h1><div className="sub">Clinical documents only — no amounts ever appear on a prescription.</div></div>
        <div style={{ width: 240 }}><PatientPicker value={patient} onChange={(v) => { setPatient(v); setPage(1); }} /></div>
        <Input placeholder="Search number / medicine…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 200 }} />
        {can('prescriptions.create') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>New prescription</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 300 }} />}
      {data && (
        <>
          <DataTable rows={data.rows} rowKey={(r) => r.id}
            onRowClick={(r) => setPreview(r.id)}
            columns={[
              { key: 'number', label: 'Rx No', render: (r) => <span className="tabular primary-cell">{r.number}</span> },
              { key: 'prescribedAt', label: 'Date', render: (r) => fmtDate(r.prescribedAt) },
              { key: 'patientName', label: 'Patient', render: (r) => <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.patientId}`); }}>{r.patientName} <span className="muted tabular">{r.patientCode}</span></button> },
              { key: 'dentistName', label: 'Dentist', render: (r) => r.dentistName || '—' },
              { key: 'cc', label: 'C/C', render: (r) => r.cc.slice(0, 3).join(', ') || '—' },
              { key: 'items', label: 'Medicines', render: (r) => <span className="muted">{r.items.map((i) => i.medicineName).slice(0, 3).join(', ')}{r.items.length > 3 ? ` +${r.items.length - 3}` : ''}</span> },
              { key: 'act', label: '', render: (r) => <Button size="sm" icon={<IconPrint size={13} />} onClick={(e) => { e.stopPropagation(); setPreview(r.id); }}>Preview</Button> }
            ]}
            empty={<Empty icon={<IconRx size={34} />} title="No prescriptions found" hint="Write the first prescription with the structured builder — C/C, O/E, R/E, advice and medicines." />} />
          <div className="table-foot">
            <span className="tabular">{data.total} prescriptions</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="muted tabular" style={{ alignSelf: 'center' }}>Page {page}</span>
              <Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}

      {creating && (
        <RxBuilderDialog patientId={patientId || undefined} dentists={dentists}
          onClose={() => setCreating(false)}
          onSaved={(rxId) => { setCreating(false); setPreview(rxId); void load(); }} />
      )}
      {preview != null && <DocPreviewDialog title="Prescription" kind="prescription" payload={{ id: preview }} onClose={() => setPreview(null)} />}
    </div>
  );
}
