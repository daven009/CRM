import { Router } from "express";
import { parseTaskIntentRequestSchema, parseTaskIntentResponseSchema } from "../lib/schema";
import { getProviderMetadata } from "../providers/llm";
import { IntentParserService } from "../services/intent-parser";

const router = Router();
const parserService = new IntentParserService();

router.post("/parse-task-intent", async (req, res, next) => {
  try {
    const payload = parseTaskIntentRequestSchema.parse(req.body);
    const result = await parserService.parse(payload);
    const response = parseTaskIntentResponseSchema.parse(result);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get("/provider-status", (_, res) => {
  res.json(getProviderMetadata());
});

export { router as agentRouter };
