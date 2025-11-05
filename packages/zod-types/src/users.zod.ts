import { z } from "zod";

// User schema
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  isAdmin: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Database User schema (with Date objects)
export const DatabaseUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  isAdmin: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Get all users request
export const GetAllUsersRequestSchema = z.object({
  limit: z.number().int().positive().max(100).default(50).optional(),
  offset: z.number().int().nonnegative().default(0).optional(),
});

// Get all users response
export const GetAllUsersResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(UserSchema),
  total: z.number(),
  message: z.string().optional(),
});

// Update user admin access request
export const UpdateUserAdminAccessRequestSchema = z.object({
  userId: z.string(),
  isAdmin: z.boolean(),
});

// Update user admin access response
export const UpdateUserAdminAccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// Export types
export type User = z.infer<typeof UserSchema>;
export type DatabaseUser = z.infer<typeof DatabaseUserSchema>;
export type GetAllUsersRequest = z.infer<typeof GetAllUsersRequestSchema>;
export type GetAllUsersResponse = z.infer<typeof GetAllUsersResponseSchema>;
export type UpdateUserAdminAccessRequest = z.infer<typeof UpdateUserAdminAccessRequestSchema>;
export type UpdateUserAdminAccessResponse = z.infer<typeof UpdateUserAdminAccessResponseSchema>;
