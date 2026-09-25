import React, { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { LogoMark } from '../icons';
import { Button, Field, Input, Select } from '../components/ui';

/**
 * First-launch setup wizard. Requires no technical knowledge and inserts no
 * demo data — the clinic starts empty after this.
 */
export function SetupWizard() {
  const { refreshStatus } = useSession();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [clinic, setClinic] = useState({ name: '', legalName: '', address: '', phone: '', email: '', website: '', registrationNo: '', timezone: 'Asia/Dhaka', currencyCode: 'BDT', currencySymbol: '৳' });
  const [admin, setAdmin] = useState({ username: '', displayName: '', password: '', confirm: '' });
  const [dentist, setDentist] = useState({ name: '', credentials: '' });

  const steps = ['Welcome', 'Clinic', 'Administrator', 'Dentist', 'Finish'];

  const next = () => {
    setError('');
    if (step === 1 && !clinic.name.trim()) return setError('Clinic name is required.');
    if (step === 2) {
      if (!admin.username.trim() || !admin.displayName.trim()) return setError('Administrator username and display name are required.');
      if (admin.password !== admin.confirm) return setError('Passwords do not match.');
      if (admin.password.length < 8) return setError('Password must be at least 8 characters.');
    }
    setStep(step + 1);
  };

  const finish = async () => {
    setLoading(true);
    setError('');
    try {
      await api('setup.complete', {
        clinic,
        admin: { username: admin.username.trim(), displayName: admin.displayName.trim(), password: admin.password },
        dentistName: dentist.name.trim() || undefined,
        dentistCredentials: dentist.credentials.trim()
      });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="auth-card wide">
        <div className="auth-brand" style={{ marginBottom: 12 }}>
          <LogoMark size={44} />
          <h1 style={{ fontSize: 20 }}>Welcome to Dentiva Pro</h1>
        </div>
        <div className="wizard-steps">
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <span className="line" />}
              <span className={`step${i === step ? ' active' : ''}`}><span className="n">{i + 1}</span>{s}</span>
            </React.Fragment>
          ))}
        </div>
        {error && <div className="dlg-error" role="alert">{error}</div>}

        {step === 0 && (
          <div style={{ textAlign: 'center', padding: '8px 24px 4px', color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>
            <p>Set up your clinic in under two minutes. You will configure the clinic identity, create the administrator account and (optionally) add the first dentist.</p>
            <p style={{ marginTop: 10 }}>Everything runs offline on this computer. You can change all of this later in Settings.</p>
          </div>
        )}

        {step === 1 && (
          <div className="form-grid">
            <Field label="Clinic name" required width={6}><Input value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })} autoFocus /></Field>
            <Field label="Legal / business name" width={6}><Input value={clinic.legalName} onChange={(e) => setClinic({ ...clinic, legalName: e.target.value })} /></Field>
            <Field label="Address" width={12}><Input value={clinic.address} onChange={(e) => setClinic({ ...clinic, address: e.target.value })} /></Field>
            <Field label="Phone" width={4}><Input value={clinic.phone} onChange={(e) => setClinic({ ...clinic, phone: e.target.value })} /></Field>
            <Field label="Email" width={4}><Input value={clinic.email} onChange={(e) => setClinic({ ...clinic, email: e.target.value })} /></Field>
            <Field label="Website" width={4}><Input value={clinic.website} onChange={(e) => setClinic({ ...clinic, website: e.target.value })} /></Field>
            <Field label="Registration no." width={4}><Input value={clinic.registrationNo} onChange={(e) => setClinic({ ...clinic, registrationNo: e.target.value })} /></Field>
            <Field label="Timezone" width={4}>
              <Select value={clinic.timezone} onChange={(e) => setClinic({ ...clinic, timezone: e.target.value })}>
                <option value="Asia/Dhaka">Asia/Dhaka (UTC+6)</option>
                <option value="UTC">UTC</option>
              </Select>
            </Field>
            <Field label="Currency" width={4}>
              <Select value={clinic.currencyCode} onChange={(e) => setClinic({ ...clinic, currencyCode: e.target.value, currencySymbol: e.target.value === 'BDT' ? '৳' : e.target.value + ' ' })}>
                <option value="BDT">BDT — ৳</option>
                <option value="USD">USD — $</option>
                <option value="EUR">EUR — €</option>
                <option value="INR">INR — ₹</option>
              </Select>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="form-grid">
            <Field label="Username" required width={4}><Input value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} autoComplete="off" autoFocus /></Field>
            <Field label="Display name" required width={8}><Input value={admin.displayName} onChange={(e) => setAdmin({ ...admin, displayName: e.target.value })} /></Field>
            <Field label="Password" required width={6} helper="At least 8 characters with letters and numbers."><Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} autoComplete="new-password" /></Field>
            <Field label="Confirm password" required width={6}><Input type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} autoComplete="new-password" /></Field>
          </div>
        )}

        {step === 3 && (
          <div className="form-grid">
            <Field label="Dentist name" width={6} helper="Optional — you can add dentists later."><Input value={dentist.name} onChange={(e) => setDentist({ ...dentist, name: e.target.value })} /></Field>
            <Field label="Credentials" width={6} helper="e.g. BDS, DDS"><Input value={dentist.credentials} onChange={(e) => setDentist({ ...dentist, credentials: e.target.value })} /></Field>
          </div>
        )}

        {step === 4 && (
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)' }}>
            <fieldset>
              <legend>Review</legend>
              <dl className="kv-list">
                <dt>Clinic</dt><dd>{clinic.name || '—'}</dd>
                <dt>Phone</dt><dd>{clinic.phone || '—'}</dd>
                <dt>Timezone</dt><dd>{clinic.timezone}</dd>
                <dt>Currency</dt><dd>{clinic.currencyCode} ({clinic.currencySymbol})</dd>
                <dt>Administrator</dt><dd>{admin.displayName} ({admin.username})</dd>
                <dt>Dentist</dt><dd>{dentist.name || 'Not added yet'}</dd>
              </dl>
            </fieldset>
            <p style={{ marginTop: 12 }}>The clinic will start completely empty — no sample patients, no demo records. You can set the backup folder right away in Settings after signing in.</p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
          <Button disabled={step === 0 || loading} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 4 ? <Button variant="primary" onClick={next}>Continue</Button> : <Button variant="primary" loading={loading} onClick={() => void finish()}>Finish setup</Button>}
        </div>
      </div>
    </div>
  );
}
