/**
 * dsh-kb — host half (S1 vertical slice).
 *
 * Scope of this slice:
 *  - configurable "tool" knowledge sources (no per-vendor connector code)
 *  - per-session single-source binding
 *  - kb_search: renders the source's argument template, invokes the already
 *    registered tool (MCP / skill / other plugin), normalizes the payload into
 *    citations, and exposes them through output.presentationMeta
 *  - /kb/api/* HTTP surface for the client (cookie-fenced)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { createLocalIndex } from './local-index.js';

export const inject = ['tools', 'webServer', 'connection'];

const STATE_VERSION = 1;

function stateFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'kb', 'state.json');
}

function emptyState() {
  return {
    version: STATE_VERSION,
    sources: [],
    bindings: {},
    defaultSourceId: null,
    citations: {},
    documents: {},
    config: {
      chunkSize: 900,
      chunkOverlap: 120,
      embedding: { provider: 'none', model: '', baseUrl: '' },
      rerank: { provider: 'none', model: '' },
    },
  };
}

async function loadState() {
  try {
    const raw = await readFile(stateFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...emptyState(), ...parsed, version: STATE_VERSION };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[dsh-kb] cannot read state:', error?.message ?? error);
    return emptyState();
  }
}

async function saveState(state) {
  const file = stateFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
}

/** Read `a.b.0.c` / `$.a.b` style paths; returns undefined when absent. */
function getPath(value, path) {
  if (value === undefined || value === null || !path) return value;
  const parts = String(path)
    .replace(/^\$\.?/, '')
    .split('.')
    .filter((part) => part.length > 0);
  let cursor = value;
  for (const part of parts) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/** Drop undefined members so every value stays lossless JSON. */
function compact(value) {
  if (Array.isArray(value)) return value.map((item) => compact(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const next = compact(item);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

/** Fill `{{query}}` / `{{topK}}` placeholders recursively. */
function renderTemplate(template, vars) {
  if (typeof template === 'string') {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => (vars[key] === undefined ? '' : String(vars[key])));
  }
  if (Array.isArray(template)) return template.map((item) => renderTemplate(item, vars));
  if (template && typeof template === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(template)) out[key] = renderTemplate(value, vars);
    return out;
  }
  return template;
}

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function payloadOf(batch) {
  const entry = Array.isArray(batch?.results) ? batch.results[0] : undefined;
  const result = entry?.result ?? entry;
  if (!result) return undefined;
  if (result.value !== undefined) return result.value;
  const text = textOf(result.content);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalize(source, payload) {
  if (payload === undefined || payload === null) return [];
  const map = source.resultMap ?? {};
  let items = map.items ? getPath(payload, map.items) : payload;
  if (!Array.isArray(items)) items = [items];
  return items.slice(0, 12).map((item, index) => {
    const asText = typeof item === 'string' ? item : JSON.stringify(item);
    const snippetSource = map.text ? getPath(item, map.text) : typeof item === 'string' ? item : undefined;
    return compact({
      index: index + 1,
      sourceType: 'tool',
      sourceId: source.id,
      sourceName: source.name,
      title: (map.title && getPath(item, map.title)) || source.name,
      snippet: String(snippetSource ?? asText).slice(0, 320),
      url: map.url ? getPath(item, map.url) : undefined,
      page: map.page ? getPath(item, map.page) : undefined,
      headingPath: map.headingPath ? getPath(item, map.headingPath) : undefined,
      score: map.score ? getPath(item, map.score) : undefined,
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function apply(ctx) {
  const state = emptyState();
  const localIndex = createLocalIndex({ dbPath: join(dirname(stateFile()), 'local.sqlite') });
  const indexedSources = new Set();
  const ready = loadState().then((loaded) => {
    Object.assign(state, loaded);
  });

  const persist = async () => {
    await ready;
    await saveState(state);
  };

  const chunkOptions = () => ({
    chunkSize: Math.max(200, Math.min(4000, Number(state.config?.chunkSize) || 900)),
    chunkOverlap: Math.max(0, Math.min(1000, Number(state.config?.chunkOverlap) || 120)),
  });

  function sourceById(id) {
    return state.sources.find((source) => source.id === id);
  }

  function pickSource(sessionId) {
    const boundId = sessionId ? state.bindings[String(sessionId)] : undefined;
    // '__none__' is an explicit "do not use any knowledge source" choice.
    if (boundId === '__none__') return undefined;
    return (boundId && sourceById(boundId)) || sourceById(state.defaultSourceId) || state.sources[0];
  }

  async function invokeSource(source, query, exec) {
    if (source.kind === 'local') {
      // Lazy first index: a local source is searchable right after it is added.
      let indexed;
      if (!indexedSources.has(source.id)) {
        indexed = await localIndex.ingest(source.id, source.path, chunkOptions());
        indexedSources.add(source.id);
      }
      const hits = await localIndex.search(source.id, query, 8);
      return {
        hits,
        documents: indexed ? { at: Date.now(), files: indexed.files, truncated: indexed.truncated } : undefined,
        debug: compact({ dispatch: 'local' }),
      };
    }
    const rendered = renderTemplate(source.args ?? { query: '{{query}}' }, { query, topK: 8 });
    const definition = ctx.tools.get(source.tool, exec?.agent);
    if (!definition) throw new Error(`工具未注册：${source.tool}`);

    let payload;
    let dispatch = 'registry';
    let batchPreview;
    try {
      // Preferred path: the registry pipeline (policy, events, logging).
      const batch = await ctx.tools.execute({
        calls: [
          {
            type: 'tool-call',
            id: newId('kb-call'),
            name: source.tool,
            arguments: JSON.stringify(rendered),
          },
        ],
        signal: exec?.signal ?? new AbortController().signal,
        agent: exec?.agent,
      });
      batchPreview = JSON.stringify(batch).slice(0, 600);
      payload = payloadOf(batch);
      if (payload === undefined) {
        dispatch = 'registry-empty';
      }
    } catch (error) {
      // Fallback: call the definition directly when nested dispatch is unavailable.
      dispatch = 'direct:' + String(error?.message ?? error).slice(0, 160);
      console.warn('[dsh-kb] registry dispatch failed, calling definition directly:', error?.message ?? error);
      payload = await definition.execute(rendered, exec);
    }
    const hits = normalize(source, payload);
    return {
      hits,
      debug: compact({
        dispatch,
        payloadType: typeof payload,
        payloadPreview: typeof payload === 'string' ? payload.slice(0, 240) : JSON.stringify(payload ?? null).slice(0, 240),
        batchPreview,
        map: source.resultMap,
      }),
    };
  }

  ctx.effect(() =>
    ctx.tools.register({
      name: 'kb_search',
      description:
        'Search the knowledge source selected for this session. Use it before answering questions that depend on ' +
        'the user’s own documents or an external knowledge base. Returns citations (title, snippet, url/page).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query, in the user’s language.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            hits: { type: 'array', items: { type: 'object' } },
            sourceName: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['hits'],
          additionalProperties: true,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        presentationMeta: (_args, value) => compact({ citations: value.hits ?? [], sourceName: value.sourceName }),
      },
      async execute(args, exec) {
        await ready;
        const sessionId = exec?.agent?.id ? String(exec.agent.id) : '';
        const source = pickSource(sessionId);
        if (!source) {
          const bound = sessionId ? state.bindings[sessionId] : undefined;
          return {
            hits: [],
            note:
              bound === '__none__'
                ? '本轮已关闭知识库（未使用任何知识源）。'
                : '尚未配置知识源，请在输入框左侧的「知识源」中配置。',
          };
        }
        const outcome = await invokeSource(source, args?.query ?? '', exec);
        if (outcome.documents) state.documents[source.id] = outcome.documents;
        state.citations[sessionId] = { at: Date.now(), sourceName: source.name, hits: outcome.hits };
        const sessionKeys = Object.keys(state.citations);
        if (sessionKeys.length > 40) {
          sessionKeys
            .sort((a, b) => (state.citations[a]?.at ?? 0) - (state.citations[b]?.at ?? 0))
            .slice(0, sessionKeys.length - 40)
            .forEach((key) => delete state.citations[key]);
        }
        await persist();
        return compact({ hits: outcome.hits, sourceName: source.name });
      },
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/kb/api',
      handler: async (req, res) => {
        if (ctx.connection.requestRejection(req) !== undefined) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden' } });
          return;
        }
        await ready;
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = url.pathname.replace(/^\/kb\/api\/?/, '');
        const sessionId = url.searchParams.get('sessionId') ?? '';

        try {
          if (req.method === 'GET' && route === 'state') {
            writeJson(res, 200, {
              ok: true,
              value: {
                sources: state.sources,
                binding: sessionId ? state.bindings[sessionId] ?? null : null,
                defaultSourceId: state.defaultSourceId,
                citations: sessionId ? state.citations[sessionId] ?? null : null,
                documents: state.documents,
                config: state.config,
              },
            });
            return;
          }

          if (req.method === 'GET' && route === 'citations') {
            writeJson(res, 200, { ok: true, value: sessionId ? state.citations[sessionId] ?? null : null });
            return;
          }

          if (req.method === 'POST' && route === 'source') {
            const body = await readBody(req);
            if (body?.action === 'delete') {
              state.sources = state.sources.filter((source) => source.id !== body.id);
              for (const [key, value] of Object.entries(state.bindings)) {
                if (value === body.id) delete state.bindings[key];
              }
              if (state.defaultSourceId === body.id) state.defaultSourceId = null;
              delete state.documents[body.id];
              await persist();
              writeJson(res, 200, { ok: true, value: { sources: state.sources } });
              return;
            }
            const kind = body?.kind === 'local' ? 'local' : 'tool';
            const source = {
              id: body?.id || newId('src'),
              kind,
              name: String(body?.name ?? '').trim() || '未命名知识源',
              ...(kind === 'local'
                ? { path: String(body?.path ?? '').trim() }
                : {
                    tool: String(body?.tool ?? '').trim(),
                    args:
                      body?.args && typeof body.args === 'object'
                        ? body.args
                        : { query: '{{query}}', top_k: '{{topK}}' },
                    resultMap:
                      body?.resultMap && typeof body.resultMap === 'object' ? body.resultMap : undefined,
                  }),
            };
            if (kind === 'local' && !source.path) throw new Error('缺少文件夹路径（path）');
            if (kind === 'tool' && !source.tool) throw new Error('缺少工具名（tool）');
            const existing = sourceById(source.id);
            if (existing) Object.assign(existing, source);
            else state.sources.push(source);
            if (!state.defaultSourceId) state.defaultSourceId = source.id;
            await persist();
            writeJson(res, 200, { ok: true, value: { source, sources: state.sources } });
            return;
          }

          if (req.method === 'POST' && route === 'binding') {
            const body = await readBody(req);
            const targetSession = String(body?.sessionId ?? '');
            if (!targetSession) throw new Error('缺少 sessionId');
            if (body?.sourceId) state.bindings[targetSession] = String(body.sourceId);
            else delete state.bindings[targetSession];
            await persist();
            writeJson(res, 200, { ok: true, value: { binding: state.bindings[targetSession] ?? null } });
            return;
          }

          if (req.method === 'POST' && route === 'test') {
            const body = await readBody(req);
            const source = sourceById(String(body?.sourceId ?? ''));
            if (!source) throw new Error('知识源不存在');
            const outcome = await invokeSource(source, String(body?.query ?? '测试连接'), undefined);
            writeJson(res, 200, { ok: true, value: { hits: outcome.hits, debug: outcome.debug } });
            return;
          }

          if (req.method === 'POST' && route === 'ingest') {
            const body = await readBody(req);
            const source = sourceById(String(body?.sourceId ?? ''));
            if (!source || source.kind !== 'local') throw new Error('本地知识源不存在');
            const result = await localIndex.ingest(source.id, source.path, chunkOptions());
            indexedSources.add(source.id);
            state.documents[source.id] = { at: Date.now(), files: result.files, truncated: result.truncated };
            await persist();
            writeJson(res, 200, { ok: true, value: result });
            return;
          }

          if (req.method === 'POST' && route === 'config') {
            const body = await readBody(req);
            const next = body?.config ?? body ?? {};
            state.config = {
              ...state.config,
              ...(Number.isFinite(Number(next.chunkSize)) ? { chunkSize: Number(next.chunkSize) } : {}),
              ...(Number.isFinite(Number(next.chunkOverlap)) ? { chunkOverlap: Number(next.chunkOverlap) } : {}),
              ...(next.embedding && typeof next.embedding === 'object'
                ? { embedding: { ...state.config.embedding, ...next.embedding } }
                : {}),
              ...(next.rerank && typeof next.rerank === 'object'
                ? { rerank: { ...state.config.rerank, ...next.rerank } }
                : {}),
            };
            await persist();
            writeJson(res, 200, { ok: true, value: { config: state.config } });
            return;
          }

          writeJson(res, 404, { ok: false, error: { code: 'not-found', route } });
        } catch (error) {
          writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: String(error?.message ?? error) } });
        }
      },
    }),
  );
}
