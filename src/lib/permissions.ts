export type UserRole =
  | 'BROKER'
  | 'AGENCY_OWNER'
  | 'AGENCY_MANAGER'
  | 'AGENCY_CUSTOMER_SERVICE';

export interface Permissions {
  /** Access the user's own assigned clients */
  canViewOwnBook: boolean;
  /** Access all clients across the agency */
  canViewAgencyBook: boolean;
  /** Run MARx eligibility checks (own clients only for BROKER; agency-wide otherwise) */
  canRunMARxCheck: boolean;
  /** Send VCC / SSBCI forms (own clients for BROKER; any agency client otherwise) */
  canSendVCCForm: boolean;
  /** Create and send retention campaigns */
  canCreateCampaign: boolean;
  /** Send mass SMS / bulk text campaigns */
  canSendMassText: boolean;
  /** Use the browser extension (own personal clients only) */
  canUseExtension: boolean;
  /** Invite, remove, and manage brokers within the agency */
  canManageBrokers: boolean;
  /** Access the agency-level rollup dashboard and reporting */
  canViewAgencyDashboard: boolean;
}

// AGENCY_OWNER, AGENCY_MANAGER, and AGENCY_CUSTOMER_SERVICE share identical
// capabilities per the current spec. Use a single object to keep them in sync.
const AGENCY_PERMISSIONS: Permissions = {
  canViewOwnBook: true,
  canViewAgencyBook: true,
  canRunMARxCheck: true,
  canSendVCCForm: true,
  canCreateCampaign: true,
  canSendMassText: true,
  canUseExtension: true,
  canManageBrokers: true,
  canViewAgencyDashboard: true,
};

export const ROLE_PERMISSIONS: Record<UserRole, Permissions> = {
  BROKER: {
    canViewOwnBook: true,
    canViewAgencyBook: false,
    canRunMARxCheck: true,
    canSendVCCForm: true,
    canCreateCampaign: true,
    canSendMassText: false,
    canUseExtension: true,
    canManageBrokers: false,
    canViewAgencyDashboard: false,
  },
  AGENCY_OWNER: AGENCY_PERMISSIONS,
  AGENCY_MANAGER: AGENCY_PERMISSIONS,
  AGENCY_CUSTOMER_SERVICE: AGENCY_PERMISSIONS,
};

export function hasPermission(role: UserRole, permission: keyof Permissions): boolean {
  return ROLE_PERMISSIONS[role][permission];
}
