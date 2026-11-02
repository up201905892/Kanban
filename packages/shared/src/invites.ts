import { z } from 'zod';
import { roleSchema } from './authz.js';

/** Roles an invite may grant. Ownership is given by changing a member's role, never by invite. */
export const INVITE_ROLES = ['member', 'viewer'] as const;
export const inviteRoleSchema = z.enum(INVITE_ROLES);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const INVITE_MIN_DAYS = 1;
export const INVITE_MAX_DAYS = 30;
export const INVITE_MAX_USES_LIMIT = 1000;

/** Params of the routes under `/api/workspaces/:wid/...` used by invites and members. */
export const workspaceScopedParamsSchema = z.strictObject({ wid: z.uuid() });
export const inviteParamsSchema = z.strictObject({ id: z.uuid() });
export const inviteTokenParamsSchema = z.strictObject({ token: z.string().min(1).max(200) });
export const memberParamsSchema = z.strictObject({ wid: z.uuid(), userId: z.uuid() });

export const createInviteRequestSchema = z.strictObject({
  role: inviteRoleSchema,
  expiresInDays: z.number().int().min(INVITE_MIN_DAYS).max(INVITE_MAX_DAYS),
  maxUses: z.number().int().min(1).max(INVITE_MAX_USES_LIMIT).optional(),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

/** An invite as listed to owners. The token itself is never stored or returned again. */
export const inviteSchema = z.object({
  id: z.uuid(),
  role: inviteRoleSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
});
export type Invite = z.infer<typeof inviteSchema>;

/** Response of creating an invite: the link is shown only this once. */
export const createInviteResponseSchema = z.object({ invite: inviteSchema, link: z.string() });
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

export const inviteListResponseSchema = z.object({ invites: z.array(inviteSchema) });
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;

/** What a person sees before accepting (public, token is the credential). */
export const invitePreviewSchema = z.object({
  workspaceName: z.string(),
  role: inviteRoleSchema,
  expiresAt: z.iso.datetime(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const acceptInviteResponseSchema = z.object({ workspaceId: z.uuid() });
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberResponseSchema = z.object({ member: memberSchema });
export type MemberResponse = z.infer<typeof memberResponseSchema>;

export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

export const updateMemberRequestSchema = z.strictObject({ role: roleSchema });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

/** Builds the shareable link for a token. */
export const inviteLink = (webOrigin: string, token: string): string =>
  `${webOrigin.replace(/\/+$/, '')}/invite/${token}`;
