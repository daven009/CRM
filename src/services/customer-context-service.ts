import { CustomerRepository } from "../repositories/customer-repository";
import { IntentParserService } from "./intent-parser";

export class CustomerContextService {
  private readonly repository = new CustomerRepository();
  private readonly parser = new IntentParserService();

  getCustomerContext(customerId: string) {
    const customer = this.repository.getCustomerById(customerId);
    if (!customer) {
      return null;
    }

    return {
      customer,
      contacts: this.repository.listContactsByCustomerId(customerId),
      open_tasks: this.repository.getOpenTasksByCustomerId(customerId),
      notes: this.repository.listNotesByCustomerId(customerId),
    };
  }

  async parseForCustomer(customerId: string, now: string, inputText: string, persistNote = false) {
    const context = this.getCustomerContext(customerId);
    if (!context) {
      return null;
    }

    const result = await this.parser.parse({
      now,
      customer: context.customer,
      open_tasks: context.open_tasks,
      input_text: inputText,
    });

    let savedNoteId: string | null = null;
    if (persistNote && result.conversation_insight) {
      savedNoteId = this.repository.saveConversationInsight(
        customerId,
        inputText,
        result.conversation_insight,
      );
    }

    return {
      ...result,
      saved_note_id: savedNoteId,
    };
  }
}
