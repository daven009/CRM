/**
 * Supabase Storage 文件向量化 + 语义搜索脚本
 * 
 * 功能：
 * 1. 列出 Supabase Storage 中 crm-contact-files bucket 的所有文件
 * 2. 下载并解析文件内容（支持 xlsx/csv/pdf/docx）
 * 3. 调用 OpenAI Embedding API 进行向量化
 * 4. 用语义搜索 + 关键词匹配查找与指定查询相关的文件
 * 
 * 用法：
 *   node scripts/vectorize_storage.js [搜索关键词]
 *   例如: node scripts/vectorize_storage.js 李四
 */

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── 加载 .env.local ────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '.env.local');

const loadEnv = () => {
  try {
    const content = readFileSync(envPath, 'utf-8');
    const env = {};
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    });
    return env;
  } catch {
    console.error('❌ 无法读取 .env.local');
    process.exit(1);
  }
};

const env = loadEnv();

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const OPENAI_API_KEY = env.VITE_OPENAI_API_KEY;
const OPENAI_API_URL = (env.VITE_OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions').replace(/\/chat\/completions\/?$/, '/embeddings');
const EMBEDDING_MODEL = env.VITE_OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 256;

const BUCKET = 'crm-contact-files';
const SEARCH_QUERY = process.argv[2] || '李四';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ 未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ 未配置 VITE_OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Embedding API ────────────────────────────────

const createEmbeddings = async (texts) => {
  const cleanTexts = texts.map(t => String(t || '').trim()).filter(Boolean);
  if (cleanTexts.length === 0) return [];

  const resp = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: cleanTexts,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float'
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Embedding 请求失败 (${resp.status}): ${text.slice(0, 300)}`);
  }

  const body = await resp.json();
  if (body?.error) throw new Error(`Embedding API 错误: ${body.error.message}`);

  const sorted = (body.data || []).sort((a, b) => a.index - b.index);
  return sorted.map(item => item.embedding);
};

const embedText = async (text) => {
  const results = await createEmbeddings([text]);
  return results[0] || [];
};

// ─── 余弦相似度 ────────────────────────────────

const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

// ─── 文件解析 ────────────────────────────────

const parseXlsxBuffer = (buffer, filename) => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const chunks = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
      const headers = rows[0] || [];

      chunks.push(`Sheet: ${sheetName}`);
      chunks.push(`Headers: ${headers.join(' | ')}`);

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        chunks.push(`Row ${i}: ${row.join(' | ')}`);
      }
    }

    return chunks.join('\n');
  } catch (err) {
    console.warn(`  ⚠️ 解析 ${filename} 失败:`, err.message);
    return '';
  }
};

const parseCsvBuffer = (buffer) => {
  const text = buffer.toString('utf-8');
  return text;
};

const parseTextBuffer = (buffer) => {
  return buffer.toString('utf-8');
};

// ─── Supabase Storage 操作 ────────────────────────────────

const listAllFiles = async () => {
  console.log(`\n📂 正在列出 Supabase Storage bucket "${BUCKET}" 中的文件...\n`);

  // 首先列出根目录下的"文件夹"（联系人 ID 目录）
  const { data: folders, error: folderError } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 1000 });

  if (folderError) {
    throw new Error(`列出文件夹失败: ${folderError.message}`);
  }

  const allFiles = [];

  for (const item of (folders || [])) {
    if (item.id === null || item.metadata === null) {
      // 这是一个"文件夹"，递归列出
      const { data: files, error: fileError } = await supabase.storage
        .from(BUCKET)
        .list(item.name, { limit: 1000 });

      if (fileError) {
        console.warn(`  ⚠️ 列出 ${item.name}/ 失败:`, fileError.message);
        continue;
      }

      for (const file of (files || [])) {
        if (file.name && file.id) {
          allFiles.push({
            folder: item.name,
            name: file.name,
            path: `${item.name}/${file.name}`,
            metadata: file.metadata || {},
            size: file.metadata?.size || 0,
            mimeType: file.metadata?.mimetype || ''
          });
        }
      }
    } else if (item.name && item.id) {
      // 根目录下的文件
      allFiles.push({
        folder: '',
        name: item.name,
        path: item.name,
        metadata: item.metadata || {},
        size: item.metadata?.size || 0,
        mimeType: item.metadata?.mimetype || ''
      });
    }
  }

  return allFiles;
};

const downloadFile = async (path) => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (error) throw new Error(`下载 ${path} 失败: ${error.message}`);
  return data;
};

// ─── 主流程 ────────────────────────────────

const main = async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  Supabase Storage 文件向量化 & 语义搜索');
  console.log('═══════════════════════════════════════════════');
  console.log(`  搜索关键词: "${SEARCH_QUERY}"`);
  console.log(`  Bucket: ${BUCKET}`);
  console.log(`  Embedding 模型: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS}维)`);

  // Step 1: 列出所有文件
  const files = await listAllFiles();
  console.log(`\n📋 发现 ${files.length} 个文件:\n`);

  if (files.length === 0) {
    console.log('  (空) 没有找到任何文件。');
    return;
  }

  files.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.path} (${(f.size / 1024).toFixed(1)} KB, ${f.mimeType || '未知类型'})`);
  });

  // Step 2: 下载并解析每个文件
  console.log('\n📥 下载并解析文件内容...\n');

  const fileContents = [];

  for (const file of files) {
    process.stdout.write(`  处理 ${file.path}... `);
    try {
      const blob = await downloadFile(file.path);
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let extractedText = '';
      const ext = file.name.toLowerCase();

      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        extractedText = parseXlsxBuffer(buffer, file.name);
      } else if (ext.endsWith('.csv')) {
        extractedText = parseCsvBuffer(buffer);
      } else if (ext.endsWith('.txt') || ext.endsWith('.md')) {
        extractedText = parseTextBuffer(buffer);
      } else {
        extractedText = `[二进制文件: ${file.name}, 类型: ${file.mimeType}]`;
      }

      fileContents.push({
        ...file,
        extractedText: extractedText.slice(0, 8000), // 限制长度
        textLength: extractedText.length
      });

      console.log(`✅ (${extractedText.length} 字符)`);
    } catch (err) {
      console.log(`❌ ${err.message}`);
      fileContents.push({
        ...file,
        extractedText: '',
        textLength: 0,
        error: err.message
      });
    }
  }

  // Step 3: 向量化
  console.log('\n🔢 正在生成 Embedding 向量...\n');

  const embeddableFiles = fileContents.filter(f => f.extractedText && f.extractedText.length > 10);

  if (embeddableFiles.length === 0) {
    console.log('  ⚠️ 没有可向量化的文件内容。');
    return;
  }

  // 为每个文件构建可搜索文本（文件名 + 内容摘要）
  const textsToEmbed = embeddableFiles.map(f => {
    return `文件: ${f.name}\n路径: ${f.path}\n内容:\n${f.extractedText.slice(0, 2000)}`;
  });

  try {
    const embeddings = await createEmbeddings(textsToEmbed);
    console.log(`  ✅ 成功为 ${embeddings.length} 个文件生成向量\n`);

    embeddableFiles.forEach((f, idx) => {
      f.embedding = embeddings[idx];
    });
  } catch (err) {
    console.error('  ❌ 向量化失败:', err.message);
    console.log('\n  回退到纯关键词搜索模式...\n');
  }

  // Step 4: 搜索
  console.log('═══════════════════════════════════════════════');
  console.log(`  🔍 正在搜索与 "${SEARCH_QUERY}" 相关的文件...`);
  console.log('═══════════════════════════════════════════════\n');

  // 4a: 语义搜索
  let semanticResults = [];
  const hasEmbeddings = embeddableFiles.some(f => f.embedding && f.embedding.length > 0);

  if (hasEmbeddings) {
    try {
      const queryEmbedding = await embedText(SEARCH_QUERY);
      
      if (queryEmbedding && queryEmbedding.length > 0) {
        semanticResults = embeddableFiles
          .filter(f => f.embedding && f.embedding.length > 0)
          .map(f => ({
            file: f,
            semanticScore: cosineSimilarity(queryEmbedding, f.embedding)
          }))
          .sort((a, b) => b.semanticScore - a.semanticScore);
      }
    } catch (err) {
      console.warn('  ⚠️ 语义搜索失败:', err.message);
    }
  }

  // 4b: 关键词搜索
  const keywordResults = fileContents.map(f => {
    const searchable = `${f.name} ${f.path} ${f.extractedText}`.toLowerCase();
    const query = SEARCH_QUERY.toLowerCase();
    
    let keywordScore = 0;
    let matchDetails = [];

    // 精确匹配
    if (searchable.includes(query)) {
      // 计算出现次数
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = (f.extractedText || '').match(regex) || [];
      const nameMatches = (f.name || '').match(regex) || [];

      keywordScore = matches.length * 10 + nameMatches.length * 20;
      if (nameMatches.length > 0) matchDetails.push(`文件名命中 ${nameMatches.length} 次`);
      if (matches.length > 0) matchDetails.push(`内容命中 ${matches.length} 次`);
    }

    // 分词匹配
    const tokens = SEARCH_QUERY.split(/[\s,，。]+/).filter(t => t.length >= 1);
    for (const token of tokens) {
      const tLower = token.toLowerCase();
      if (searchable.includes(tLower)) {
        const regex = new RegExp(tLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = (f.extractedText || '').match(regex) || [];
        keywordScore += matches.length * 5;
        if (matches.length > 0 && !matchDetails.some(d => d.includes(token))) {
          matchDetails.push(`"${token}" 出现 ${matches.length} 次`);
        }
      }
    }

    return { file: f, keywordScore, matchDetails };
  }).filter(r => r.keywordScore > 0)
    .sort((a, b) => b.keywordScore - a.keywordScore);

  // 4c: 合并结果
  const combinedMap = new Map();

  // 语义结果
  for (const r of semanticResults) {
    combinedMap.set(r.file.path, {
      file: r.file,
      semanticScore: r.semanticScore,
      keywordScore: 0,
      matchDetails: [],
      combinedScore: r.semanticScore
    });
  }

  // 关键词结果
  for (const r of keywordResults) {
    const existing = combinedMap.get(r.file.path);
    if (existing) {
      existing.keywordScore = r.keywordScore;
      existing.matchDetails = r.matchDetails;
      existing.combinedScore = existing.semanticScore + (r.keywordScore / 100) * 0.3;
    } else {
      combinedMap.set(r.file.path, {
        file: r.file,
        semanticScore: 0,
        keywordScore: r.keywordScore,
        matchDetails: r.matchDetails,
        combinedScore: (r.keywordScore / 100) * 0.5
      });
    }
  }

  const finalResults = [...combinedMap.values()]
    .sort((a, b) => b.combinedScore - a.combinedScore);

  // Step 5: 输出结果
  if (finalResults.length === 0) {
    console.log(`  ❌ 没有找到与 "${SEARCH_QUERY}" 相关的文件。\n`);
    console.log('  所有文件内容概览:\n');
    fileContents.forEach(f => {
      console.log(`  📄 ${f.path}`);
      console.log(`     内容预览: ${(f.extractedText || '').slice(0, 200).replace(/\n/g, ' ')}\n`);
    });
    return;
  }

  console.log(`  ✅ 找到 ${finalResults.length} 个与 "${SEARCH_QUERY}" 相关的文件:\n`);

  finalResults.forEach((r, idx) => {
    const f = r.file;
    console.log(`  ┌─ #${idx + 1} ────────────────────────────────────`);
    console.log(`  │ 📄 文件: ${f.path}`);
    console.log(`  │ 📏 大小: ${(f.size / 1024).toFixed(1)} KB | 类型: ${f.mimeType || '未知'}`);
    if (r.semanticScore > 0) {
      console.log(`  │ 🧠 语义相似度: ${(r.semanticScore * 100).toFixed(1)}%`);
    }
    if (r.keywordScore > 0) {
      console.log(`  │ 🔤 关键词得分: ${r.keywordScore}`);
      console.log(`  │ 📌 匹配详情: ${r.matchDetails.join(' | ')}`);
    }
    console.log(`  │ ⭐ 综合得分: ${(r.combinedScore * 100).toFixed(1)}%`);

    // 显示与搜索词相关的内容片段
    const text = f.extractedText || '';
    const queryLower = SEARCH_QUERY.toLowerCase();
    const textLower = text.toLowerCase();
    const matchIdx = textLower.indexOf(queryLower);
    
    if (matchIdx >= 0) {
      const start = Math.max(0, matchIdx - 80);
      const end = Math.min(text.length, matchIdx + SEARCH_QUERY.length + 200);
      const snippet = text.slice(start, end).replace(/\n/g, ' ');
      console.log(`  │ 📝 相关内容片段:`);
      console.log(`  │    ...${snippet}...`);
    }

    console.log(`  └─────────────────────────────────────────\n`);
  });

  // 额外：显示匹配文件中所有与搜索词所在行的完整内容
  console.log('═══════════════════════════════════════════════');
  console.log(`  📋 与 "${SEARCH_QUERY}" 直接相关的行数据:`);
  console.log('═══════════════════════════════════════════════\n');

  for (const r of finalResults) {
    if (r.keywordScore <= 0) continue;
    const f = r.file;
    const lines = (f.extractedText || '').split('\n');
    const matchingLines = lines.filter(line => 
      line.toLowerCase().includes(SEARCH_QUERY.toLowerCase())
    );

    if (matchingLines.length > 0) {
      console.log(`  📄 ${f.path} 中包含 "${SEARCH_QUERY}" 的行:\n`);
      matchingLines.forEach((line, i) => {
        console.log(`    ${i + 1}. ${line.trim()}`);
      });
      console.log('');
    }
  }
};

main().catch(err => {
  console.error('\n💥 脚本执行失败:', err);
  process.exit(1);
});
