import { ContactWithDetails, CustomerRepository } from "../repositories/customer-repository";
import { ContactCandidate, ContactEntityClues, ContactResolution } from "../types/engine";
import { extractEntityClues } from "./contact-clue-extractor";

const EXEC_TITLES = ["总", "老板", "总经理", "董事长", "董", "经理"];

function normalize(text: string | null | undefined) {
  return (text ?? "").replace(/\s+/g, "").toLowerCase();
}

function pickSurname(personName: string | null): string | null {
  if (!personName) {
    return null;
  }
  return personName.slice(0, 1) || null;
}

function buildMatchedCandidate(contact: ContactWithDetails, score: number, matchedFields: string[]): ContactCandidate {
  return {
    id: contact.id,
    name: contact.name,
    display_name: contact.display_name,
    company: contact.basics?.company ?? contact.company,
    phone: contact.phone,
    customer_id: contact.customer_id,
    score,
    matched_fields: [...new Set(matchedFields)],
    profile_summary: [
      contact.basics?.industry ? `${contact.basics.company}，${contact.basics.industry}` : contact.basics?.company ?? contact.company,
      contact.profile?.title ? `职位是${contact.profile.title}` : null,
      contact.basics?.acquisition_channel ? `最初通过${contact.basics.acquisition_channel}认识` : null,
      contact.profile?.preferences?.length ? `已知偏好：${contact.profile.preferences.slice(0, 2).join("、")}` : null,
    ].filter(Boolean).join("；"),
  };
}

function rankContacts(contacts: ContactWithDetails[], clues: ContactEntityClues): ContactCandidate[] {
  const person = normalize(clues.person_name);
  const company = normalize(clues.company);
  const phone = normalize(clues.phone);
  const email = normalize(clues.email);
  const wechat = normalize(clues.wechat);
  const surname = pickSurname(clues.person_name);

  const ranked = contacts
    .map((contact) => {
      let score = 0;
      const matchedFields: string[] = [];
      const name = normalize(contact.name);
      const displayName = normalize(contact.display_name);
      const companyName = normalize(contact.basics?.company ?? contact.company);
      const title = normalize(contact.profile?.title);
      const methods = contact.methods.map((method) => ({
        type: method.method_type,
        value: normalize(method.value),
      }));

      if (person) {
        if (displayName === person) {
          score += 7;
          matchedFields.push("display_name_exact");
        } else if (displayName.includes(person) || person.includes(displayName)) {
          score += 5;
          matchedFields.push("display_name_partial");
        }

        if (name === person) {
          score += 8;
          matchedFields.push("name_exact");
        } else if (name.includes(person) || person.includes(name)) {
          score += 5;
          matchedFields.push("name_partial");
        }

        if (surname && contact.name.startsWith(surname)) {
          score += 2;
          matchedFields.push("surname");
        }

        if (clues.title_hint && (displayName.endsWith(clues.title_hint) || title.includes(normalize(clues.title_hint)))) {
          score += 2;
          matchedFields.push("title_hint");
        }

        if (surname && EXEC_TITLES.some((alias) => person === `${surname}${alias}`) && contact.name.startsWith(surname)) {
          score += 2;
          matchedFields.push("title_alias");
        }
      }

      if (company) {
        if (companyName === company) {
          score += 8;
          matchedFields.push("company_exact");
        } else if (companyName.includes(company) || company.includes(companyName)) {
          score += 5;
          matchedFields.push("company_partial");
        }
      }

      if (phone && (normalize(contact.phone) === phone || methods.some((method) => method.value === phone))) {
        score += 10;
        matchedFields.push("phone");
      }

      if (email && methods.some((method) => method.type === "email" && method.value === email)) {
        score += 10;
        matchedFields.push("email");
      }

      if (wechat && methods.some((method) => method.type === "wechat" && method.value.includes(wechat))) {
        score += 9;
        matchedFields.push("wechat");
      }

      return buildMatchedCandidate(contact, score, matchedFields);
    })
    .filter((candidate) => (phone || email || wechat ? candidate.score && candidate.score > 0 : candidate.score && candidate.score >= 4))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  return ranked;
}

export class ContactResolverService {
  private readonly repository = new CustomerRepository();

  extractQueryName(inputText: string) {
    return extractEntityClues(inputText).person_name;
  }

  extractClues(inputText: string) {
    return extractEntityClues(inputText);
  }

  resolveFromInput(inputText: string): ContactResolution {
    const clues = extractEntityClues(inputText);
    return this.resolveFromClues(inputText, clues);
  }

  resolveFromClues(inputText: string, clues: ContactEntityClues): ContactResolution {
    const hasAnyClue = Object.values(clues).some(Boolean);

    if (!hasAnyClue) {
      return {
        status: "unresolved",
        query_name: null,
        candidates: [],
        selected_contact_id: null,
        confirmed_contact_id: null,
        confirmation_required: false,
      };
    }

    const candidates = rankContacts(this.repository.listAllContactsWithDetails(), clues);
    const topScore = candidates[0]?.score ?? 0;
    const narrowedCandidates = candidates.filter((candidate) => (candidate.score ?? 0) >= Math.max(4, topScore - 2));

    if (narrowedCandidates.length === 0) {
      return {
        status: "not_found",
        query_name: clues.person_name ?? clues.company ?? clues.phone ?? clues.email ?? clues.wechat,
        candidates: [],
        selected_contact_id: null,
        confirmed_contact_id: null,
        confirmation_required: false,
      };
    }

    const top = narrowedCandidates[0];
    const second = narrowedCandidates[1];

    if (narrowedCandidates.length === 1 || (top.score ?? 0) >= ((second?.score ?? 0) + 3)) {
      return {
        status: "resolved",
        query_name: clues.person_name ?? clues.company ?? null,
        candidates: narrowedCandidates,
        selected_contact_id: top.id,
        confirmed_contact_id: null,
        confirmation_required: true,
      };
    }

    return {
      status: "ambiguous",
      query_name: clues.person_name ?? clues.company ?? null,
      candidates: narrowedCandidates,
      selected_contact_id: null,
      confirmed_contact_id: null,
      confirmation_required: false,
    };
  }

  resolveSelection(
    previous: ContactResolution,
    selectedContactId?: string,
    inputText?: string,
  ): ContactResolution {
    if (previous.candidates.length === 0) {
      return previous;
    }

    const byId = selectedContactId
      ? previous.candidates.find((candidate) => candidate.id === selectedContactId)
      : null;

    if (byId) {
      return {
        ...previous,
        status: "resolved",
        selected_contact_id: byId.id,
        confirmed_contact_id: byId.id,
        confirmation_required: false,
      };
    }

    const normalized = inputText?.replace(/\s+/g, "") ?? "";
    if (!normalized) {
      return previous;
    }

    const indexMap = ["第一", "第二", "第三", "第四", "第五"];
    for (let index = 0; index < previous.candidates.length; index += 1) {
      const candidate = previous.candidates[index];
      if (
        normalized.includes(candidate.name) ||
        normalized.includes(candidate.display_name) ||
        normalized.includes(candidate.company) ||
        normalized.includes(String(index + 1)) ||
        normalized.includes(indexMap[index] ?? "")
      ) {
        return {
          ...previous,
          status: "resolved",
          selected_contact_id: candidate.id,
          confirmed_contact_id: candidate.id,
          confirmation_required: false,
        };
      }
    }

    return previous;
  }
}
