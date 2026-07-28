/**
 * Integration boundaries only. These functions deliberately do not make
 * network calls or claim that a provider is connected.
 */
export type SunFireIntegration = {
  syncClients: (input: { since?: string }) => Promise<never>;
  lookupPlans: (input: { state: string; query: string }) => Promise<never>;
};

export type MedicareDeliveryIntegration = {
  sendSms: (input: { to: string; body: string }) => Promise<never>;
  sendEmail: (input: { to: string; subject: string; body: string }) => Promise<never>;
};

export class MedicareIntegrationNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} integration is not configured for Medicare CRM`);
    this.name = 'MedicareIntegrationNotConfiguredError';
  }
}

export const sunfire: SunFireIntegration = {
  syncClients: async () => { throw new MedicareIntegrationNotConfiguredError('SunFire'); },
  lookupPlans: async () => { throw new MedicareIntegrationNotConfiguredError('SunFire'); },
};

export const delivery: MedicareDeliveryIntegration = {
  sendSms: async () => { throw new MedicareIntegrationNotConfiguredError('Twilio'); },
  sendEmail: async () => { throw new MedicareIntegrationNotConfiguredError('SendGrid'); },
};
