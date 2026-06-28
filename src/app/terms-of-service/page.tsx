import { redirect } from "next/navigation"

// /terms-of-service is superseded by the canonical /terms route.
// Permanent redirect preserves any inbound links and SEO equity.
export default function TermsOfServiceRedirect() {
  redirect("/terms")
}
