'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { LifeContextCandidateSchema } from '@/lib/life-context/types';
import {
  confirmPendingProposal,
  discardPendingProposal,
  editPendingProposal,
  enqueueConfirmedAction,
  readLifeContext,
  setFactDisabled,
} from '@/lib/life-context/store';

async function assertOperatorSession(): Promise<void> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error('DASHBOARD_PASSWORD not configured');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, password))) throw new Error('Unauthorized: valid operator session required');
}

const IdSchema = z.string().uuid();

export async function listLifeContext() {
  await assertOperatorSession();
  return readLifeContext();
}

export async function confirmLifeContextProposal(id: string) {
  await assertOperatorSession();
  return confirmPendingProposal(IdSchema.parse(id));
}

export async function discardLifeContextProposal(id: string) {
  await assertOperatorSession();
  return discardPendingProposal(IdSchema.parse(id));
}

export async function editLifeContextProposal(id: string, candidate: unknown) {
  await assertOperatorSession();
  return editPendingProposal(IdSchema.parse(id), LifeContextCandidateSchema.parse(candidate));
}

/** Updates are proposals, never direct writes; the confirmation action performs the replacement. */
export async function updateLifeContextFact(id: string, candidate: unknown) {
  await assertOperatorSession();
  const parsed = LifeContextCandidateSchema.parse({ ...(candidate as object), operation: 'update', targetId: IdSchema.parse(id) });
  return enqueueConfirmedAction({ candidate: parsed });
}

/** Deletion creates a pending proposal; it never removes an active fact directly. */
export async function deleteLifeContextFact(id: string, candidate: unknown) {
  await assertOperatorSession();
  const parsed = LifeContextCandidateSchema.parse({ ...(candidate as object), operation: 'delete', targetId: IdSchema.parse(id) });
  return enqueueConfirmedAction({ candidate: parsed });
}

/** Privacy toggle — hides/reveals a fact to mentors immediately (direct write;
 *  disabling only reduces exposure, so it skips the proposal gate). */
export async function setLifeContextFactDisabled(id: string, disabled: boolean) {
  await assertOperatorSession();
  return setFactDisabled(IdSchema.parse(id), Boolean(disabled));
}
