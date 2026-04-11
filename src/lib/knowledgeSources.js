const DEFAULT_EXCERPT_LIMIT = 12000;
const DEFAULT_TOTAL_LIMIT = 80000;

const clipText = (value, max = DEFAULT_EXCERPT_LIMIT) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const normalizeList = (value) => (Array.isArray(value) ? value : [])
  .map((item) => String(item || "").trim())
  .filter(Boolean);

const isUrlLike = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());

export const normalizeKnowledgeSource = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    const name = String(value || "").trim();
    if (!name) return null;
    return {
      id: `url-${name}`,
      name,
      sourceType: "url",
      kind: "link",
      mimeType: "",
      size: "web",
      sizeLabel: "web",
      url: name,
      active: true,
      status: "active",
      summary: name,
      details: [],
      tags: [],
      suggestedActions: [],
      promptContext: name,
      extractedText: "",
      parsedPreview: null,
      uploadedAt: ""
    };
  }

  const sourceType = value?.sourceType || value?.kind || (value?.type === "url" || isUrlLike(value?.url) ? "url" : "file");
  const name = String(value?.name || value?.filename || value?.title || value?.url || "Untitled").trim();
  const summary = String(value?.summary || "").trim();
  const promptContext = String(value?.promptContext || "").trim();
  const extractedText = clipText(value?.extractedText || value?.text || "", DEFAULT_EXCERPT_LIMIT);

  return {
    id: String(value?.id || `${sourceType}-${name}`),
    name,
    sourceType,
    kind: String(value?.kind || (sourceType === "url" ? "link" : "file")).trim(),
    mimeType: String(value?.mimeType || "").trim(),
    size: value?.size ?? value?.fileSize ?? "",
    sizeLabel: String(value?.sizeLabel || value?.sizeText || value?.size || (sourceType === "url" ? "web" : "")).trim(),
    url: String(value?.url || "").trim(),
    active: value?.active !== false,
    status: String(value?.status || "active").trim(),
    summary: summary || promptContext || name,
    details: normalizeList(value?.details),
    tags: normalizeList(value?.tags),
    suggestedActions: normalizeList(value?.suggestedActions),
    promptContext: promptContext || summary || name,
    extractedText,
    parsedPreview: value?.parsedPreview || null,
    uploadedAt: String(value?.uploadedAt || value?.createdAt || "").trim(),
    note: String(value?.note || "").trim()
  };
};

export const buildKnowledgeContext = (sources = [], maxTotalChars = DEFAULT_TOTAL_LIMIT) => {
  const normalized = (Array.isArray(sources) ? sources : [])
    .map(normalizeKnowledgeSource)
    .filter((item) => item && item.active !== false);

  const items = [];
  let usedChars = 0;
  let truncated = false;

  for (const source of normalized) {
    const item = {
      index: items.length + 1,
      id: source.id,
      name: source.name,
      sourceType: source.sourceType,
      kind: source.kind,
      mimeType: source.mimeType,
      sizeLabel: source.sizeLabel,
      url: source.url,
      uploadedAt: source.uploadedAt,
      summary: source.summary,
      details: source.details.slice(0, 8),
      tags: source.tags.slice(0, 8),
      suggestedActions: source.suggestedActions.slice(0, 4),
      promptContext: source.promptContext || source.summary || source.name,
      extractedTextExcerpt: clipText(source.extractedText, DEFAULT_EXCERPT_LIMIT),
      parsedPreview: source.parsedPreview,
      note: source.note
    };

    const serializedSize = JSON.stringify(item).length;
    if (items.length > 0 && usedChars + serializedSize > maxTotalChars) {
      truncated = true;
      break;
    }

    items.push(item);
    usedChars += serializedSize;
  }

  return {
    items,
    totalCount: normalized.length,
    includedCount: items.length,
    truncated,
    defaultLimit: maxTotalChars,
    collectionLabel: "knowledge_sources",
    note: truncated
      ? `该知识库已被截断。回答时必须区分全集(totalCount=${normalized.length})和当前注入子集(includedCount=${items.length})，不能混淆。`
      : "当前已注入全部知识库。"
  };
};
