/**
 * Instrument Deck component library (Design System 1A).
 *
 * The reusable primitives every room composes: the signature panel chrome,
 * the control button state-set, status indicators (shape+color, a11y-safe),
 * the rose approval gate, and metadata chips. Built from the Component
 * Reference (Direction Board §1A + FleetPanel/TerminalPanel/RunCards).
 */
export { PanelChrome } from './panel-chrome';
export type { PanelChromeProps } from './panel-chrome';
export { DeckButton } from './deck-button';
export type { DeckButtonProps } from './deck-button';
export { StatusDot, StatusBadge } from './status';
export type { DeckStatus } from './status';
export { ApprovalGate } from './approval-gate';
export type { ApprovalGateProps } from './approval-gate';
export { DataChip } from './data-chip';
