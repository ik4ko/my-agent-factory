import { z } from 'zod';

export const MedicareNoteSchema = z.object({
  client_id: z.string().uuid(),
  note: z.string().trim().min(1).max(5000),
});

export const MedicareImportSchema = z.object({
  entity: z.enum(['clients', 'carriers', 'policies']),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
});

const OptionalText = (max: number) => z.string().trim().max(max).nullable();
const OptionalUuid = z.string().uuid().nullable();
const OptionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullable();

export const MedicareClientImportRowSchema = z.object({
  id: z.string().uuid().optional(),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: OptionalText(40),
  email: z.string().email().max(320).nullable(),
  date_of_birth: OptionalDate,
  physical_address: OptionalText(300),
  city: OptionalText(100),
  state: OptionalText(2),
  zip: OptionalText(20),
  medicare_beneficiary_identifier: OptionalText(32),
  tags: z.array(z.string().trim().min(1).max(80)).max(50),
}).strict();

export const MedicareCarrierImportRowSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  appointment_status: z.string().trim().min(1).max(40),
  fmo_id: OptionalUuid,
  lines_of_business: z.array(z.string().trim().min(1).max(80)).max(20),
  active_states: z.array(z.string().trim().min(2).max(2)).max(60),
}).strict();

export const MedicarePolicyImportRowSchema = z.object({
  id: z.string().uuid().optional(),
  client_id: z.string().uuid(),
  carrier_id: OptionalUuid,
  fmo_id: OptionalUuid,
  plan_name: z.string().trim().min(1).max(300),
  plan_id: OptionalText(120),
  effective_date: OptionalDate,
  monthly_premium: z.number().finite().nonnegative().nullable(),
  commission_level: OptionalText(120),
  status: z.string().trim().min(1).max(40),
}).strict();

export type MedicareImportEntity = z.infer<typeof MedicareImportSchema>['entity'];
