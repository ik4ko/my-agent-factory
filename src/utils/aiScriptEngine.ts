/**
 * AegisSage AI Script Generation Engine
 * src/utils/aiScriptEngine.ts
 *
 * Generates CMS-compliant, personalized Medicare retention scripts for brokers
 * using Google Gemini via the Genkit SDK.
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 * Uses the singleton `ai` instance from @/ai/genkit.ts (gemini-2.5-flash).
 * API key is configured via GOOGLE_GENAI_API_KEY environment variable.
 * If your project uses GENKIT_GOOGLE_AI_KEY instead, update src/ai/genkit.ts:
 *   import { googleAI } from '@genkit-ai/google-genai'
 *   plugins: [googleAI({ apiKey: process.env.GENKIT_GOOGLE_AI_KEY })]
 *
 * ── Output ────────────────────────────────────────────────────────────────────
 * A single Gemini call produces THREE distinct formats:
 *   1. Phone Script    — Full call script with opening, purpose, talking points,
 *                        objection handler, close, opt-out language
 *   2. SMS Draft       — ≤ 160 characters, conversational, non-pressured
 *   3. Email Template  — Subject line + professional body with disclaimer footer
 *
 * ── CMS Compliance Rails ──────────────────────────────────────────────────────
 * The system prompt enforces TPMO (Third Party Marketing Organization) rules
 * under CMS guidelines 42 CFR §422.2268 and the 2023 Marketing & Communications
 * final rule. Key prohibitions baked into the prompt:
 *   - No guaranteed savings or benefit promises
 *   - No unverified provider network claims
 *   - No competitor name disparagement
 *   - No artificial urgency or pressure-based closes
 *   - Mandatory TPMO identification disclosure
 *   - Mandatory opt-out language in phone scripts
 *   - Required "not connected with the U.S. government" disclaimer
 *   - Optional CMS "I do not offer every plan" disclaimer (plan-type restricted)
 *
 * ── PHI Policy ────────────────────────────────────────────────────────────────
 * Member first name may be passed for personalization — this is necessary for
 * the broker's outreach scripts and is covered by the broker-member relationship.
 * MBI values are NEVER passed to the AI model.
 * Doctor names, phone numbers, and addresses are NEVER passed to the AI model.
 * Plan enrollment data (carrier, plan name) is NOT clinical PHI under HIPAA
 * and is appropriate context for retention outreach.
 */

import { ai } from '@/ai/genkit'

// ── Input types ───────────────────────────────────────────────────────────────

/**
 * Sanitized member context passed to the AI.
 * Contains enrollment/plan data only — no MBI, no doctor info, no addresses.
 */
export interface MemberContext {
  /** Member's first name — used for script personalization */
  firstName:           string
  /** Current enrolled carrier name (e.g. "Humana", "Aetna") */
  currentCarrier:      string
  /** Current enrolled plan name (e.g. "Humana Gold Plus H5619-061") */
  currentPlan:         string
  /** Carrier the member is switching TO (from MARx detection) */
  detectedCarrier:     string | null
  /** Plan the member is switching TO (from MARx detection) */
  detectedPlan:        string | null
  /** Scheduled future plan (from pending switch) */
  futurePlan:          string | null
  /** When the future plan takes effect — ISO date string or null */
  futureEffectiveDate: string | null
  /** active | termed | pending_switch | switching | disenrolled */
  enrollmentStatus:    string
  /** verified | missing | changed | pending_switch | termed | unverified */
  verificationStatus:  string
  /** True if the switch alert has a future effective date (CRITICAL_PENDING) */
  isCriticalPending:   boolean
  /** True if the member is in a D-SNP or dual-eligible plan */
  isDsnpEligible:      boolean
}

/**
 * Alert context that triggered this script generation request.
 * Enriches the AI with why the broker is reaching out.
 */
export interface AlertContext {
  /** alert_type from switch_alerts (e.g. "plan_switch", "carrier_switch") */
  alertType:       string
  /** switch_type from switch_alerts (e.g. "future_plan_change", "termed") */
  switchType:      string | null
  /** critical | high | medium | low */
  priority:        string
  /** When the switch takes effect — ISO date string or null */
  effectiveDate:   string | null
  /** How this was detected — "roster_upload" | "marx_check" | "extension" */
  detectionSource: string
  /** Confidence score 0–100 from the detection engine */
  confidenceScore: number | null
}

/**
 * Agency and broker settings that control compliance behaviour.
 */
export interface AgencyContext {
  /** Full agency name for broker identification */
  agencyName:            string
  /** Broker's first name for script personalization */
  brokerFirstName:       string
  /** Broker's last name */
  brokerLastName:        string
  /** Broker's NPN — used in the TPMO disclosure */
  brokerNpn:             string | null
  /**
   * Whether to include the full CMS "I do not offer every plan" disclaimer.
   * Required for brokers with limited plan portfolios or in certain states.
   * Always true for enterprise agencies per CMS TPMO rules.
   */
  requiresFullCmsDisclaimer: boolean
  /**
   * State(s) where the broker is licensed — used in the disclaimer
   * "plans I offer in your area" context.
   */
  statesLicensed:        string[]
  /**
   * Whether the agency's subscription tier permits AI script generation.
   * Route handler validates this before calling the engine.
   */
  tier:                  string
}

// ── Output type ───────────────────────────────────────────────────────────────

export interface GeneratedRetentionScripts {
  /** Full broker call script — opening through close with opt-out */
  phoneScript:     string
  /** ≤ 160 character text message draft */
  smsDraft:        string
  /**
   * Email template with subject line.
   * Format: "SUBJECT: [subject line]\n\n[body]"
   */
  emailTemplate:   string
  /** Which CMS disclaimer was included */
  disclaimerUsed:  'full_tpmo' | 'standard' | 'none'
  /** Raw model output for debugging */
  rawResponse:     string
  generatedAt:     string
  modelUsed:       string
}

// ── Section parser ────────────────────────────────────────────────────────────

/**
 * Extracts a labelled section from the AI response.
 * Sections are wrapped in ===SECTION_NAME=== markers.
 */
function extractSection(raw: string, sectionName: string): string {
  const start = `===BEGIN_${sectionName}===`
  const end   = `===END_${sectionName}===`
  const startIdx = raw.indexOf(start)
  const endIdx   = raw.indexOf(end)
  if (startIdx === -1 || endIdx === -1) return ''
  return raw.slice(startIdx + start.length, endIdx).trim()
}

// ── System prompt builder ─────────────────────────────────────────────────────

/**
 * Builds the complete structured system prompt for the Gemini model.
 *
 * The prompt is designed in three layers:
 *   1. ROLE DEFINITION — who the AI is and what it must never do
 *   2. MEMBER CONTEXT — the facts the AI has to work with
 *   3. OUTPUT SPECIFICATION — the exact format and section markers required
 *
 * The compliance rails are positioned FIRST (before context) to prime the
 * model to apply them throughout all three output formats.
 */
function buildSystemPrompt(
  member:  MemberContext,
  alert:   AlertContext | null,
  agency:  AgencyContext,
): string {
  // ── Compute the switch situation label ──────────────────────────────────────
  const switchLabel = (() => {
    if (alert?.switchType === 'future_plan_change' || member.isCriticalPending) {
      const eff = member.futureEffectiveDate ?? alert?.effectiveDate
      return `CRITICAL PENDING: The member has a scheduled plan switch to "${member.futurePlan ?? 'an unknown plan'}"` +
             (eff ? ` effective ${eff}` : '') + '. This change has NOT taken effect yet — intervention window is OPEN.'
    }
    if (alert?.switchType === 'termed' || member.enrollmentStatus === 'termed') {
      return 'TERMED: The member has already left their Medicare Advantage plan. ' +
             'Focus on re-engagement options during Special Enrollment Period (SEP).'
    }
    if (member.detectedPlan && member.detectedPlan !== member.currentPlan) {
      return `CARRIER SWITCH DETECTED: MARx data shows the member is now on ` +
             `"${member.detectedPlan}" (${member.detectedCarrier ?? 'new carrier'}) ` +
             `instead of their original "${member.currentPlan}".`
    }
    return 'MONITORING: The member is active but flagged for proactive retention outreach.'
  })()

  // ── Full TPMO disclaimer text ────────────────────────────────────────────────
  const fullCmsDisclaimer = agency.requiresFullCmsDisclaimer
    ? `MANDATORY CMS TPMO DISCLOSURE (must appear verbatim in phone script and email):
"I am not connected with or endorsed by the U.S. government or the federal Medicare program. ` +
      `I do not offer every plan available in your area. Any information I provide is limited to those plans I do offer in your area. ` +
      `Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options."`
    : `STANDARD IDENTIFICATION DISCLOSURE (must appear in all formats):
"I am not connected with or endorsed by the U.S. government or the federal Medicare program."`

  const disclaimerLabel = agency.requiresFullCmsDisclaimer ? 'full_tpmo' : 'standard'

  // ── Detection confidence framing ─────────────────────────────────────────────
  const confidenceNote = alert?.confidenceScore !== null && alert?.confidenceScore !== undefined
    ? `Detection confidence: ${alert.confidenceScore}/100 — ${
        alert.confidenceScore >= 80
          ? 'HIGH confidence. Present information assertively.'
          : alert.confidenceScore >= 50
            ? 'MEDIUM confidence. Frame as "I want to verify your coverage is correct."'
            : 'LOW confidence. Frame as a routine courtesy check — do NOT assume the switch occurred.'
      }`
    : 'Detection confidence: unknown — use a cautious verification framing.'

  // ── Assemble the full prompt ─────────────────────────────────────────────────
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║           AEGISSAGE AI RETENTION SCRIPT ENGINE — SYSTEM INSTRUCTIONS        ║
╚══════════════════════════════════════════════════════════════════════════════╝

ROLE:
You are a CMS-compliant Medicare retention script generator for AegisSage,
a licensed broker platform operating under 42 CFR §422.2268 and the 2023
CMS Marketing & Communications final rule.

Your purpose is to help licensed Medicare insurance brokers retain members
who are at risk of switching plans, through advisory and educational outreach.
You are NOT a sales tool. You are a compliance-first communication assistant.

══════════════════════════════════════════════════════════════════════════════
SECTION 1 — ABSOLUTE PROHIBITIONS (NEVER INCLUDE IN ANY SCRIPT FORMAT)
══════════════════════════════════════════════════════════════════════════════

The following are STRICTLY FORBIDDEN. Any script containing these will be
rejected by our compliance engine and flagged for regulatory review:

1. SAVINGS PROMISES
   ✗ "You'll save money"
   ✗ "This plan costs less"
   ✗ "You could save $X per month"
   ✗ Any specific dollar amount promise unless it is a documented plan feature

2. UNVERIFIED NETWORK CLAIMS
   ✗ "Your doctor is in network"
   ✗ "All your specialists are covered"
   ✗ "You won't need a referral"
   ✗ ANY provider network claim — the broker has not verified network status

3. COMPETITOR DISPARAGEMENT
   ✗ Naming any competing carrier or plan negatively
   ✗ "That plan is worse than yours"
   ✗ Any comparative quality claim about a competitor

4. ARTIFICIAL URGENCY / PRESSURE TACTICS
   ✗ "You must act now or lose your benefits"
   ✗ "This is your last chance"
   ✗ "Today only" or any time pressure that isn't CMS-verified (e.g., AEP end date)
   ✗ "If you don't call back, I can't help you"

5. UNVERIFIED BENEFIT CLAIMS
   ✗ "This plan includes dental/vision/hearing for free" (unless confirmed)
   ✗ Any benefit described without the qualifier "according to your current plan documentation"
   ✗ "$0 premium" unless confirmed from the detected plan data below

6. GUARANTEE LANGUAGE
   ✗ "I guarantee your coverage won't change"
   ✗ "You're definitely approved"
   ✗ Any form of coverage guarantee

══════════════════════════════════════════════════════════════════════════════
SECTION 2 — MANDATORY COMPLIANCE REQUIREMENTS (MUST APPEAR IN EVERY FORMAT)
══════════════════════════════════════════════════════════════════════════════

${fullCmsDisclaimer}

BROKER IDENTIFICATION (required at the start of every format):
The broker MUST identify themselves, their name, and their agency name
within the first 30 seconds of a phone call / first paragraph of email /
in the SMS signature. Never begin outreach anonymously.

OPT-OUT LANGUAGE (required in phone script and email):
Include this exact phrase or close equivalent:
"If you'd prefer I don't contact you about your Medicare coverage,
I completely understand — just let me know and I'll note that in your file."

EDUCATIONAL TONE:
Every script must position the broker as the member's advocate and advisor,
NOT as a salesperson. The broker is CHECKING IN, VERIFYING, and INFORMING —
not pitching, closing, or upselling.

══════════════════════════════════════════════════════════════════════════════
SECTION 3 — MEMBER & ALERT CONTEXT
══════════════════════════════════════════════════════════════════════════════

MEMBER INFORMATION:
- First Name:          ${member.firstName || 'the member'}
- Current Carrier:     ${member.currentCarrier || 'Unknown'}
- Current Plan:        ${member.currentPlan || 'Unknown'}
- Enrollment Status:   ${member.enrollmentStatus || 'Unknown'}
- D-SNP / Dual Eligible: ${member.isDsnpEligible ? 'YES — member is in a Special Needs Plan. Be especially careful about continuity of care language.' : 'No'}

DETECTED SITUATION:
${switchLabel}

${member.detectedPlan ? `DETECTED DESTINATION PLAN: "${member.detectedPlan}" (${member.detectedCarrier ?? 'carrier unknown'})` : ''}
${member.futurePlan ? `SCHEDULED FUTURE PLAN: "${member.futurePlan}"${member.futureEffectiveDate ? ` — effective ${member.futureEffectiveDate}` : ''}` : ''}

${confidenceNote}

ALERT DETAILS:
- Alert Type:    ${alert?.alertType ?? 'proactive_outreach'}
- Priority:      ${alert?.priority ?? 'standard'}
- Detected Via:  ${alert?.detectionSource ?? 'system monitoring'}

BROKER IDENTITY:
- Broker Name:  ${agency.brokerFirstName} ${agency.brokerLastName}
- Agency:       ${agency.agencyName}
- NPN:          ${agency.brokerNpn ?? 'on file'}
- Licensed in:  ${agency.statesLicensed.join(', ') || 'your state'}

══════════════════════════════════════════════════════════════════════════════
SECTION 4 — WRITING GUIDELINES
══════════════════════════════════════════════════════════════════════════════

PHONE SCRIPT (target: 250–350 words when read aloud, approx 2–2.5 minutes):
- Structure: Opening → Identification → Purpose → Talking Points (2–3) → Objection Handler → Soft Close → Opt-Out Offer → Next Step
- Use natural, conversational language — not corporate or robotic
- Include realistic pauses and listener acknowledgements ("I know this can be confusing...")
- The broker should LISTEN as much as they speak — include cues like "(pause for response)"
- Do NOT script the entire call as a monologue

SMS DRAFT (STRICT 160 CHARACTER MAXIMUM including spaces and punctuation):
- Conversational and warm — not clinical or bureaucratic
- Must include the broker's first name as a signature
- NEVER ask for personal information via SMS
- Do NOT include links to external sites
- Must feel like it came from a person, not an automated system
- Count characters carefully — 160 is the hard limit

EMAIL TEMPLATE (target: 200–300 words in body):
- Subject line MUST be specific and non-clickbait (e.g., "About Your [Carrier] Medicare Plan")
- Opening: warm, personal, references the relationship
- Body: educational context about why the broker is reaching out
- Include the full CMS disclaimer in the footer
- Clear single call-to-action (call or schedule a call)
- Professional closing with broker name, NPN, and agency

══════════════════════════════════════════════════════════════════════════════
SECTION 5 — OUTPUT FORMAT SPECIFICATION (FOLLOW EXACTLY)
══════════════════════════════════════════════════════════════════════════════

You MUST output all three formats in a single response using EXACTLY these
section markers. Do not add any text outside the markers. Do not summarize
or add a preamble. Begin immediately with the first marker.

DISCLAIMER_USED: ${disclaimerLabel}

===BEGIN_PHONE_SCRIPT===
[Full phone call script here]
===END_PHONE_SCRIPT===

===BEGIN_SMS_DRAFT===
[SMS text here — 160 characters MAXIMUM]
===END_SMS_DRAFT===

===BEGIN_EMAIL_TEMPLATE===
SUBJECT: [Email subject line here]

[Full email body here including footer disclaimer]
===END_EMAIL_TEMPLATE===
`.trim()
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate CMS-compliant Medicare retention scripts in three formats.
 *
 * @param memberData   Sanitized member enrollment context (no MBI, no PHI)
 * @param alertData    Switch alert context (may be null for proactive outreach)
 * @param agencySettings  Agency and broker identity for compliance disclosure
 * @returns  Three formatted scripts plus metadata
 * @throws   Error if the AI model fails after one retry
 *
 * PHI handling:
 *   - Member first name is included for personalization (broker-member context)
 *   - MBI, doctor info, addresses are NEVER passed to this function or the model
 *   - Call sites are responsible for stripping PHI before constructing MemberContext
 */
export async function generateRetentionScript(
  memberData:     MemberContext,
  alertData:      AlertContext | null,
  agencySettings: AgencyContext,
): Promise<GeneratedRetentionScripts> {
  const prompt    = buildSystemPrompt(memberData, alertData, agencySettings)
  const startedAt = new Date().toISOString()

  // ── Primary attempt ────────────────────────────────────────────────────────
  let rawResponse: string
  let modelUsed = 'googleai/gemini-2.5-flash'

  try {
    const result = await ai.generate({
      prompt,
      config: {
        // Temperature 0.4: low enough for consistent compliance language,
        // high enough for natural, non-robotic script variation.
        temperature:    0.4,
        // maxOutputTokens: generous cap to ensure all three formats are complete.
        maxOutputTokens: 2048,
        // topP / topK defaults are appropriate for this use case.
      },
    })
    rawResponse = result.text ?? ''
  } catch (primaryErr) {
    // ── Single automatic retry with a 2-second back-off ─────────────────────
    console.warn('[aiScriptEngine] primary generation failed, retrying:', primaryErr)
    await new Promise(r => setTimeout(r, 2_000))

    try {
      const retryResult = await ai.generate({ prompt })
      rawResponse = retryResult.text ?? ''
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      throw new Error(`AI script generation failed after retry: ${msg}`)
    }
  }

  // ── Parse the three sections ───────────────────────────────────────────────
  const phoneScript   = extractSection(rawResponse, 'PHONE_SCRIPT')
  const smsDraft      = extractSection(rawResponse, 'SMS_DRAFT')
  const emailTemplate = extractSection(rawResponse, 'EMAIL_TEMPLATE')

  // ── Validate section presence ──────────────────────────────────────────────
  // If any section is empty the model didn't follow the format spec.
  // Return what we have with a warning rather than throwing — partial scripts
  // are better than a complete failure for the broker.
  if (!phoneScript && !smsDraft && !emailTemplate) {
    console.error('[aiScriptEngine] model did not follow section format — raw response:',
      rawResponse.slice(0, 200))
    throw new Error('AI model returned an unstructured response. Please try again.')
  }

  if (!phoneScript) console.warn('[aiScriptEngine] PHONE_SCRIPT section missing from response')
  if (!smsDraft)    console.warn('[aiScriptEngine] SMS_DRAFT section missing from response')
  if (!emailTemplate) console.warn('[aiScriptEngine] EMAIL_TEMPLATE section missing from response')

  // ── SMS length guard ────────────────────────────────────────────────────────
  // Truncate at word boundary if the model exceeded the 160-char limit.
  const rawSms = smsDraft || ''
  const safeSms = rawSms.length <= 160
    ? rawSms
    : rawSms.slice(0, 157).replace(/\s\S+$/, '') + '...'

  // ── Compliance post-check ──────────────────────────────────────────────────
  // Lightweight scan for the most critical prohibited phrases.
  // This is a defence-in-depth check — the primary control is the prompt.
  const prohibitedPhrases = [
    "you'll save", "you will save", "save money", "costs less",
    "your doctor is in network", "all your doctors", "your providers are covered",
    "you must act now", "last chance", "today only",
    "i guarantee", "guaranteed coverage", "definitely approved",
  ]

  const combinedOutput = (phoneScript + smsDraft + emailTemplate).toLowerCase()
  const violations = prohibitedPhrases.filter(p => combinedOutput.includes(p))
  if (violations.length > 0) {
    console.error('[aiScriptEngine] COMPLIANCE VIOLATION in generated output:', violations)
    // In production you might want to throw here rather than return the output.
    // For now we warn and return so the broker can review — the violation log
    // will surface in monitoring.
    console.error('[aiScriptEngine] Returning output with violations for human review.')
  }

  return {
    phoneScript:    phoneScript  || '[Phone script generation failed — please retry]',
    smsDraft:       safeSms      || '[SMS draft generation failed — please retry]',
    emailTemplate:  emailTemplate || '[Email template generation failed — please retry]',
    disclaimerUsed: agencySettings.requiresFullCmsDisclaimer ? 'full_tpmo' : 'standard',
    rawResponse,
    generatedAt:    startedAt,
    modelUsed,
  }
}
