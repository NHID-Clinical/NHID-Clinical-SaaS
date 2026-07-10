import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttpModule from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { db, sessionsTable } from "@workspace/db";
import { lt } from "drizzle-orm";

const pinoHttp = pinoHttpModule as unknown as (options: unknown) => RequestHandler;

type SerializedRequest = {
  id?: string | number;
  method?: string;
  url?: string;
};

type SerializedResponse = {
  statusCode?: number;
};

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: SerializedRequest) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: SerializedResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

// ── Expired session cleanup ───────────────────────────────────────────────────
async function purgeExpiredSessions() {
  try {
    const result = await db
      .delete(sessionsTable)
      .where(lt(sessionsTable.expire, new Date()));
    const count = (result as any).rowCount ?? 0;
    if (count > 0) {
      logger.info({ deleted: count }, "Purged expired sessions");
    }
  } catch (err) {
    logger.error({ err }, "Failed to purge expired sessions");
  }
}

// Run once at startup (after a short delay) then every 6 hours
setTimeout(purgeExpiredSessions, 10_000);
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000);

export default app;
