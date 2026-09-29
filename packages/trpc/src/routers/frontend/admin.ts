import {
  type AccessPrincipal,
  AddGroupMembersRequestSchema,
  type AdminMutationResponse,
  AdminMutationResponseSchema,
  type AdminUser,
  AdminUserSchema,
  CreateGroupRequestSchema,
  CreateUserRequestSchema,
  DeleteUserRequestSchema,
  type EncryptionStatus,
  EncryptionStatusSchema,
  type ExportActivityResponse,
  ExportActivityResponseSchema,
  type Group,
  type GroupDetail,
  GroupDetailSchema,
  GroupSchema,
  GroupUuidRequestSchema,
  type ListActivityRequest,
  ListActivityRequestSchema,
  type ListActivityResponse,
  ListActivityResponseSchema,
  ListUsersRequestSchema,
  type ListUsersResponse,
  ListUsersResponseSchema,
  RemoveGroupMemberRequestSchema,
  type RolePermissions,
  RolePermissionsSchema,
  type RotateDataKeyResponse,
  RotateDataKeyResponseSchema,
  SetUserDisabledRequestSchema,
  SetUserPasswordRequestSchema,
  type SsoSettings,
  SsoSettingsSchema,
  TestSsoMappingRequestSchema,
  type TestSsoMappingResponse,
  TestSsoMappingResponseSchema,
  UpdateGroupRequestSchema,
  UpdateSsoSettingsRequestSchema,
  UpdateUserRequestSchema,
  UserIdRequestSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, router } from "../../trpc";

type Impl<I, O> = (input: I, principal: AccessPrincipal) => Promise<O>;

export const createAdminRouter = (implementations: {
  users: {
    list: Impl<z.infer<typeof ListUsersRequestSchema>, ListUsersResponse>;
    get: Impl<z.infer<typeof UserIdRequestSchema>, AdminUser | null>;
    create: Impl<
      z.infer<typeof CreateUserRequestSchema>,
      AdminMutationResponse
    >;
    update: Impl<
      z.infer<typeof UpdateUserRequestSchema>,
      AdminMutationResponse
    >;
    setPassword: Impl<
      z.infer<typeof SetUserPasswordRequestSchema>,
      AdminMutationResponse
    >;
    setDisabled: Impl<
      z.infer<typeof SetUserDisabledRequestSchema>,
      AdminMutationResponse
    >;
    revokeSessions: Impl<
      z.infer<typeof UserIdRequestSchema>,
      AdminMutationResponse
    >;
    delete: Impl<
      z.infer<typeof DeleteUserRequestSchema>,
      AdminMutationResponse
    >;
  };
  groups: {
    list: (principal: AccessPrincipal) => Promise<Group[]>;
    get: Impl<z.infer<typeof GroupUuidRequestSchema>, GroupDetail | null>;
    create: Impl<
      z.infer<typeof CreateGroupRequestSchema>,
      AdminMutationResponse & { uuid?: string }
    >;
    update: Impl<
      z.infer<typeof UpdateGroupRequestSchema>,
      AdminMutationResponse
    >;
    delete: Impl<z.infer<typeof GroupUuidRequestSchema>, AdminMutationResponse>;
    addMembers: Impl<
      z.infer<typeof AddGroupMembersRequestSchema>,
      AdminMutationResponse
    >;
    removeMember: Impl<
      z.infer<typeof RemoveGroupMemberRequestSchema>,
      AdminMutationResponse
    >;
  };
  roles: {
    getPermissions: () => Promise<RolePermissions>;
    setPermissions: Impl<RolePermissions, AdminMutationResponse>;
  };
  sso: {
    getSettings: () => Promise<SsoSettings>;
    updateSettings: Impl<
      z.infer<typeof UpdateSsoSettingsRequestSchema>,
      AdminMutationResponse
    >;
    testMapping: Impl<
      z.infer<typeof TestSsoMappingRequestSchema>,
      TestSsoMappingResponse
    >;
  };
  activity: {
    list: Impl<ListActivityRequest, ListActivityResponse>;
    export: Impl<ListActivityRequest, ExportActivityResponse>;
  };
  security: {
    getEncryptionStatus: () => Promise<EncryptionStatus>;
    rotateDataKey: (
      principal: AccessPrincipal,
    ) => Promise<RotateDataKeyResponse>;
  };
}) =>
  router({
    users: router({
      list: adminProcedure
        .input(ListUsersRequestSchema)
        .output(ListUsersResponseSchema)
        .query(({ input, ctx }) =>
          implementations.users.list(input, ctx.principal),
        ),
      get: adminProcedure
        .input(UserIdRequestSchema)
        .output(AdminUserSchema.nullable())
        .query(({ input, ctx }) =>
          implementations.users.get(input, ctx.principal),
        ),
      create: adminProcedure
        .input(CreateUserRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.users.create(input, ctx.principal),
        ),
      update: adminProcedure
        .input(UpdateUserRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.users.update(input, ctx.principal),
        ),
      setPassword: adminProcedure
        .input(SetUserPasswordRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.users.setPassword(input, ctx.principal),
        ),
      setDisabled: adminProcedure
        .input(SetUserDisabledRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.users.setDisabled(input, ctx.principal),
        ),
      revokeSessions: adminProcedure
        .input(UserIdRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.users.revokeSessions(input, ctx.principal),
        ),
      delete: adminProcedure
        .input(DeleteUserRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.users.delete(input, ctx.principal),
        ),
    }),

    groups: router({
      list: adminProcedure
        .output(z.array(GroupSchema))
        .query(({ ctx }) => implementations.groups.list(ctx.principal)),
      get: adminProcedure
        .input(GroupUuidRequestSchema)
        .output(GroupDetailSchema.nullable())
        .query(({ input, ctx }) =>
          implementations.groups.get(input, ctx.principal),
        ),
      create: adminProcedure
        .input(CreateGroupRequestSchema)
        .output(
          AdminMutationResponseSchema.extend({ uuid: z.string().optional() }),
        )
        .mutation(({ input, ctx }) =>
          implementations.groups.create(input, ctx.principal),
        ),
      update: adminProcedure
        .input(UpdateGroupRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.groups.update(input, ctx.principal),
        ),
      delete: adminProcedure
        .input(GroupUuidRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.groups.delete(input, ctx.principal),
        ),
      addMembers: adminProcedure
        .input(AddGroupMembersRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.groups.addMembers(input, ctx.principal),
        ),
      removeMember: adminProcedure
        .input(RemoveGroupMemberRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.groups.removeMember(input, ctx.principal),
        ),
    }),

    roles: router({
      getPermissions: adminProcedure
        .output(RolePermissionsSchema)
        .query(() => implementations.roles.getPermissions()),
      setPermissions: adminProcedure
        .input(RolePermissionsSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.roles.setPermissions(input, ctx.principal),
        ),
    }),

    sso: router({
      getSettings: adminProcedure
        .output(SsoSettingsSchema)
        .query(() => implementations.sso.getSettings()),
      updateSettings: adminProcedure
        .input(UpdateSsoSettingsRequestSchema)
        .output(AdminMutationResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.sso.updateSettings(input, ctx.principal),
        ),
      testMapping: adminProcedure
        .input(TestSsoMappingRequestSchema)
        .output(TestSsoMappingResponseSchema)
        .mutation(({ input, ctx }) =>
          implementations.sso.testMapping(input, ctx.principal),
        ),
    }),

    activity: router({
      list: adminProcedure
        .input(ListActivityRequestSchema)
        .output(ListActivityResponseSchema)
        .query(({ input, ctx }) =>
          implementations.activity.list(input, ctx.principal),
        ),
      export: adminProcedure
        .input(ListActivityRequestSchema)
        .output(ExportActivityResponseSchema)
        .query(({ input, ctx }) =>
          implementations.activity.export(input, ctx.principal),
        ),
    }),

    security: router({
      getEncryptionStatus: adminProcedure
        .output(EncryptionStatusSchema)
        .query(() => implementations.security.getEncryptionStatus()),
      rotateDataKey: adminProcedure
        .output(RotateDataKeyResponseSchema)
        .mutation(({ ctx }) =>
          implementations.security.rotateDataKey(ctx.principal),
        ),
    }),
  });
