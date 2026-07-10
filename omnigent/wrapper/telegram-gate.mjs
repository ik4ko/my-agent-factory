// Telegram operator allowlist gate — THE FIRST logic every inbound update
// hits, deliberately written before any poller/command code existed.
//
// Contract:
//  - TELEGRAM_OPERATOR_CHAT_ID is the single allowlisted chat. Everything
//    else is SILENTLY dropped: no reply, no error to the sender, no content
//    logged — only an anonymous counter for observability.
//  - Fails CLOSED: unset/empty allowlist, malformed update, missing chat id,
//    or any extraction surprise → drop. Never throws.
//  - Chat ids compare as canonical strings (Telegram ids are int64; JSON
//    numbers near 2^53 lose precision, so String() both sides and never do
//    numeric comparison).

let droppedCount = 0;

/** The allowlisted operator chat id (trimmed), or null when unset. */
export function operatorChatId() {
  const v = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Extract the originating chat id from any update shape we might receive.
 *  Returns null when it can't be determined (→ caller drops). */
export function chatIdOf(update) {
  if (update === null || typeof update !== 'object') return null;
  const containers = [
    update.message,
    update.edited_message,
    update.channel_post,
    update.edited_channel_post,
    update.callback_query?.message,
  ];
  for (const c of containers) {
    const id = c?.chat?.id;
    if (typeof id === 'number' || typeof id === 'string') return String(id);
  }
  return null;
}

/** True only when the update verifiably originates from the operator chat.
 *  Anything else — unknown chat, unextractable chat, unset allowlist — is
 *  false, and the caller must drop the update silently. */
export function passesOperatorGate(update) {
  const allow = operatorChatId();
  if (allow === null) {
    droppedCount++;
    return false; // fail closed: no allowlist configured → nothing passes
  }
  const from = chatIdOf(update);
  if (from === null || from !== allow) {
    droppedCount++;
    return false;
  }
  return true;
}

/** Anonymous drop counter (no identities, no content) for health readouts. */
export function droppedUpdates() {
  return droppedCount;
}
