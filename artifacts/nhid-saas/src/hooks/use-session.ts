/**
 * Who is signed in, if anyone.
 *
 * Deliberately not `useApiKey`. That hook reads a value out of
 * `localStorage`, so it answers instantly and offline; this one has to ask the
 * server, because the session lives in an `httpOnly` cookie that no script can
 * read. The cost is one request on mount. The benefit is that an XSS flaw
 * cannot walk off with the credential.
 *
 * A 401 is the normal signed-out answer, not a failure: it resolves to `null`
 * and the UI shows a sign-in link. Anything else is a real error and is
 * surfaced, because "the API is unreachable" and "you are signed out" must not
 * look the same to someone trying to work out why they cannot get in.
 */
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { AuthError, authApi, type SessionOrg, type SessionUser } from "@/lib/auth-api";

export const SESSION_QUERY_KEY = ["auth", "me"] as const;

export type Session = { user: SessionUser; orgs: SessionOrg[] } | null;

export function useSession() {
  return useQuery<Session>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (error) {
        if (error instanceof AuthError && error.status === 401) return null;
        throw error;
      }
    },
    // Signed-in state is not worth re-fetching on every window focus; it
    // changes when someone signs in or out, and both of those invalidate it
    // explicitly below.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

/** The role this user holds in `orgId`, or null when they are not a member. */
export function roleIn(session: Session, orgId: string | undefined | null) {
  if (!session || !orgId) return null;
  return session.orgs.find((o) => o.org_id === orgId)?.role ?? null;
}
