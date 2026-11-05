'use client';
import { createAuthClient } from 'better-auth/react';
import { usernameClient, anonymousClient } from 'better-auth/client/plugins';
export const authClient = createAuthClient({ plugins: [usernameClient(), anonymousClient()] });
