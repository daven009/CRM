import { Router } from "express";
import { z } from "zod";
import { CustomerContextService } from "../services/customer-context-service";
import { parseTaskIntentResponseSchema } from "../lib/schema";

const router = Router();
const customerContextService = new CustomerContextService();

const parseForCustomerSchema = z.object({
  now: z.string().datetime({ offset: true }),
  input_text: z.string().min(1),
  persist_note: z.boolean().optional(),
});

router.get("/:customerId/context", (req, res) => {
  const context = customerContextService.getCustomerContext(req.params.customerId);
  if (!context) {
    return res.status(404).json({ error: "not_found", message: "Customer not found" });
  }

  return res.json(context);
});

router.post("/:customerId/parse-task-intent", async (req, res, next) => {
  try {
    const payload = parseForCustomerSchema.parse(req.body);
    const result = await customerContextService.parseForCustomer(
      req.params.customerId,
      payload.now,
      payload.input_text,
      payload.persist_note ?? false,
    );

    if (!result) {
      return res.status(404).json({ error: "not_found", message: "Customer not found" });
    }

    const response = parseTaskIntentResponseSchema.extend({
      saved_note_id: z.string().nullable(),
    }).parse(result);

    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

export { router as customerRouter };
