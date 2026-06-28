
import { create } from 'zustand';
import type { RiskProfile } from './retention/comparePlans';

/**
 * @fileOverview Application state management for AegisSage.
 */

export type Language = 'en' | 'es';

export interface MemberRecord {
  id: string;
  fullName: string;
  medicareId: string;
  ssnLast4?: string;
  address?: string;
  pharmacyName?: string;
  status: 'active' | 'churn-risk' | 'pending' | 'PROVISIONALLY_DISENROLLED' | 'PLAN_CHANGED';
  mbi_hash?: string;
  retentionScore: number;
  lastSync: string;
  carrier: string;
  planName: string;
  planId?: string;
  updatedAt?: number;
  phone: string;
  email: string;
  dob: string;
  age: number;
  medicareMedicaidStatus: 'None' | 'Medicare' | 'Medicaid' | 'Both';
  VCCStatus: 'not-needed' | 'pending-fax' | 'faxed' | 'approved';
  checkInStatus: 'scheduled' | 'called' | 'completed' | 'escalated';
  poaStatus: 'unprotected' | 'pending-invite' | 'shielded';
  poaName?: string;
  poaPhone?: string;
  lastCallSentiment?: string;
  lastCallTranscript?: string;
  ptcExpiryDate: string;
  pcpName?: string;
  notes?: string;
  monthlyPremium: string;
  enrollmentPeriod: 'IEP' | 'AEP' | 'SEP' | 'OE';
  soaStatus: string;
  soaDate?: string;
  partAEffective: string;
  partBEffective: string;
  healthConditions: string[];
  lastCmsCheck?: number;
  futureContract?: string;
  futurePlanName?: string;
  futureEffectiveDate?: string;
  riskProfile?: RiskProfile;
}

export type { RiskProfile };

export interface ClientRecord extends Partial<MemberRecord> {
  agentId?: string;
  lastReviewDate?: string;
}

export interface Transaction {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  date: string;
  status: 'paid' | 'pending';
  type: string;
}

export interface AgencyProfile {
  id?: string;
  name: string;
  email: string;
  billingPlan: 'entry' | 'starter' | 'pro' | 'enterprise';
  isSubscriptionActive: boolean;
  isTrialInitialized: boolean;
  trialStartedAt?: string;
  isSolo: boolean;
  licenseNumber: string;
  tier: 'Basic' | 'Growth' | 'Enterprise';
}

export interface MayaSettings {
  voiceName: 'Algenib' | 'Achernar';
  script: string;
  autoEscalate: boolean;
}

export interface GHLSettings {
  apiKey: string;
  locationId: string;
  webhookUrl: string;
  fieldMapping: {
    medicareId: string;
    carrier: string;
    planName: string;
    enrollmentPeriod: string;
    partAEffective: string;
    partBEffective: string;
    pcpName: string;
  };
}

interface AppState {
  language: Language;
  setLanguage: (lang: Language) => void;
  members: MemberRecord[];
  clients: ClientRecord[];
  ledger: Transaction[];
  brokers: { id: string; name: string; role: string; email: string; npn: string }[];
  agencyProfile: AgencyProfile;
  mayaSettings: MayaSettings;
  ghlSettings: GHLSettings;
  isGHLConnected: boolean;
  isSidebarOpen: boolean;
  isRosterOpen: boolean;
  activeTutorial: 'none' | 'enrollment' | 'retention';
  tutorialStep: number;
  encryptionKey: CryptoKey | null;
  
  // Actions
  addMember: (member: Partial<MemberRecord>) => void;
  updateMember: (id: string, updates: Partial<MemberRecord>) => void;
  addClient: (client: Partial<ClientRecord>) => void;
  addBroker: (broker: any) => void;
  updateBroker: (id: string, updates: any) => void;
  updateAgencyProfile: (updates: Partial<AgencyProfile>) => void;
  updateMayaSettings: (updates: Partial<MayaSettings>) => void;
  updateGHLSettings: (updates: Partial<GHLSettings>) => void;
  toggleGHL: () => void;
  importFromGHL: (count: number) => void;
  toggleSidebar: () => void;
  toggleRoster: () => void;
  startTutorial: (type: 'enrollment' | 'retention') => void;
  nextTutorialStep: () => void;
  closeTutorial: () => void;
  setEncryptionKey: (key: CryptoKey) => void;
  /** Clear all user-specific state on sign-out. Prevents session crossover on shared devices. */
  resetStore: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  language: 'en',
  setLanguage: (lang) => set({ language: lang }),
  members: [],
  clients: [],
  ledger: [],
  brokers: [
    { id: '1', name: 'Agent Primary', role: 'Agency Owner', email: 'admin@AegisSage.ai', npn: '19920112' }
  ],
  agencyProfile: {
    name: "Elite Medicare Group",
    email: "",
    billingPlan: 'entry',
    isSubscriptionActive: true,
    isTrialInitialized: false,
    isSolo: false,
    licenseNumber: "NPN-882100",
    tier: 'Basic'
  },
  mayaSettings: {
    voiceName: 'Algenib',
    script: "Hi {member_name}, this is Maya from the agency. I'm just calling to ensure you've received your new {carrier} ID card and that you're satisfied with your coverage. Is your current doctor still in-network?",
    autoEscalate: true
  },
  ghlSettings: {
    apiKey: "",
    locationId: "",
    webhookUrl: "https://api.AegisSage.ai/v1/webhooks/ghl/123",
    fieldMapping: {
      medicareId: "contact.medicare_id",
      carrier: "contact.carrier",
      planName: "contact.plan_name",
      enrollmentPeriod: "contact.enrollment_period",
      partAEffective: "contact.part_a_date",
      partBEffective: "contact.part_b_date",
      pcpName: "contact.primary_physician"
    }
  },
  isGHLConnected: false,
  isSidebarOpen: true,
  isRosterOpen: false,
  activeTutorial: 'none',
  tutorialStep: 0,
  encryptionKey: null,

  addMember: (m) => set(s => ({
    members: [...s.members, {
      id: crypto.randomUUID(),
      fullName: m.fullName || "New Member",
      status: m.status || 'active',
      retentionScore: m.retentionScore || 100,
      ...m
    } as MemberRecord]
  })),
  
  updateMember: (id, updates) => set(s => ({
    members: s.members.map(m => m.id === id ? { ...m, ...updates, updatedAt: Date.now() } : m)
  })),

  addClient: (c) => set(s => ({
    clients: [...s.clients, { id: crypto.randomUUID(), ...c }]
  })),

  addBroker: (b) => set(s => ({
    brokers: [...s.brokers, { id: crypto.randomUUID(), ...b }]
  })),

  updateBroker: (id, updates) => set(s => ({
    brokers: s.brokers.map(b => b.id === id ? { ...b, ...updates } : b)
  })),

  updateAgencyProfile: (updates) => set(s => ({
    agencyProfile: { ...s.agencyProfile, ...updates }
  })),

  updateMayaSettings: (updates) => set(s => ({
    mayaSettings: { ...s.mayaSettings, ...updates }
  })),

  updateGHLSettings: (updates) => set(s => ({
    ghlSettings: { ...s.ghlSettings, ...updates }
  })),

  toggleGHL: () => set(s => ({ isGHLConnected: !s.isGHLConnected })),

  importFromGHL: (_count) => {
    // No-op: GHL contacts are synced server-side via syncContactsFromGHL action
  },

  toggleSidebar: () => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),
  toggleRoster: () => set(s => ({ isRosterOpen: !s.isRosterOpen })),
  
  startTutorial: (type) => set({ activeTutorial: type, tutorialStep: 0 }),
  nextTutorialStep: () => set(s => ({ tutorialStep: s.tutorialStep + 1 })),
  closeTutorial: () => set({ activeTutorial: 'none', tutorialStep: 0 }),

  setEncryptionKey: (key) => set({ encryptionKey: key }),

  resetStore: () => set({
    members:        [],
    clients:        [],
    ledger:         [],
    brokers:        [],
    encryptionKey:  null,
    agencyProfile: {
      name:                 '',
      email:                '',
      billingPlan:          'entry',
      isSubscriptionActive: false,
      isTrialInitialized:   false,
      isSolo:               false,
      licenseNumber:        '',
      tier:                 'Basic',
    },
  }),
}));

export const initializeStore = () => {
  // No-op: all data is fetched from Supabase server-side
};
