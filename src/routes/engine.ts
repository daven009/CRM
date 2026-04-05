import { Router } from "express";
import { engineRespondRequestSchema, engineResponseSchema } from "../lib/engine-schema";
import { QueryEngineService } from "../services/query-engine";

const router = Router();
const queryEngineService = new QueryEngineService();

router.post("/respond", async (req, res, next) => {
  try {
    const payload = engineRespondRequestSchema.parse(req.body);
    const result = await queryEngineService.respond(payload);
    res.json(engineResponseSchema.parse(result));
  } catch (error) {
    next(error);
  }
});

export { router as engineRouter };
