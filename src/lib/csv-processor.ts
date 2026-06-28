'use client';

/**
 * Client-side CSV processor for secure member data ingestion.
 *
 * Validates CSV structure and uploads to Supabase Storage at
 * csv-uploads/{agencyId}/{timestamp}_{filename}.csv
 *
 * The Server Action processCsvIngestion then reads the file, encrypts PHI
 * fields with AES-256-GCM, and writes operational metadata to ghl_contacts.
 */

export const PHI_COLUMNS = [
  'fullName', 'medicareId', 'ssnLast4', 'address', 'phone', 'email',
  'dob', 'pcpName', 'poaName', 'poaPhone', 'pharmacyName', 'notes',
] as const;

export const OPERATIONAL_COLUMNS = [
  'id', 'carrier', 'planName', 'enrollmentPeriod', 'monthlyPremium',
  'partAEffective', 'partBEffective', 'status', 'medicareMedicaidStatus',
  'VCCStatus', 'checkInStatus', 'poaStatus', 'soaStatus', 'soaDate',
  'age', 'retentionScore', 'ptcExpiryDate',
] as const;

export const REQUIRED_COLUMNS = ['carrier', 'age'] as const;

export interface CSVValidationResult {
  valid: boolean;
  missingRequired: string[];
  phiDetected: string[];
  rowCount: number;
}

export function validateCSVHeaders(csvText: string): CSVValidationResult {
  const firstLine = csvText.split('\n')[0] ?? '';
  const headers = firstLine
    .split(',')
    .map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const missingRequired = REQUIRED_COLUMNS.filter(
    r => !headers.includes(r.toLowerCase())
  );

  const phiDetected = PHI_COLUMNS.filter(
    p => headers.includes(p.toLowerCase())
  );

  const lineCount = csvText.trim().split('\n').length - 1;

  return {
    valid: missingRequired.length === 0,
    missingRequired,
    phiDetected,
    rowCount: Math.max(0, lineCount),
  };
}

export type UploadProgressCallback = (progress: number) => void;

export interface CSVUploadResult {
  storagePath: string;
}

/**
 * Validates and uploads a CSV file to Supabase Storage for server-side
 * encryption and ingestion. Returns the storage path on success.
 *
 * Note: Supabase Storage does not expose granular upload progress;
 * onProgress fires at 10% (start) and 100% (complete).
 */
export async function uploadCSVForProcessing(
  file: File,
  agencyId: string,
  onProgress?: UploadProgressCallback,
): Promise<CSVUploadResult> {
  const text = await file.text();
  const validation = validateCSVHeaders(text);

  if (!validation.valid) {
    throw new Error(
      `CSV is missing required columns: ${validation.missingRequired.join(', ')}`
    );
  }

  const { createBrowserClient } = await import('@supabase/ssr');
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `uploads/${agencyId}/${timestamp}_${safeName}`;

  onProgress?.(10);

  const { error } = await supabase.storage
    .from('csv-uploads')
    .upload(storagePath, file, {
      contentType: 'text/csv',
      upsert: false,
    });

  if (error) throw error;

  onProgress?.(100);

  return { storagePath };
}

export function generateCSVTemplate(): string {
  const allColumns = [...OPERATIONAL_COLUMNS, ...PHI_COLUMNS];
  return allColumns.join(',') + '\n';
}
