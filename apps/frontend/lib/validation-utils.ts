import { ZodError, ZodIssue } from "zod";

// Type for translation function
type TranslationFunction = (
  key: string,
  params?: Record<string, any>,
) => string;

// Map of Zod issue codes to translation keys
const issueCodeToTranslationKey: Record<string, string> = {
  required_error: "validation:required",
  invalid_type: "validation:invalidFormat",
  invalid_string: "validation:invalidFormat",
  too_small: "validation:minLength",
  too_big: "validation:maxLength",
  invalid_url: "validation:urlFormat",
  invalid_email: "validation:email",
  custom: "validation:generic.invalid",
};

// Map specific validation messages to translation keys
const messageToTranslationKey: Record<string, string> = {
  "Name is required": "validation:nameRequired",
  "Server name is required": "validation:serverName.required",
  "Server name must only contain letters, numbers, underscores, and hyphens":
    "validation:serverName.invalidCharacters",
  "Server name cannot contain consecutive underscores":
    "validation:serverName.consecutiveUnderscores",
  "Command is required for stdio servers": "validation:command.required",
  "URL is required and must be valid for SSE and Streamable HTTP types":
    "validation:url.required",
  "URL is required for SSE and Streamable HTTP types":
    "validation:url.required",
  "URL must be valid for SSE and Streamable HTTP types":
    "validation:url.invalidUrl",
  "Name must be URL compatible": "validation:endpointName.urlCompatible",
  "Password must be at least 8 characters long": "validation:password.tooShort",
  "Passwords do not match": "validation:password.mismatch",
};

/**
 * Translates a single Zod issue to a localized error message
 */
export function translateZodIssue(
  issue: ZodIssue,
  t: TranslationFunction,
): string {
  // First, check if the message is already a translation key
  if (issue.message && issue.message.startsWith("validation:")) {
    return t(issue.message);
  }

  // Then, try to find a direct message translation
  if (issue.message && messageToTranslationKey[issue.message]) {
    const translationKey = messageToTranslationKey[issue.message]!;
    return t(translationKey);
  }

  // Handle specific issue codes with parameters
  switch (issue.code) {
    case "too_small":
      if (issue.type === "string") {
        return t("validation:minLength", { min: issue.minimum });
      }
      break;
    case "too_big":
      if (issue.type === "string") {
        return t("validation:maxLength", { max: issue.maximum });
      }
      break;
    case "invalid_string":
      if (issue.validation === "email") {
        return t("validation:email");
      }
      if (issue.validation === "url") {
        return t("validation:urlFormat");
      }
      break;
    case "custom":
      // Handle custom validation messages
      if (issue.message && messageToTranslationKey[issue.message]) {
        return t(messageToTranslationKey[issue.message]!);
      }
      break;
  }

  // Fall back to issue code translation
  const translationKey = issueCodeToTranslationKey[issue.code];
  if (translationKey) {
    return t(translationKey);
  }

  // Ultimate fallback - return the original message or a generic error
  return issue.message || t("validation:generic.invalid");
}

/**
 * Translates all errors in a ZodError to localized messages
 */
export function translateZodError(
  error: ZodError,
  t: TranslationFunction,
): Record<string, string> {
  const translatedErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const fieldPath = issue.path.join(".");
    const translatedMessage = translateZodIssue(issue, t);

    // If there's already an error for this field, append to it
    if (translatedErrors[fieldPath]) {
      translatedErrors[fieldPath] += "; " + translatedMessage;
    } else {
      translatedErrors[fieldPath] = translatedMessage;
    }
  }

  return translatedErrors;
}

/**
 * Utility to get a translated error message for a specific field from a ZodError
 */
export function getTranslatedFieldError(
  error: ZodError | null,
  fieldName: string,
  t: TranslationFunction,
): string | undefined {
  if (!error) return undefined;

  const issue = error.issues.find(
    (issue) => issue.path.join(".") === fieldName,
  );

  if (!issue) return undefined;

  return translateZodIssue(issue, t);
}
