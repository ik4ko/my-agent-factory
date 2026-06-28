import { redirect } from 'next/navigation'
// Dead page — superseded by /dashboard/churn/upload
export default function UploadRedirect() { redirect('/dashboard/churn/upload') }
