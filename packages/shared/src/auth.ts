import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Emails are trimmed and lowercased so that uniqueness does not depend on case. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const signupRequestSchema = z.strictObject({
  email: emailSchema,
  name: z.string().trim().min(1, 'Name is required').max(80),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must have at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must have at most ${PASSWORD_MAX_LENGTH} characters`),
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  // No minimum here: a wrong or short password is simply "invalid credentials".
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** The public view of an account. Never contains the password hash. */
export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});

export type User = z.infer<typeof userSchema>;

/** Response of signup, login and `GET /api/auth/me`. */
export const authResponseSchema = z.object({ user: userSchema });

export type AuthResponse = z.infer<typeof authResponseSchema>;
