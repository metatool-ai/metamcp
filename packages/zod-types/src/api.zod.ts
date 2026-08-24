import { z } from "zod";

// Unified API error response schema
export const ApiErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  statusCode: z.number().optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
