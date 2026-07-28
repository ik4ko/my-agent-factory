export type MedicareAppointmentStatus = 'active' | 'appointed' | 'pending' | 'terminated' | string;
export type MedicarePolicyStatus = 'active' | 'pending' | 'cancelled' | 'lost' | string;

export type AgAgencySettings = {
  id: string;
  agency_name: string;
  npn: string | null;
  resident_state: string | null;
  licensed_states: string[];
  ahip_status: string;
  ahip_expires_at: string | null;
  hipaa_status: string;
  hipaa_expires_at: string | null;
  compliance_flags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgFmo = {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type AgCarrier = {
  id: string;
  name: string;
  fmo_id: string | null;
  appointment_status: MedicareAppointmentStatus;
  lines_of_business: string[];
  active_states: string[];
  created_at: string;
  updated_at: string;
};

export type AgClient = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  physical_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  medicare_beneficiary_identifier: string | null;
  /** Summary-only value; raw MBI never crosses the room API. */
  masked_mbi?: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type AgClientNote = {
  id: string;
  client_id: string;
  note: string;
  created_at: string;
  created_by: string | null;
};

export type AgPolicy = {
  id: string;
  client_id: string;
  carrier_id: string | null;
  fmo_id: string | null;
  plan_name: string;
  plan_id: string | null;
  effective_date: string | null;
  monthly_premium: number | null;
  commission_level: string | null;
  status: MedicarePolicyStatus;
  created_at: string;
  updated_at: string;
};

export type AgCommunication = {
  id: string;
  client_id: string;
  type: string;
  content: string;
  direction: string;
  timestamp: string;
  source_metadata: Record<string, unknown>;
  created_at: string;
};

export type AgComplianceDocument = {
  id: string;
  client_id: string | null;
  document_type: string;
  title: string;
  storage_path: string | null;
  expires_at: string | null;
  uploaded_at: string;
  notes: string;
};

export type MedicareRoomData = {
  agencySettings: AgAgencySettings | null;
  fmos: AgFmo[];
  carriers: AgCarrier[];
  clients: AgClient[];
  notes: AgClientNote[];
  policies: AgPolicy[];
  communications: AgCommunication[];
  complianceDocuments: AgComplianceDocument[];
};

export const EMPTY_MEDICARE_ROOM_DATA: MedicareRoomData = {
  agencySettings: null,
  fmos: [],
  carriers: [],
  clients: [],
  notes: [],
  policies: [],
  communications: [],
  complianceDocuments: [],
};
