import { ghlFetch } from './ghl-client'

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
  agencyId: string,
  ghlContactId: string,
  workflowId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await ghlFetch(
    agencyId,
    `/contacts/${ghlContactId}/workflow/${workflowId}`,
    { method: 'POST', body: JSON.stringify({ eventStartTime: new Date().toISOString() }) }
  )
  if (!res.ok) return { success: false, error: `GHL ${res.status}` }
  return { success: true }
}

export async function addGHLTag(
  agencyId: string,
  ghlContactId: string,
  tags: string[]
): Promise<{ success: boolean }> {
  const res = await ghlFetch(
    agencyId,
    `/contacts/${ghlContactId}/tags`,
    { method: 'PUT', body: JSON.stringify({ tags }) }
  )
  return { success: res.ok }
}

export async function createGHLTask(
  agencyId: string,
  ghlContactId: string,
  task: { title: string; dueDate: string; assignedTo?: string }
): Promise<{ success: boolean; taskId?: string }> {
  const res = await ghlFetch(
    agencyId,
    `/contacts/${ghlContactId}/tasks`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: task.title,
        dueDate: task.dueDate,
        ...(task.assignedTo ? { assignedTo: task.assignedTo } : {}),
        status: 'incompleted',
      }),
    }
  )
  if (!res.ok) return { success: false }
  const d = res.data as Record<string, unknown> | null
  return { success: true, taskId: (d as any)?.task?.id ?? undefined }
}

export async function moveGHLPipelineStage(
  agencyId: string,
  _ghlContactId: string,
  pipelineId: string,
  stageId: string
): Promise<{ success: boolean }> {
  // Requires an opportunity ID — caller must pass it via pipelineId field as "opportunityId:pipelineId:stageId"
  const [opportunityId] = pipelineId.split(':')
  if (!opportunityId) return { success: false }
  const res = await ghlFetch(
    agencyId,
    `/opportunities/${opportunityId}/stage`,
    { method: 'PUT', body: JSON.stringify({ stageId }) }
  )
  return { success: res.ok }
}

export async function getGHLContact(
  agencyId: string,
  ghlContactId: string
): Promise<GHLContact | null> {
  const res = await ghlFetch(agencyId, `/contacts/${ghlContactId}`)
  if (!res.ok) return null
  const d = res.data as Record<string, unknown> | null
  return (d?.contact ?? d) as GHLContact | null
}
