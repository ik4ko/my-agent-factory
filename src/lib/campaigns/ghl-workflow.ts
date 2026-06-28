// GHL workflow stubs — external integration removed.
// Expose the same function signatures but return safe defaults so
// callers continue to function without network side-effects.

export interface GHLContact {
  id: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  tags?: string[]
  locationId?: string
}

export async function triggerGHLWorkflow(
  _agencyId: string,
  _ghlContactId: string,
  _workflowId: string
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'GHL integration removed' }
}

export async function addGHLTag(
  _agencyId: string,
  _ghlContactId: string | null,
  _tags: string[]
): Promise<{ success: boolean }> {
  return { success: false }
}

export async function createGHLTask(
  _agencyId: string,
  _ghlContactId: string | null,
  _task: { title: string; dueDate: string; assignedTo?: string }
): Promise<{ success: boolean; taskId?: string }> {
  return { success: false }
}

export async function moveGHLPipelineStage(
  _agencyId: string,
  _ghlContactId: string,
  _pipelineId: string,
  _stageId: string
): Promise<{ success: boolean }> {
  return { success: false }
}

export async function getGHLContact(
  _agencyId: string,
  _ghlContactId: string
): Promise<GHLContact | null> {
  return null
}
