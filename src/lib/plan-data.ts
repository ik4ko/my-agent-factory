export interface MedicarePlan {
  id: string
  name: string
  carrier: string
  premium: number
  star_rating: number
  moop: number
  key_benefits: string[]
}

const PLAN_DATABASE: Record<string, MedicarePlan> = {
  'H1234': { id: 'H1234', name: 'Humana Gold Plus (HMO)', carrier: 'Humana', premium: 0, star_rating: 4.5, moop: 3400, key_benefits: ['Dental $2k', 'Vision', 'OTC $100/mo'] },
  'H5678': { id: 'H5678', name: 'UHC Dual Complete (HMO D-SNP)', carrier: 'UHC', premium: 25, star_rating: 3.5, moop: 4500, key_benefits: ['Dental $1k', 'Vision'] },
  'H9999': { id: 'H9999', name: 'Aetna Medicare Value (PPO)', carrier: 'Aetna', premium: 0, star_rating: 4.0, moop: 3900, key_benefits: ['SilverSneakers', 'OTC $50/mo'] },
}

export function getPlanData(planId: string | null | undefined): MedicarePlan {
  if (!planId) return { id: 'Unknown', name: 'Unknown Plan', carrier: 'Unknown', premium: 0, star_rating: 0, moop: 0, key_benefits: [] }
  return PLAN_DATABASE[planId] ?? {
    id: planId,
    name: `${planId} Generic Medicare Plan`,
    carrier: 'Generic',
    premium: 0,
    star_rating: 3.0,
    moop: 5000,
    key_benefits: ['Standard Part C Benefits'],
  }
}
