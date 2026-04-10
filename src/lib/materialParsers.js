import * as XLSX from "xlsx";
import mammoth from "mammoth";

const MAX_CELL_CHARS = 160;
const MAX_SPREADSHEET_EXTRACT_CHARS = 18000;
const MAX_WORD_EXTRACT_CHARS = 12000;
const MAX_PREVIEW_ROWS = 10;

const clipText = (value, max = 1200) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const normalizeRows = (rows = []) => (Array.isArray(rows) ? rows : []).map((row) => {
  if (!Array.isArray(row)) return [];
  return row.map((cell) => clipText(cell == null ? "" : cell, MAX_CELL_CHARS));
});

const inferKind = (file) => {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();

  if (type.startsWith("image/")) return "screenshot";
  if (name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")) return "spreadsheet";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "document";
  return "generic";
};

const collectLinesWithinBudget = (lines = [], maxChars = MAX_SPREADSHEET_EXTRACT_CHARS) => {
  const accepted = [];
  let usedChars = 0;

  for (const line of lines) {
    const normalized = String(line || "").trim();
    if (!normalized) continue;
    const nextCost = normalized.length + 1;
    if (accepted.length > 0 && usedChars + nextCost > maxChars) break;
    accepted.push(normalized);
    usedChars += nextCost;
  }

  return {
    text: accepted.join("\n"),
    includedCount: accepted.length,
    truncated: accepted.length < lines.length
  };
};

const parseCsvText = (text) => {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  const rows = lines.map((line) => line.split(",").map((cell) => cell.trim()));
  const headers = rows[0] || [];
  const budgeted = collectLinesWithinBudget(lines, MAX_SPREADSHEET_EXTRACT_CHARS);

  return {
    sheetNames: ["CSV"],
    headers,
    sampleRows: rows.slice(1, MAX_PREVIEW_ROWS + 1),
    rowCount: lines.length,
    columnCount: headers.length,
    includedRowCount: Math.max(0, budgeted.includedCount - 1),
    truncated: budgeted.truncated,
    extractedText: budgeted.text
  };
};

const parseWorkbook = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  const extractedChunks = [];
  let usedChars = 0;

  const sheets = sheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = normalizeRows(XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }));
    const headers = rows[0] || [];
    const rowLines = rows.slice(1).map((row, idx) => `Row ${idx + 1}: ${row.slice(0, 20).join(" | ")}`);
    const sheetLines = [
      `Sheet: ${sheetName}`,
      `Headers: ${headers.slice(0, 20).join(" | ")}`
    ];

    let includedRowCount = 0;
    for (const line of rowLines) {
      const nextCost = line.length + 1;
      if (usedChars + nextCost > MAX_SPREADSHEET_EXTRACT_CHARS) break;
      sheetLines.push(line);
      usedChars += nextCost;
      includedRowCount += 1;
    }

    if (sheetLines.length > 0) {
      const chunk = sheetLines.join("\n");
      if (usedChars + chunk.length <= MAX_SPREADSHEET_EXTRACT_CHARS || extractedChunks.length === 0) {
        extractedChunks.push(chunk);
      }
    }

    return {
      name: sheetName,
      headers: headers.slice(0, 20),
      sampleRows: rows.slice(1, MAX_PREVIEW_ROWS + 1).map((row) => row.slice(0, 20)),
      rowCount: Math.max(rows.length - 1, 0),
      columnCount: headers.length,
      includedRowCount,
      truncated: includedRowCount < Math.max(rows.length - 1, 0)
    };
  });

  return {
    sheetNames,
    sheets,
    headers: sheets[0]?.headers || [],
    sampleRows: sheets[0]?.sampleRows || [],
    rowCount: sheets.reduce((sum, sheet) => sum + Number(sheet.rowCount || 0), 0),
    columnCount: Math.max(0, ...sheets.map((sheet) => Number(sheet.columnCount || 0))),
    includedRowCount: sheets.reduce((sum, sheet) => sum + Number(sheet.includedRowCount || 0), 0),
    truncated: sheets.some((sheet) => sheet.truncated),
    extractedText: extractedChunks.join("\n\n")
  };
};

const parseWordDocument = async (arrayBuffer) => {
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = String(result?.value || "").trim();
  const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  return {
    excerpt: clipText(text, MAX_WORD_EXTRACT_CHARS),
    paragraphs: paragraphs.slice(0, 12),
    paragraphCount: paragraphs.length,
    truncated: text.length > MAX_WORD_EXTRACT_CHARS
  };
};

export const parseMaterialFile = async (file) => {
  if (!file) throw new Error("未选择文件。");

  const kind = inferKind(file);
  const base = {
    kind,
    mimeType: file.type || "",
    filename: file.name || "upload",
    size: Number(file.size || 0)
  };

  if (kind === "spreadsheet") {
    if (String(file.name || "").toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      const parsed = parseCsvText(text);
      return {
        ...base,
        extractedText: parsed.extractedText,
        parsedPreview: parsed
      };
    }

    const arrayBuffer = await file.arrayBuffer();
    const parsed = parseWorkbook(arrayBuffer);

    return {
      ...base,
      extractedText: parsed.extractedText,
      parsedPreview: parsed
    };
  }

  if (kind === "document") {
    const arrayBuffer = await file.arrayBuffer();
    const parsed = await parseWordDocument(arrayBuffer);
    return {
      ...base,
      extractedText: parsed.excerpt,
      parsedPreview: parsed
    };
  }

  return {
    ...base,
    extractedText: "",
    parsedPreview: null
  };
};
