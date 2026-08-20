import {
  NOT_ADMIN_ERR_MSG,
  NOT_STAFF_ERR_MSG,
  UNAUTHED_ERR_MSG,
} from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { UserRole } from "@shared/domain";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

/**
 * Unauthenticated. Reserved for the three surfaces that genuinely have no
 * session: the public partner intake form, the health probe, and the auth
 * endpoints themselves. Everything else must use one of the procedures below —
 * operational data is not public.
 */
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Any signed-in account, including `partner`. */
export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Builds a middleware that requires the signed-in user to hold one of `roles`.
 * Runs after `requireUser` so an anonymous caller gets 401 (login will help)
 * rather than 403 (login will not help).
 */
function requireRole(roles: readonly UserRole[], message: string) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    if (!roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * Internal operators: `admin` or `consultant`. This is the default for the
 * Shadow Pilot workspace — partner records, inboxes, evaluations, knowledge
 * authoring, calendar, and competitive intelligence.
 */
export const staffProcedure = t.procedure.use(
  requireRole(["admin", "consultant"], NOT_STAFF_ERR_MSG)
);

/**
 * `admin` only. Destructive or configuration-level actions: deleting stored
 * records, editing organization settings, reseeding.
 */
export const adminProcedure = t.procedure.use(
  requireRole(["admin"], NOT_ADMIN_ERR_MSG)
);
