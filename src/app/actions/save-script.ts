'use server'

import { ai } from '@/ai/genkit';
import { MedicarePlan } from '@/lib/plan-data';

export async function generateSaveScript(currentPlan: MedicarePlan, newPlan: MedicarePlan, memberName: string) {
  const prompt = `You are an expert Medicare retention specialist. 
The member ${memberName} is switching from ${currentPlan.name} (Stars: ${currentPlan.star_rating}, MOOP: $${currentPlan.moop}, Benefits: ${currentPlan.key_benefits.join(', ')})
to ${newPlan.name} (Stars: ${newPlan.star_rating}, MOOP: $${newPlan.moop}, Benefits: ${newPlan.key_benefits.join(', ')}).

Write a short, professional text message (SMS) script for the broker to send to the member.
Highlight the exact downgrades (e.g., if the new plan has a lower star rating or higher MOOP or fewer benefits).
End with a polite request to call and review the switch before it locks in.
Do not use placeholders other than [Broker Name]. Keep it under 350 characters.`;

  try {
    const response = await ai.generate({ prompt });
    return response.text;
  } catch (e) {
    console.error("Genkit error", e);
    // Fallback if AI fails or API key is not configured
    let downgrades = [];
    if (newPlan.star_rating < currentPlan.star_rating) downgrades.push(`a lower Star Rating (${newPlan.star_rating} vs ${currentPlan.star_rating})`);
    if (newPlan.moop > currentPlan.moop) downgrades.push(`a higher Max Out of Pocket ($${newPlan.moop} vs $${currentPlan.moop})`);
    
    const reason = downgrades.length > 0 ? `It has ${downgrades.join(' and ')}.` : `I noticed a change to your benefits.`;
    
    return `Hi ${memberName}, I noticed your plan switch to ${newPlan.name}. ${reason} Are you sure you want to lose your current benefits? Let's chat before it locks in. - [Broker Name]`;
  }
}
