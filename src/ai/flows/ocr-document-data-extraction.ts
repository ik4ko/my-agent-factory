'use server';
/**
 * @fileOverview This file contains the Genkit flow for OCR-based document data extraction.
 *
 * - ocrDocumentDataExtraction - A function that handles the OCR and data extraction process from an image of an ID or policy document.
 * - OcrDocumentDataExtractionInput - The input type for the ocrDocumentDataExtraction function.
 * - OcrDocumentDataExtractionOutput - The return type for the ocrDocumentDataExtraction function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

// Define the input schema for the OCR document data extraction flow.
const OcrDocumentDataExtractionInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a client's ID or policy document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type OcrDocumentDataExtractionInput = z.infer<typeof OcrDocumentDataExtractionInputSchema>;

// Define the output schema for the OCR document data extraction flow.
const OcrDocumentDataExtractionOutputSchema = z.object({
  extractedData: z.object({
    documentType: z.string().optional().describe("The type of document identified (e.g., 'Driver's License', 'Passport', 'Insurance Policy')."),
    fullName: z.string().optional().describe("The full name of the person or entity on the document."),
    firstName: z.string().optional().describe("The first name of the person on the document."),
    lastName: z.string().optional().describe("The last name of the person on the document."),
    address: z.string().optional().describe("The primary address mentioned on the document."),
    dateOfBirth: z.string().optional().describe("The date of birth in YYYY-MM-DD format if present."),
    documentNumber: z.string().optional().describe("The primary identification number (e.g., driver's license number, passport number, policy number)."),
    issueDate: z.string().optional().describe("The issue date of the document in YYYY-MM-DD format."),
    expirationDate: z.string().optional().describe("The expiration date of the document in YYYY-MM-DD format."),
    gender: z.string().optional().describe("The gender of the individual, if explicitly stated on the document."),
    insurerName: z.string().optional().describe("The name of the insurance company, if applicable."),
    policyEffectiveDate: z.string().optional().describe("The effective date of the insurance policy in YYYY-MM-DD format, if applicable."),
    policyExpirationDate: z.string().optional().describe("The expiration date of the insurance policy in YYYY-MM-DD format, if applicable."),
    otherRelevantDetails: z.record(z.string(), z.string()).optional().describe("Any other relevant key-value pairs extracted from the document that aren't covered by specific fields."),
  }).describe("Structured data extracted from the document using OCR."),
});
export type OcrDocumentDataExtractionOutput = z.infer<typeof OcrDocumentDataExtractionOutputSchema>;

export async function ocrDocumentDataExtraction(input: OcrDocumentDataExtractionInput): Promise<OcrDocumentDataExtractionOutput> {
  return ocrDocumentDataExtractionFlow(input);
}

// Define the prompt for OCR data extraction.
const ocrPrompt = ai.definePrompt({
  name: 'ocrDocumentDataExtractionPrompt',
  input: {schema: OcrDocumentDataExtractionInputSchema},
  output: {schema: OcrDocumentDataExtractionOutputSchema},
  model: googleAI.model('gemini-1.5-flash-latest'), // Using Gemini 1.5 Flash for multimodal capabilities
  prompt: `You are an expert OCR system designed to extract structured information from images of identification documents (IDs) or insurance policy documents.
Carefully analyze the provided image and extract all relevant information.
Populate the output JSON schema with the extracted data.
Ensure that dates are extracted and formatted as YYYY-MM-DD.
If a field is not found in the document, omit it from the JSON output.

Image: {{media url=photoDataUri}}`,
});

// Define the Genkit flow for OCR document data extraction.
const ocrDocumentDataExtractionFlow = ai.defineFlow(
  {
    name: 'ocrDocumentDataExtractionFlow',
    inputSchema: OcrDocumentDataExtractionInputSchema,
    outputSchema: OcrDocumentDataExtractionOutputSchema,
  },
  async (input) => {
    const {output} = await ocrPrompt(input);
    if (!output) {
      throw new Error('Failed to extract data from document.');
    }
    return output;
  }
);
