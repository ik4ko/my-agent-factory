import { ClientDetail } from '@/components/dashboard/medicare/client-detail';

export default async function MedicareClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetail clientId={id} />;
}
