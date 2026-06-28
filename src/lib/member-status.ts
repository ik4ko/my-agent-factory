export const MEMBER_STATUS = {
  UNVERIFIED:          'unverified',
  VERIFIED:            'verified',
  SWITCHING:           'switching',
  SWITCHED:            'switched',
  RECOVERABLE:         'recoverable',
  TERMED_NO_PARTB:     'termed_no_partb',
  DECEASED:            'deceased',
  DISENROLLED:         'disenrolled',
  NPN_MISMATCH:        'npn_mismatch',
  PENDING_ENROLLMENT:  'pending_enrollment',
  LEFT:                'left',
} as const

export type MemberStatus = typeof MEMBER_STATUS[keyof typeof MEMBER_STATUS]

export const STATUS_PRIORITY: Record<MemberStatus, number> = {
  switching:          1,
  recoverable:        2,
  switched:           3,
  npn_mismatch:       4,
  pending_enrollment: 5,
  unverified:         6,
  verified:           7,
  left:               8,
  termed_no_partb:    9,
  disenrolled:        10,
  deceased:           11,
}

export const STATUS_DISPLAY: Record<MemberStatus, {
  label: string
  color: string
  actionable: boolean
  description: string
}> = {
  switching:          { label: 'Switching',    color: 'red',   actionable: true,  description: 'Future plan change detected — act before effective date' },
  recoverable:        { label: 'Recoverable',  color: 'red',   actionable: true,  description: 'No active plan — member is eligible for re-enrollment' },
  switched:           { label: 'Switched',     color: 'orange', actionable: true, description: 'Plan already changed' },
  npn_mismatch:       { label: 'NPN Mismatch', color: 'amber', actionable: true,  description: 'Plan match but enrolled under different broker NPN' },
  pending_enrollment: { label: 'Pending',      color: 'amber', actionable: true,  description: 'Enrollment not confirmed by MARx after 30 days' },
  unverified:         { label: 'Unverified',   color: 'gray',  actionable: false, description: 'Not yet checked against MARx' },
  verified:           { label: 'Verified',     color: 'green', actionable: false, description: 'Active on enrolled plan' },
  left:               { label: 'Left',         color: 'gray',  actionable: false, description: 'No longer on broker plan' },
  termed_no_partb:    { label: 'Part B Ended', color: 'gray',  actionable: false, description: 'Part B no longer active' },
  disenrolled:        { label: 'Left Medicare', color: 'gray', actionable: false, description: 'Disenrolled from Medicare entirely' },
  deceased:           { label: 'Deceased',     color: 'gray',  actionable: false, description: 'Member is deceased' },
}
