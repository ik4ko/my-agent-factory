import { redirect } from "next/navigation"

// /privacy-policy is superseded by the canonical /privacy route.
// Permanent redirect preserves any inbound links and SEO equity.
export default function PrivacyPolicyRedirect() {
  redirect("/privacy")
}
