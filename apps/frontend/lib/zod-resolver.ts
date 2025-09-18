import { ZodError, ZodSchema } from "zod";

import { translateZodError } from "./validation-utils";

// Type for translation function
type TranslationFunction = (
  key: string,
  params?: Record<string, any>,
) => string;

/**
 * Creates a Zod resolver that translates validation error messages
 */
export function createTranslatedZodResolver<T extends ZodSchema>(
  schema: T,
  t: TranslationFunction,
) {
  return (data: any) => {
    try {
      // Parse the data with the schema
      const result = schema.parse(data);
      return { values: result, errors: {} };
    } catch (error) {
      if (error instanceof ZodError) {
        // Translate the Zod errors
        const translatedErrors = translateZodError(error, t);

        // Convert to react-hook-form format
        const formErrors: Record<string, { type: string; message: string }> =
          {};

        for (const [field, message] of Object.entries(translatedErrors)) {
          formErrors[field] = {
            type: "validation",
            message: message,
          };
        }

        return { values: {}, errors: formErrors };
      }

      // Re-throw non-Zod errors
      throw error;
    }
  };
}
