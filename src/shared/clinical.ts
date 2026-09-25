/**
 * Clinical assessment checklist options for the prescription builder.
 * C/C = Chief Complaint, O/E = On Examination, R/E = Radiographic/Extra findings.
 */
export const CC_OPTIONS = [
  'Pain On',
  'G. Caries',
  'Swelling',
  'Gum Bleeding',
  'Bad Breath',
  'Sensitivity'
] as const;

export const OE_OPTIONS = [
  'Caries / G Caries',
  'BDR / BDC',
  'Gingivitis',
  'Periodontal Pocket',
  'Periodontitis',
  'Impacted Teeth',
  'Dry Socket',
  'Attrition / Erosion'
] as const;

export const MEDICINE_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'suspension',
  'cream',
  'gel',
  'ointment',
  'drops',
  'mouthwash',
  'injection',
  'custom'
] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];

export const MEDICINE_TIMINGS = ['before food', 'after food', 'with food', 'at bedtime', 'as needed', 'custom'] as const;
