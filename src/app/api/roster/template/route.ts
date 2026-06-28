export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = ['full_name', 'mbi', 'plan_name', 'carrier', 'effective_date', 'is_chronic']

  const exampleRows = [
    ['John Smith', '1EG4TE5MK73', 'Life Improvement Plan (HMO D-SNP)', 'HealthFirst', '01/01/2026', 'yes'],
    ['Jane Doe', '2AB3CD4EF56', 'Premier Value PPO', 'Clover', '09/01/2025', 'no'],
  ]

  const csv = [headers.join(','), ...exampleRows.map(r => r.join(','))].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="aegissage-roster-template.csv"',
    },
  })
}
