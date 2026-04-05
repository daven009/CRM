import "dotenv/config";
import express from "express";
import { ZodError } from "zod";
import { initDatabase } from "./db/init";
import { agentRouter } from "./routes/agent";
import { customerRouter } from "./routes/customers";
import { engineRouter } from "./routes/engine";
import { enginePlaygroundRouter } from "./routes/engine-playground";
import { playgroundRouter } from "./routes/playground";

export function createApp() {
  initDatabase();

  const app = express();
  app.use(express.json());

  app.get("/health", (_, res) => {
    res.json({ ok: true });
  });

  app.use("/agent", agentRouter);
  app.use("/customers", customerRouter);
  app.use("/engine", engineRouter);
  app.use(enginePlaygroundRouter);
  app.use(playgroundRouter);

  app.use((error: unknown, _: express.Request, res: express.Response, __: express.NextFunction) => {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: "validation_error",
        details: error.flatten(),
      });
    }

    return res.status(500).json({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  });

  return app;
}
