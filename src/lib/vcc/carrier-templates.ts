/**
 * Canonical field-map definitions for the three target SSBCI/VCC carriers.
 *
 * HOW TO USE
 * ----------
 * 1. Upload the actual carrier PDF at /dashboard/vcc/templates/upload using the
 *    storage path format: {year}/{carrier}/form_v1.pdf
 *    e.g.  2026/uhc/form_v1.pdf
 *
 * 2. Call saveTemplate() (from src/app/actions/vcc-templates.ts) with the
 *    relevant entry from CARRIER_TEMPLATES below as the fieldMap argument.
 *
 * 3. Use the test-fill button on /dashboard/vcc/templates to render dummy data
 *    onto the PDF. Adjust x/y coordinates iteratively until every field lands
 *    on the correct line.
 *
 * COORDINATE SYSTEM
 * -----------------
 * pdf-lib measures from the BOTTOM-LEFT corner of each page:
 *   x → increases left-to-right
 *   y → increases bottom-to-top
 *
 * A US Letter page is 612 × 792 points (1 point = 1/72 inch).
 * Common landmarks on a standard VCC form:
 *   Top margin baseline  ≈ y 720–740
 *   Main body fields     ≈ y 400–700
 *   Signature area       ≈ y 120–180
 *
 * The placeholder coordinates below are calibrated for the standard CMS-style
 * VCC layout. Adjust per actual carrier PDF after visual test-fill verification.
 *
 * CHECKBOX FIELDS
 * ---------------
 * type: 'checkbox' fields draw the checkboxSymbol only when the resolved data
 * value matches checkboxValue (case-insensitive).
 *
 *   is_chronic  → 'true' when VCCFieldData.is_chronic === true
 *   is_renewal  → 'true' when VCCFieldData.is_renewal === true
 *
 * If a carrier form has multiple radio-button options (e.g. "Initial □ Renewal □")
 * define two entries with the same data key but different checkboxValue values.
 */

import type { FieldMapEntry } from './pdf-engine'

export interface CarrierTemplate {
  carrier:             string
  carrierDisplayName:  string
  year:                number
  formName:            string
  storagePath:         string
  version:             number
  fieldMap:            Record<string, FieldMapEntry>
}

// ═══════════════════════════════════════════════════════════════════════════════
// UnitedHealthcare — SSBCI / Vendor Certification of Chronic Condition
// Form: UHC-SSBCI-2026  (adjust storagePath for each new plan year)
// ═══════════════════════════════════════════════════════════════════════════════
export const UHC_SSBCI_2026: CarrierTemplate = {
  carrier:            'uhc',
  carrierDisplayName: 'United Healthcare',
  year:               2026,
  formName:           'UHC SSBCI Certification 2026',
  storagePath:        '2026/uhc/form_v1.pdf',
  version:            1,
  fieldMap: {

    // ── Patient information ────────────────────────────────────────────────
    client_name: {
      page: 1, x: 175, y: 648,
      type: 'text', size: 10, maxLength: 40,
    },
    client_dob: {
      page: 1, x: 175, y: 622,
      type: 'date', dateFormat: 'MM/DD/YYYY', size: 10,
    },
    medicare_id: {
      page: 1, x: 350, y: 622,
      type: 'text', size: 10, maxLength: 11, bold: true,
    },

    // ── Plan / carrier information ─────────────────────────────────────────
    plan_name: {
      page: 1, x: 175, y: 596,
      type: 'text', size: 10, maxLength: 40,
    },
    plan_year: {
      page: 1, x: 450, y: 596,
      type: 'text', size: 10, maxLength: 4,
    },

    // ── Chronic condition checkbox (C-SNP eligibility indicator) ───────────
    // The form has a single checkbox: "Member has a chronic condition requiring
    // a SSBCI vendor certification." Check it when is_chronic = true.
    is_chronic: {
      page: 1, x: 64, y: 558,
      type: 'checkbox', checkboxValue: 'true', checkboxSymbol: 'X', size: 11,
    },

    // ── Physician information ──────────────────────────────────────────────
    doctor_name: {
      page: 1, x: 175, y: 510,
      type: 'text', size: 10, maxLength: 50,
    },
    doctor_fax: {
      page: 1, x: 420, y: 510,
      type: 'phone', size: 10,
    },

    // ── Broker / agent information ─────────────────────────────────────────
    broker_name: {
      page: 1, x: 175, y: 370,
      type: 'text', size: 10, maxLength: 40,
    },
    broker_npn: {
      page: 1, x: 420, y: 370,
      type: 'text', size: 10, maxLength: 10, bold: true,
    },
    agent_phone: {
      page: 1, x: 175, y: 348,
      type: 'phone', size: 10,
    },
    submission_date: {
      page: 1, x: 420, y: 348,
      type: 'date', dateFormat: 'MM/DD/YYYY', size: 10,
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aetna — Vendor Certification of Chronic Condition / Insurance Transition
// Form: Aetna-VCC-2026
// ═══════════════════════════════════════════════════════════════════════════════
export const AETNA_VCC_2026: CarrierTemplate = {
  carrier:            'aetna',
  carrierDisplayName: 'Aetna',
  year:               2026,
  formName:           'Aetna VCC / Transition Notice 2026',
  storagePath:        '2026/aetna/form_v1.pdf',
  version:            1,
  fieldMap: {

    // ── Member information ─────────────────────────────────────────────────
    client_name: {
      page: 1, x: 180, y: 660,
      type: 'text', size: 10, maxLength: 45,
    },
    client_dob: {
      page: 1, x: 430, y: 660,
      type: 'date', dateFormat: 'MM/DD/YYYY', size: 10,
    },
    medicare_id: {
      page: 1, x: 180, y: 636,
      type: 'text', size: 10, maxLength: 11, bold: true,
    },
    plan_name: {
      page: 1, x: 180, y: 612,
      type: 'text', size: 10, maxLength: 45,
    },

    // ── Form type checkboxes ───────────────────────────────────────────────
    // Aetna form distinguishes Initial vs. Renewal enrollment
    is_renewal_false: {
      page: 1, x: 122, y: 580,
      type: 'checkbox',
      checkboxValue: 'false',   // checked when is_renewal = false (Initial)
      checkboxSymbol: 'X', size: 11,
    },
    is_renewal: {
      page: 1, x: 205, y: 580,
      type: 'checkbox',
      checkboxValue: 'true',    // checked when is_renewal = true
      checkboxSymbol: 'X', size: 11,
    },

    // ── Chronic condition ──────────────────────────────────────────────────
    is_chronic: {
      page: 1, x: 66, y: 548,
      type: 'checkbox', checkboxValue: 'true', checkboxSymbol: 'X', size: 11,
    },

    // ── Provider ──────────────────────────────────────────────────────────
    doctor_name: {
      page: 1, x: 180, y: 506,
      type: 'text', size: 10, maxLength: 50,
    },
    doctor_fax: {
      page: 1, x: 420, y: 506,
      type: 'phone', size: 10,
    },

    // ── Agent ─────────────────────────────────────────────────────────────
    broker_name: {
      page: 1, x: 180, y: 362,
      type: 'text', size: 10, maxLength: 40,
    },
    broker_npn: {
      page: 1, x: 420, y: 362,
      type: 'text', size: 10, maxLength: 10, bold: true,
    },
    submission_date: {
      page: 1, x: 420, y: 340,
      type: 'date', dateFormat: 'MM/DD/YYYY', size: 10,
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// Humana — SSBCI Vendor Certification of Supplemental Benefits
// Form: Humana-SSBCI-2026
// ═══════════════════════════════════════════════════════════════════════════════
export const HUMANA_SSBCI_2026: CarrierTemplate = {
  carrier:            'humana',
  carrierDisplayName: 'Humana',
  year:               2026,
  formName:           'Humana SSBCI Vendor Certification 2026',
  storagePath:        '2026/humana/form_v1.pdf',
  version:            1,
  fieldMap: {

    // ── Member information ─────────────────────────────────────────────────
    // Humana uses "member_name" in its printed form label — resolved via FIELD_ALIASES
    member_name: {
      page: 1, x: 190, y: 654,
      type: 'text', size: 10, maxLength: 45,
    },
    date_of_birth: {
      page: 1, x: 190, y: 630,
      type: 'date', dateFormat: 'MM/DD/YYYY', size: 10,
    },
    // Humana forms label the MBI field as "Medicare Beneficiary ID"
    mbi: {
      page: 1, x: 190, y: 606,
      type: 'text', size: 10, maxLength: 11, bold: true,
    },
    plan_name: {
      page: 1, x: 190, y: 582,
      type: 'text', size: 10, maxLength: 45,
    },
    plan_year: {
      page: 1, x: 460, y: 582,
      type: 'text', size: 10, maxLength: 4,
    },

    // ── SSBCI benefit type checkboxes ─────────────────────────────────────
    // Humana SSBCI forms have multiple supplemental benefit category boxes.
    // is_chronic drives the "Chronic Condition Plan (C-SNP)" box.
    is_chronic: {
      page: 1, x: 66, y: 548,
      type: 'checkbox', checkboxValue: 'true', checkboxSymbol: 'X', size: 11,
    },

    // ── Certifying physician ───────────────────────────────────────────────
    physician_name: {
      page: 1, x: 190, y: 500,
      type: 'text', size: 10, maxLength: 50,
    },
    physician_fax: {
      page: 1, x: 420, y: 500,
      type: 'phone', size: 10,
    },

    // ── Agent of Record ────────────────────────────────────────────────────
    agent_name: {
      page: 1, x: 190, y: 358,
      type: 'text', size: 10, maxLength: 40,
    },
    agent_npn: {
      page: 1, x: 420, y: 358,
      type: 'text', size: 10, maxLength: 10, bold: true,
    },
    agent_phone: {
      page: 1, x: 190, y: 336,
      type: 'phone', size: 10,
    },
    date_signed: {
      page: 1, x: 420, y: 336,
      type: 'date', dateFormat: 'MM/DD/YYYY', size: 10,
    },
  },
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Add new carrier templates here. The array is used by the seed script and the
// template upload page's carrier selector.

export const CARRIER_TEMPLATES: CarrierTemplate[] = [
  UHC_SSBCI_2026,
  AETNA_VCC_2026,
  HUMANA_SSBCI_2026,
]

export const CARRIER_TEMPLATE_MAP: Record<string, CarrierTemplate> = Object.fromEntries(
  CARRIER_TEMPLATES.map(t => [`${t.carrier}_${t.year}_v${t.version}`, t])
)
