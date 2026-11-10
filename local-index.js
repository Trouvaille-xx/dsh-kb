/**
 * dsh-kb — local folder index (S2.1).
 *
 * Markdown / text / PDF / docx → heading-aware chunks → SQLite FTS5 (trigram).
 * PDF chunks carry their page number so citations can point at a page.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.mdx']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const DOCX_EXTENSIONS = new Set(['.docx']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const CHUNK_TARGET = 900;
const CHUNK_OVERLAP = 120;
const SCHEMA_VERSION = '2';

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function isSupported(path) {
  const ext = extensionOf(path);
  return TEXT_EXTENSIONS.has(ext) || PDF_EXTENSIONS.has(ext) || DOCX_EXTENSIONS.has(ext);
}

async function walk(root, out, depth = 0) {
  if (depth > 8 || out.length > 5000) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) await walk(full, out, depth + 1);
    else if (entry.isFile() && isSupported(entry.name)) out.push(full);
  }
}

/** PDF → one entry per page. */
async function parsePdf(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if (typeof item.str === 'string') text += item.str;
          if (item.hasEOL) text += '\n';
        }
        const trimmed = text.replace(/[ \t]+/g, ' ').trim();
        if (trimmed.length >= 20) pages.push({ page: pageNumber, text: trimmed });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

/** docx → single text block (no page model). */
async function parseDocx(buffer) {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ buffer });
  const text = String(result?.value ?? '').replace(/\r\n/g, '\n').trim();
  return text.length >= 20 ? [{ page: undefined, text }] : [];
}

function chunkText(text, headingSeed, options = {}) {
  const target = Math.max(200, Math.min(4000, Number(options.chunkSize) || CHUNK_TARGET));
  const overlap = Math.max(0, Math.min(1000, Number(options.chunkOverlap) || CHUNK_OVERLAP));
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let heading = headingSeed ?? '';
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (body.length < 20) return;
    if (body.length <= target) {
      chunks.push({ heading, text: body });
      return;
    }
    for (let start = 0; start < body.length; start += target - overlap) {
      const piece = body.slice(start, start + target).trim();
      if (piece.length >= 20) chunks.push({ heading, text: piece });
    }
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    buffer.push(line);
    if (buffer.join('\n').length >= target) flush();
  }
  flush();
  return chunks;
}

function chunkDocument(pages, relativePath, options = {}) {
  const out = [];
  for (const { page, text } of pages) {
    const chunks = chunkText(text, '', options);
    for (const chunk of chunks) {
      out.push({ ...chunk, page, path: relativePath, index: out.length });
    }
  }
  return out;
}

async function parseFile(file) {
  const ext = extensionOf(file);
  if (PDF_EXTENSIONS.has(ext)) return parsePdf(await readFile(file));
  if (DOCX_EXTENSIONS.has(ext)) return parseDocx(await readFile(file));
  const text = await readFile(file, 'utf8');
  return [{ page: undefined, text }];
}

export function createLocalIndex({ dbPath }) {
  let db;

  async function ensureDb() {
    if (db) return db;
    await mkdir(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE IF NOT EXISTS kb_meta (k TEXT PRIMARY KEY, v TEXT)');
    const current = db.prepare('SELECT v FROM kb_meta WHERE k = ?').get('schema');
    if (!current || current.v !== SCHEMA_VERSION) {
      db.exec('DROP TABLE IF EXISTS kb_chunks');
      db.exec('DELETE FROM kb_meta');
      db.prepare('INSERT INTO kb_meta (k, v) VALUES (?, ?)').run('schema', SCHEMA_VERSION);
    }
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks USING fts5(
        text,
        path,
        heading,
        source_id UNINDEXED,
        chunk_index UNINDEXED,
        page UNINDEXED,
        tokenize = 'trigram'
      );
    `);
    return db;
  }

  async function ingest(sourceId, rootPath, options = {}) {
    await ensureDb();
    const files = [];
    await walk(rootPath, files);
    db.exec(`DELETE FROM kb_chunks WHERE source_id = '${String(sourceId).replace(/'/g, "''")}'`);
    const insert = db.prepare(
      'INSERT INTO kb_chunks (text, path, heading, source_id, chunk_index, page) VALUES (?, ?, ?, ?, ?, ?)',
    );
    let documents = 0;
    let chunks = 0;
    let skipped = 0;
    const failures = [];
    const filesMeta = [];
    for (const file of files) {
      try {
        const info = await stat(file);
        if (info.size > MAX_FILE_BYTES) {
          skipped += 1;
          filesMeta.push({ path: relative(rootPath, file).replace(/\\/g, '/'), type: extensionOf(file).slice(1), status: 'skipped', chunks: 0, updatedAt: Math.round(info.mtimeMs) });
          continue;
        }
        const relativePath = relative(rootPath, file).replace(/\\/g, '/');
        const pages = await parseFile(file);
        const pieces = chunkDocument(pages, relativePath, options);
        if (pieces.length === 0) {
          skipped += 1;
          filesMeta.push({ path: relativePath, type: extensionOf(file).slice(1), status: 'empty', chunks: 0, updatedAt: Math.round(info.mtimeMs) });
          continue;
        }
        for (const piece of pieces) {
          insert.run(piece.text, piece.path, piece.heading ?? '', sourceId, piece.index, piece.page ?? null);
          chunks += 1;
        }
        documents += 1;
        filesMeta.push({ path: relativePath, type: extensionOf(file).slice(1), status: 'ready', chunks: pieces.length, updatedAt: Math.round(info.mtimeMs) });
      } catch (error) {
        const relativePath = relative(rootPath, file).replace(/\\/g, '/');
        failures.push({ path: relativePath, error: String(error?.message ?? error) });
        filesMeta.push({ path: relativePath, type: extensionOf(file).slice(1), status: 'failed', chunks: 0, updatedAt: Date.now(), error: String(error?.message ?? error) });
      }
    }
    filesMeta.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    return {
      documents,
      chunks,
      skipped,
      failures: failures.slice(0, 20),
      files: filesMeta.slice(0, 500),
      truncated: filesMeta.length > 500,
    };
  }

  async function search(sourceId, query, topK = 8) {
    await ensureDb();
    const trimmed = String(query ?? '').trim();
    if (!trimmed) return [];
    const limit = Math.max(1, Math.min(20, Number(topK) || 8));
    const escaped = trimmed.replace(/"/g, '""');

    const runMatch = (expr) => {
      try {
        return db
          .prepare(
            `SELECT path, heading, text, page, bm25(kb_chunks) AS score
             FROM kb_chunks
             WHERE kb_chunks MATCH ? AND source_id = ?
             ORDER BY score
             LIMIT ?`,
          )
          .all(expr, sourceId, limit);
      } catch {
        return [];
      }
    };

    let rows = runMatch(`"${escaped}"`);
    if (rows.length === 0 && escaped.length >= 2) {
      rows = runMatch(escaped.split(/\s+/).map((token) => `"${token}"`).join(' OR '));
    }
    if (rows.length === 0) {
      try {
        rows = db
          .prepare(
            `SELECT path, heading, text, page, 0 AS score
             FROM kb_chunks
             WHERE source_id = ? AND text LIKE ?
             LIMIT ?`,
          )
          .all(sourceId, `%${trimmed}%`, limit);
      } catch {
        rows = [];
      }
    }

    return rows.map((row, index) => ({
      index: index + 1,
      sourceType: 'local',
      sourceId,
      title: row.path,
      headingPath: row.heading ? [row.heading] : undefined,
      page: typeof row.page === 'number' && row.page > 0 ? row.page : undefined,
      snippet: String(row.text).replace(/\s+/g, ' ').slice(0, 320),
      score: typeof row.score === 'number' ? Number(row.score.toFixed(4)) : undefined,
    }));
  }

  function close() {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    db = undefined;
  }

  return { ingest, search, close };
}
