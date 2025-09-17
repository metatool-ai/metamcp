import { eq } from "drizzle-orm";

import { db } from "../index";
import { usersTable } from "../schema";

export interface UserCreateInput {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string;
}

export interface DatabaseUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class UsersRepository {
  async getById(userId: string): Promise<DatabaseUser | null> {
    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    return result[0] || null;
  }

  async getByEmail(email: string): Promise<DatabaseUser | null> {
    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return result[0] || null;
  }

  async create(input: UserCreateInput): Promise<DatabaseUser> {
    const [createdUser] = await db
      .insert(usersTable)
      .values({
        id: input.id,
        name: input.name,
        email: input.email,
        emailVerified: input.emailVerified ?? false,
        image: input.image || null,
      })
      .returning();

    if (!createdUser) {
      throw new Error("Failed to create user");
    }

    return createdUser;
  }

  async upsert(input: UserCreateInput): Promise<DatabaseUser> {
    // First check if user exists by ID
    const existingUserById = await this.getById(input.id);
    if (existingUserById) {
      return existingUserById;
    }

    // Check if user exists by email (for account linking scenarios)
    const existingUserByEmail = await this.getByEmail(input.email);
    if (existingUserByEmail) {
      // Return existing user - this handles the case where local user exists
      // but external provider has different ID. In production, you might want
      // to link accounts or handle this differently based on business logic.
      return existingUserByEmail;
    }

    return await this.create(input);
  }
}

export const usersRepository = new UsersRepository();