import { eq } from "drizzle-orm";

import { db } from "../index";
import { configTable } from "../schema";

export const configRepo = {
  async getConfig(
    id: string,
  ): Promise<
    { id: string; value: string; description?: string | null } | undefined
  > {
    const result = await db
      .select()
      .from(configTable)
      .where(eq(configTable.id, id));
    return result[0];
  },

  async setConfig(
    id: string,
    value: string,
    description?: string,
  ): Promise<void> {
    await db
      .insert(configTable)
      .values({
        id,
        value,
        description,
      })
      .onConflictDoUpdate({
        target: configTable.id,
        set: {
          value,
          description,
          updated_at: new Date(),
        },
      });
  },

  async getAllConfigs(): Promise<
    Array<{ id: string; value: string; description?: string | null }>
  > {
    return await db.select().from(configTable);
  },

  async deleteConfig(id: string): Promise<void> {
    await db.delete(configTable).where(eq(configTable.id, id));
  },
};
