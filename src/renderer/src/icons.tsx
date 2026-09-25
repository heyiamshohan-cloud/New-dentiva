import React from 'react';

/**
 * Dentiva Pro icon family — one coherent set: 24×24 grid, 1.8px consistent
 * stroke, round caps/joins, no fills beyond subtle accents. No emoji, no
 * mixed libraries.
 */
type P = { size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties };

function I({ size = 18, strokeWidth = 1.8, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const LogoMark: React.FC<{ size?: number }> = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className="mark" aria-hidden="true">
    <rect x="2" y="2" width="44" height="44" rx="11" fill="#0e5f8a" />
    <path d="M24 10c6.5 0 11 4.6 11 11.2 0 9.2-4.6 16.4-6.5 16.4-1.6 0-1.1-4.6-4.5-4.6s-2.9 4.6-4.5 4.6c-1.9 0-6.5-7.2-6.5-16.4C13 14.6 17.5 10 24 10z" fill="#fff" />
    <path d="M19.4 15.6c2-1.5 4.6-2.3 4.6-2.3v11.2h-8.9c.3-4.1 2-7 4.3-8.9z" fill="#0e5f8a" opacity="0.28" />
    <path d="M24 13.3v11.2h8.9" stroke="#bfe3f5" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconDashboard = (p: P) => <I {...p}><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" /></I>;
export const IconPatients = (p: P) => <I {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3.5 19.5c.6-3.1 2.9-4.8 5.5-4.8s4.9 1.7 5.5 4.8" /><circle cx="17" cy="9" r="2.6" /><path d="M15.5 14.9c2.3.2 4.1 1.7 4.9 4.1" /></I>;
export const IconCalendar = (p: P) => <I {...p}><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><rect x="7" y="13" width="3.4" height="3" rx="0.6" /></I>;
export const IconQueue = (p: P) => <I {...p}><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18.5" cy="16.5" r="3" /><path d="M18.5 15v1.5l1 1" /></I>;
export const IconVisit = (p: P) => <I {...p}><path d="M4.5 12a7.5 7.5 0 0 1 15 0c0 4.5-2.2 5.6-3 8H7.5c-.8-2.4-3-3.5-3-8z" /><path d="M12 8.5v7M8.5 12h7" /></I>;
export const IconTooth = (p: P) => <I {...p}><path d="M12 3.5c3.6 0 7 2 7 6 0 5.4-2.7 10.5-4 10.5-1.2 0-.8-3.5-3-3.5s-1.8 3.5-3 3.5c-1.3 0-4-5.1-4-10.5 0-4 3.4-6 7-6z" /><path d="M9 7.5c1.2-.8 2.4-1.1 3-1.1" /></I>;
export const IconPlan = (p: P) => <I {...p}><path d="M8 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20V5a1.5 1.5 0 0 1 1.5-1.5H8z" /><path d="M16 3.5V8h4" /><path d="M8.5 13l2.3 2.3 4.7-4.6" /></I>;
export const IconRx = (p: P) => <I {...p}><path d="M6.5 3.5h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" /><path d="M9 8h3.2a2.1 2.1 0 1 1 0 4.2H9V8zM9 12.2l4.5 4M13.5 8H16" /></I>;
export const IconInvoice = (p: P) => <I {...p}><path d="M6 3.5h12V21l-2.4-1.6-2.4 1.6-2.4-1.6L8.4 21 6 19.4V3.5z" /><path d="M9 8h6M9 12h6M9 16h3.5" /></I>;
export const IconPayment = (p: P) => <I {...p}><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><path d="M6 15h4" /></I>;
export const IconReceipt = (p: P) => <I {...p}><path d="M5 3.5h14V21l-2.3-1.7-2.4 1.7-2.3-1.7-2.4 1.7L7.3 19 5 20.4V3.5z" /><path d="M9 8.5h6M9 12.5h4" /></I>;
export const IconBox = (p: P) => <I {...p}><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></I>;
export const IconChart = (p: P) => <I {...p}><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3M20 16V6" /></I>;
export const IconStaff = (p: P) => <I {...p}><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></I>;
export const IconSettings = (p: P) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M5.2 18.8l1.9-1.9M16.9 7.1l1.9-1.9" /></I>;
export const IconBackup = (p: P) => <I {...p}><path d="M12 3.5v10M8.5 10.5 12 7l3.5 3.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></I>;
export const IconRestore = (p: P) => <I {...p}><path d="M12 13.5v-10M8.5 6.5 12 10l3.5-3.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></I>;
export const IconDiag = (p: P) => <I {...p}><path d="M3 12h4l2.5-6 3 12L15 12h6" /></I>;
export const IconAudit = (p: P) => <I {...p}><path d="M12 3.5 4.5 6.5v5c0 4.5 3 8 7.5 9 4.5-1 7.5-4.5 7.5-9v-5L12 3.5z" /><path d="M9 11.8l2.2 2.2 4-4" /></I>;
export const IconSearch = (p: P) => <I {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></I>;
export const IconBell = (p: P) => <I {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></I>;
export const IconLock = (p: P) => <I {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" /><circle cx="12" cy="15.5" r="1.3" /></I>;
export const IconPlus = (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const IconClose = (p: P) => <I {...p}><path d="M6 6l12 12M18 6 6 18" /></I>;
export const IconChevronL = (p: P) => <I {...p}><path d="m14.5 6-6 6 6 6" /></I>;
export const IconChevronR = (p: P) => <I {...p}><path d="m9.5 6 6 6-6 6" /></I>;
export const IconChevronD = (p: P) => <I {...p}><path d="m6 9.5 6 6 6-6" /></I>;
export const IconPrint = (p: P) => <I {...p}><path d="M7 8V3.5h10V8" /><rect x="4" y="8" width="16" height="8" rx="1.5" /><path d="M7 13.5h10V20H7z" /></I>;
export const IconPdf = (p: P) => <I {...p}><path d="M6.5 3.5h7L18 8v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M14 3.5V8h4" /><path d="M8.5 17v-5h1.6a1.7 1.7 0 1 1 0 3.4H8.5M13.5 17v-5h1.2a1.8 1.8 0 0 1 0 5h-1.2z" /></I>;
export const IconEdit = (p: P) => <I {...p}><path d="M14.5 4.5 19.5 9.5 8.5 20.5H3.5v-5L14.5 4.5z" /><path d="m12.5 6.5 5 5" /></I>;
export const IconDots = (p: P) => <I {...p}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></I>;
export const IconCheck = (p: P) => <I {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></I>;
export const IconWarning = (p: P) => <I {...p}><path d="M12 4 2.8 19.5h18.4L12 4z" /><path d="M12 10v4.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></I>;
export const IconMoney = (p: P) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M15.2 9.2c-.5-1-1.6-1.6-3.2-1.6-2 0-3.4 1-3.4 2.5 0 3.6 6.8 1.6 6.8 4.4 0 1.5-1.5 2.5-3.4 2.5-1.7 0-3-.7-3.5-1.8M12 6v12" /></I>;
export const IconWallet = (p: P) => <I {...p}><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h13.5v3" /><path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15V9h-15A1.5 1.5 0 0 1 3.5 7.5z" /><circle cx="16.7" cy="14.2" r="1.1" /></I>;
export const IconLedger = (p: P) => <I {...p}><path d="M5 3.5h11.5A2.5 2.5 0 0 1 19 6v14.5H7a2 2 0 0 1-2-2V3.5z" /><path d="M19 6.5A2.5 2.5 0 0 0 16.5 4" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></I>;
export const IconTransfer = (p: P) => <I {...p}><path d="M4 9h13l-3-3M20 15H7l3 3" /></I>;
export const IconHistory = (p: P) => <I {...p}><path d="M4 12a8 8 0 1 1 2.3 5.7" /><path d="M4 12H2.5M4 12V9.5" /><path d="M12 8v4.5l3 1.8" /></I>;

export const NAV_ICONS: Record<string, React.FC<P>> = {
  dashboard: IconDashboard,
  patients: IconPatients,
  appointments: IconCalendar,
  queue: IconQueue,
  treatments: IconTooth,
  plans: IconPlan,
  prescriptions: IconRx,
  invoices: IconInvoice,
  payments: IconPayment,
  inventory: IconBox,
  accounting: IconLedger,
  reports: IconChart,
  staff: IconStaff,
  audit: IconAudit,
  backup: IconBackup,
  settings: IconSettings,
  diagnostics: IconDiag
};

/* ------------------------------------------------------------------
 * Semantic aliases used across pages (kept in one place so the set of
 * real glyphs stays small and consistent).
 * ------------------------------------------------------------------ */
export const IconLeft = IconChevronL;
export const IconRight = IconChevronR;
export const IconAccounting = IconLedger;
export const IconInventory = IconBox;
export const IconDiagnostics = IconDiag;
export const IconReports = IconChart;
export const IconStar = (p: P) => <I {...p}><path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z" /></I>;
export const IconRefresh = (p: P) => <I {...p}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></I>;
