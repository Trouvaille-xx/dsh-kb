/**
 * dsh-kb — client half.
 *
 *  - conversation.input.left  : source picker chip (selection only)
 *  - conversation.chat.turnTail : citation panel
 *  - sidebar.panellist + main : knowledge-source management page (add / test / rebuild / delete)
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-kb',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const apiBase = () => new URL('kb/api/', document.baseURI).href;

    /** Runtime handles captured from apply(ctx); components read them lazily. */
    const runtime = {};

    async function api(path, options) {
      const response = await fetch(new URL(path, apiBase()).href, {
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const body = await response.json().catch(() => null);
      if (!body || body.ok !== true) {
        throw new Error(body?.error?.message || body?.error?.code || `请求失败（${response.status}）`);
      }
      return body.value;
    }

    // Theme tokens registered by the current Client composition.
    const T = {
      surface: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, Canvas))',
      text: 'var(--dsw-alias-label-primary, CanvasText)',
      muted: 'var(--dsw-alias-label-secondary, GrayText)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.35))',
      borderStrong: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.5))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))',
      accent: 'var(--dsw-alias-brand-primary, #247bbf)',
      danger: 'var(--dsw-alias-state-error-primary, #d9534f)',
    };

    const chipStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: '0 10px',
      borderRadius: 14,
      border: T.border,
      background: 'transparent',
      color: 'inherit',
      fontSize: 12,
      lineHeight: 1,
      cursor: 'pointer',
    };
    const smallButton = {
      padding: '3px 8px',
      borderRadius: 6,
      border: T.border,
      background: 'transparent',
      color: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
    };
    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 7px',
      borderRadius: 6,
      border: T.border,
      background: 'transparent',
      color: 'inherit',
      fontSize: 12,
    };

    /** Knowledge-source glyph (also used by the sidebar panel entry). */
    function BookGlyph(props) {
      const size = props?.size ?? 14;
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', {
          d: 'M2.5 3.5c1.8-.9 3.7-.9 5.5.2v9c-1.8-1.1-3.7-1.1-5.5-.2z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M13.5 3.5c-1.8-.9-3.7-.9-5.5.2v9c1.8-1.1 3.7-1.1 5.5-.2z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      );
    }

    /** Small downward chevron for the dropdown affordance. */
    function Chevron(props) {
      const size = props?.size ?? 10;
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, style: { display: 'block', flex: 'none', opacity: 0.7 } },
        h('path', { d: 'M2.5 4.5L6 8l3.5-3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function useDismiss(open, close, anchorRef, popoverRef) {
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
          close();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close();
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [open, close, anchorRef, popoverRef]);
    }

    function SourceChip(props) {
      const sessionId = String(props.sessionId ?? '');
      const [open, setOpen] = React.useState(false);
      const [state, setState] = React.useState(null);
      const [message, setMessage] = React.useState('');
      const anchorRef = React.useRef(null);
      const popoverRef = React.useRef(null);
      const [pos, setPos] = React.useState({ left: 12, bottom: 80 });

      const refresh = React.useCallback(async () => {
        try {
          setState(await api(`state?sessionId=${encodeURIComponent(sessionId)}`));
        } catch (error) {
          setMessage(String(error?.message ?? error));
        }
      }, [sessionId]);

      React.useEffect(() => {
        refresh();
      }, [refresh]);

      const close = React.useCallback(() => setOpen(false), []);
      useDismiss(open, close, anchorRef, popoverRef);

      const sources = state?.sources ?? [];
      const NONE = '__none__';
      const bound = state?.binding ?? undefined;
      const selectedId = bound === NONE ? NONE : bound || state?.defaultSourceId || sources[0]?.id || null;
      const selected = sources.find((source) => source.id === selectedId);

      const toggle = () => {
        if (!open && anchorRef.current) {
          const rect = anchorRef.current.getBoundingClientRect();
          const width = 300;
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
          setPos({ left, bottom: window.innerHeight - rect.top + 8 });
        }
        setOpen((value) => !value);
      };

      const choose = async (sourceId) => {
        try {
          await api('binding', { method: 'POST', body: JSON.stringify({ sessionId, sourceId }) });
          await refresh();
          setMessage('');
          setOpen(false);
        } catch (error) {
          setMessage(String(error?.message ?? error));
        }
      };

      const openManager = () => {
        try {
          runtime.layout?.selectPanel('dsh-kb');
        } catch (error) {
          setMessage(String(error?.message ?? error));
        }
        setOpen(false);
      };

      const popover = open
        ? ReactDOM.createPortal(
            h(
              'div',
              {
                ref: popoverRef,
                role: 'dialog',
                'aria-label': '知识源',
                style: {
                  position: 'fixed',
                  left: pos.left,
                  bottom: pos.bottom,
                  width: 300,
                  maxHeight: '60vh',
                  overflow: 'auto',
                  padding: 8,
                  borderRadius: 10,
                  border: T.borderStrong,
                  background: T.surface,
                  color: T.text,
                  boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                  zIndex: 9999,
                  fontSize: 12,
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 6px' } },
                h('div', { style: { flex: 1, fontWeight: 600 } }, '知识源'),
                h(
                  'button',
                  { type: 'button', style: { ...smallButton, border: 'none', padding: '2px 6px' }, onClick: close, 'aria-label': '关闭' },
                  '×',
                ),
              ),
              sources.length === 0
                ? h('div', { style: { padding: '4px', color: T.muted } }, '还没有知识源，先在管理页添加一个。')
                : [
                    h(
                      'button',
                      {
                        key: NONE,
                        type: 'button',
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '7px 8px',
                          border: 'none',
                          borderRadius: 6,
                          background: selectedId === NONE ? T.hover : 'transparent',
                          color: 'inherit',
                          fontSize: 12,
                          textAlign: 'left',
                          cursor: 'pointer',
                        },
                        onClick: () => choose(NONE),
                      },
                      h('span', { style: { color: selectedId === NONE ? T.accent : T.muted } }, selectedId === NONE ? '●' : '○'),
                      h('span', { style: { flex: 1, color: T.muted } }, '不使用知识库'),
                    ),
                  ].concat(
                    sources.map((source) =>
                      h(
                        'button',
                        {
                          key: source.id,
                          type: 'button',
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            padding: '7px 8px',
                            border: 'none',
                            borderRadius: 6,
                            background: source.id === selectedId ? T.hover : 'transparent',
                            color: 'inherit',
                            fontSize: 12,
                            textAlign: 'left',
                            cursor: 'pointer',
                          },
                          onClick: () => choose(source.id),
                        },
                        h('span', { style: { color: source.id === selectedId ? T.accent : T.muted } }, source.id === selectedId ? '●' : '○'),
                        h('span', { style: { flex: 1 } }, source.name),
                        h('span', { style: { color: T.muted } }, source.kind === 'local' ? '本地' : '外部'),
                      ),
                    ),
                  ),
              h('div', { style: { marginTop: 6, paddingTop: 6, borderTop: T.border } },
                h('button', { type: 'button', style: { ...smallButton, width: '100%' }, onClick: openManager }, '管理知识源…'),
              ),
              message ? h('div', { style: { marginTop: 6, color: T.danger } }, message) : null,
            ),
            document.body,
          )
        : null;

      return h(
        'span',
        { ref: anchorRef, style: { display: 'inline-flex' } },
        h(
          'button',
          { type: 'button', style: chipStyle, onClick: toggle, title: '选择本轮使用的知识源' },
          h(BookGlyph, { size: 14 }),
          h('span', { style: selectedId === NONE ? { color: T.muted } : undefined }, selected ? selected.name : selectedId === NONE ? '不使用知识库' : '知识源'),
          h(Chevron, { size: 10 }),
        ),
        popover,
      );
    }

    function CitationPanel(props) {
      const sessionId = String(props.sessionId ?? '');
      const seq = props.seq;
      const [open, setOpen] = React.useState(false);
      const [expanded, setExpanded] = React.useState(-1);
      const [data, setData] = React.useState(null);

      React.useEffect(() => {
        let alive = true;
        if (!sessionId) return undefined;
        api(`citations?sessionId=${encodeURIComponent(sessionId)}`)
          .then((value) => {
            if (alive) setData(value);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [sessionId, seq]);

      const hits = data?.hits ?? [];
      if (hits.length === 0) return null;

      return h(
        'div',
        { style: { marginTop: 8, padding: '8px 10px', border: T.border, borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: T.text } },
        h(
          'button',
          { type: 'button', style: { ...chipStyle, height: 24 }, onClick: () => setOpen((value) => !value) },
          (open ? '▾' : '▸') + ` 引用 ${hits.length} 条 · 来源：${data?.sourceName ?? '知识源'}`,
        ),
        open
          ? h(
              'div',
              { style: { marginTop: 6 } },
              hits.map((hit) => {
                const isOpen = expanded === hit.index;
                const location = hit.page ? `第 ${hit.page} 页` : Array.isArray(hit.headingPath) ? hit.headingPath.join(' / ') : '';
                return h(
                  'div',
                  { key: hit.index, style: { padding: '4px 0', borderTop: T.border } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h(
                      'button',
                      {
                        type: 'button',
                        style: { flex: 1, padding: '2px 0', border: 'none', background: 'transparent', color: 'inherit', fontSize: 12, textAlign: 'left', cursor: 'pointer' },
                        onClick: () => setExpanded(isOpen ? -1 : hit.index),
                      },
                      `[${hit.index}] ${hit.title}${location ? ' · ' + location : ''}`,
                    ),
                    hit.url
                      ? h('button', { type: 'button', style: smallButton, onClick: () => window.open(hit.url, '_blank', 'noopener') }, '打开原文')
                      : typeof props.openFile === 'function' && hit.title
                        ? h('button', { type: 'button', style: smallButton, onClick: () => props.openFile(hit.title) }, '打开文件')
                        : null,
                  ),
                  isOpen ? h('div', { style: { marginTop: 4, color: T.muted, whiteSpace: 'pre-wrap' } }, hit.snippet) : null,
                );
              }),
            )
          : null,
      );
    }

    function ManagerPanel() {
      const [state, setState] = React.useState(null);
      const [activeId, setActiveId] = React.useState(null);
      const [creating, setCreating] = React.useState(false);
      const [tab, setTab] = React.useState('local');
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [configForm, setConfigForm] = React.useState(null);
      const [message, setMessage] = React.useState('');
      const [form, setForm] = React.useState({
        kind: 'local',
        name: '',
        path: '',
        tool: '',
        argsText: '{"query":"{{query}}","top_k":"{{topK}}"}',
        mapText: '',
      });

      const refresh = React.useCallback(async () => {
        try {
          const value = await api('state');
          setState(value);
          return value;
        } catch (error) {
          setMessage(String(error?.message ?? error));
          return null;
        }
      }, []);

      React.useEffect(() => {
        refresh().then((value) => {
          if (value?.config) setConfigForm(value.config);
          if (value?.sources?.length) {
            setActiveId((current) => {
              if (current && value.sources.some((source) => source.id === current)) return current;
              const first = value.sources[0];
              if (first) setTab(first.kind);
              return first?.id ?? null;
            });
          }
        });
      }, [refresh]);

      React.useEffect(() => {
        if (!settingsOpen) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setSettingsOpen(false);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [settingsOpen]);

      const switchTab = (nextTab) => {        setTab(nextTab);
        setCreating(false);
        setMessage('');
        const first = sources.find((source) => source.kind === nextTab);
        setActiveId(first?.id ?? null);
      };

      const startCreate = () => {
        setCreating(true);
        setMessage('');
        resetForm();
        setForm((current) => ({ ...current, kind: tab }));
      };

      const sources = state?.sources ?? [];
      const visibleSources = sources.filter((source) => source.kind === tab);
      const active = sources.find((source) => source.id === activeId) || null;
      const docs = active ? state?.documents?.[active.id] : null;
      const files = docs?.files ?? [];

      const resetForm = () =>
        setForm({ kind: 'local', name: '', path: '', tool: '', argsText: '{"query":"{{query}}","top_k":"{{topK}}"}', mapText: '' });

      const addSource = async () => {
        try {
          const payload = { kind: form.kind, name: form.name, path: form.path };
          if (form.kind === 'tool') {
            payload.tool = form.tool;
            payload.args = form.argsText.trim() ? JSON.parse(form.argsText) : { query: '{{query}}' };
            payload.resultMap = form.mapText.trim() ? JSON.parse(form.mapText) : undefined;
          }
          const value = await api('source', { method: 'POST', body: JSON.stringify(payload) });
          resetForm();
          setCreating(false);
          if (value?.source?.id) setActiveId(value.source.id);
          await refresh();
          if (payload.kind === 'local' && value?.source?.id) {
            setMessage('已创建，正在建索引…');
            const result = await api('ingest', { method: 'POST', body: JSON.stringify({ sourceId: value.source.id }) });
            setMessage(`索引完成：${result?.documents ?? 0} 个文件 / ${result?.chunks ?? 0} 个块`);
            await refresh();
          } else {
            setMessage('已创建');
          }
        } catch (error) {
          setMessage(`创建失败：${String(error?.message ?? error)}`);
        }
      };

      const test = async (sourceId) => {
        setMessage('测试中…');
        try {
          const value = await api('test', { method: 'POST', body: JSON.stringify({ sourceId, query: '测试连接' }) });
          setMessage(`连接正常，返回 ${value?.hits?.length ?? 0} 条`);
        } catch (error) {
          setMessage(`测试失败：${String(error?.message ?? error)}`);
        }
      };

      const ingest = async (sourceId) => {
        setMessage('建索引中…');
        try {
          const value = await api('ingest', { method: 'POST', body: JSON.stringify({ sourceId }) });
          const failures = value?.failures?.length ? `，${value.failures.length} 个失败` : '';
          setMessage(`索引完成：${value?.documents ?? 0} 个文件 / ${value?.chunks ?? 0} 个块${failures}`);
          await refresh();
        } catch (error) {
          setMessage(`建索引失败：${String(error?.message ?? error)}`);
        }
      };

      const removeSource = async (sourceId) => {
        try {
          await api('source', { method: 'POST', body: JSON.stringify({ action: 'delete', id: sourceId }) });
          setActiveId(null);
          await refresh();
          setMessage('已删除');
        } catch (error) {
          setMessage(String(error?.message ?? error));
        }
      };

      const saveConfig = async () => {
        try {
          const value = await api('config', { method: 'POST', body: JSON.stringify({ config: configForm }) });
          setConfigForm(value.config);
          setSettingsOpen(false);
          setMessage('设置已保存。分块参数变更后请重建索引。');
          await refresh();
        } catch (error) {
          setMessage(`保存失败：${String(error?.message ?? error)}`);
        }
      };

      const rel = (ms) => {
        if (!ms) return '—';
        const diff = Date.now() - ms;
        if (diff < 60_000) return '刚刚';
        if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
        if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
        return `${Math.floor(diff / 86_400_000)} 天前`;
      };

      const css = `
        .dsh-kb-shell{display:flex;height:100%;min-height:0;color:${T.text};font-size:13px;line-height:1.55}
        .dsh-kb-rail{width:236px;flex:none;border-right:${T.border};display:flex;flex-direction:column;padding:12px 10px;box-sizing:border-box;overflow:auto}
        .dsh-kb-new{width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:10px;border-radius:8px;border:1px dashed ${'var(--dsw-alias-border-l2, rgba(127,127,127,0.45))'};background:transparent;color:inherit;font-size:13px;text-align:left;cursor:pointer;font-family:inherit}
        .dsh-kb-new:hover{background:${T.hover}}
        .dsh-kb-rail-item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:2px;border:none;border-radius:8px;background:transparent;color:inherit;font-size:13px;text-align:left;cursor:pointer;font-family:inherit}
        .dsh-kb-rail-item:hover{background:${T.hover}}
        .dsh-kb-rail-item.is-active{background:${T.hover};font-weight:600}
        .dsh-kb-rail-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dsh-kb-rail-kind{flex:none;font-size:11px;color:${T.muted}}
        .dsh-kb-rail-empty{color:${T.muted};padding:10px;font-size:12px}
        .dsh-kb-main{flex:1;min-width:0;padding:20px 28px;overflow:auto;box-sizing:border-box}
        .dsh-kb-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:2px}
        .dsh-kb-h1{font-size:18px;font-weight:600;margin:0}
        .dsh-kb-meta{color:${T.muted};font-size:12px;margin-top:2px;word-break:break-all}
        .dsh-kb-toolbar{display:flex;gap:8px;margin:14px 0;align-items:center}
        .dsh-kb-toolbar .grow{flex:1}
        .dsh-kb-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
        .dsh-kb-table th{text-align:left;color:${T.muted};font-weight:500;padding:8px 10px;border-bottom:${T.border}}
        .dsh-kb-table td{padding:9px 10px;border-bottom:${T.border};vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dsh-kb-table tbody tr:hover td{background:${T.hover}}
        .dsh-kb-file{display:flex;align-items:center;gap:6px;min-width:0}
        .dsh-kb-file svg{flex:none;color:${T.muted}}
        .dsh-kb-status-ready{color:${'var(--dsw-alias-state-success-primary, #2f9e44)'}}
        .dsh-kb-status-failed{color:${'var(--dsw-alias-state-error-primary, #d9534f)'}}
        .dsh-kb-status-muted{color:${T.muted}}
        .dsh-kb-btn{padding:5px 11px;border-radius:6px;border:${T.border};background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}
        .dsh-kb-btn:hover{background:${T.hover}}
        .dsh-kb-btn.is-primary{background:${T.accent};border-color:transparent;color:#fff}
        .dsh-kb-btn.is-active{background:${T.hover};font-weight:600}
        .dsh-kb-btn.is-danger{color:${'var(--dsw-alias-state-error-primary, #d9534f)'}}
        .dsh-kb-input{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:${T.border};background:transparent;color:inherit;font-size:12px;font-family:inherit}
        .dsh-kb-input:focus{outline:2px solid ${T.accent};outline-offset:1px}
        .dsh-kb-form{display:grid;gap:8px;max-width:520px;margin-top:12px}
        .dsh-kb-seg{display:flex;gap:6px;margin:12px 0}
        .dsh-kb-msg{color:${T.muted};margin-top:14px;font-size:12px}
        .dsh-kb-empty{color:${T.muted};padding:40px 0;text-align:center;font-size:13px}
        .dsh-kb-tip{color:${T.muted};font-size:12px;margin-top:10px}
        .dsh-kb-tabs{display:flex;gap:4px;margin-bottom:10px}
        .dsh-kb-section{font-weight:600;margin-top:16px;padding-top:12px;border-top:${T.border}}
        .dsh-kb-label{display:grid;gap:4px;font-size:12px;color:${T.muted}}
        .dsh-kb-mask{position:fixed;inset:0;background:rgba(0,0,0,0.28);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
        .dsh-kb-dialog{width:min(620px,100%);max-height:82vh;overflow:auto;box-sizing:border-box;padding:20px 24px;border-radius:12px;border:${T.border};background:${T.surface};color:${T.text};box-shadow:0 18px 48px rgba(0,0,0,0.28)}
        .dsh-kb-tab{flex:1;padding:6px 4px;border-radius:6px;border:none;background:transparent;color:${T.muted};font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
        .dsh-kb-tab:hover{background:${T.hover}}
        .dsh-kb-tab.is-active{background:${T.hover};color:${T.text};font-weight:600}
      `;

      const createView = () =>
        h(
          React.Fragment,
          null,
          h('div', { className: 'dsh-kb-head' }, h('h1', { className: 'dsh-kb-h1' }, '新建知识库')),
          h(
            'div',
            { className: 'dsh-kb-seg' },
            ['local', 'tool'].map((kind) =>
              h(
                'button',
                {
                  key: kind,
                  type: 'button',
                  className: `dsh-kb-btn${form.kind === kind ? ' is-active' : ''}`,
                  onClick: () => setForm({ ...form, kind }),
                },
                kind === 'local' ? '本地文件夹' : '外部工具源',
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-kb-form' },
            h('input', {
              className: 'dsh-kb-input',
              placeholder: '名称，如「产品文档」',
              value: form.name,
              onChange: (event) => setForm({ ...form, name: event.target.value }),
            }),
            form.kind === 'local'
              ? h('input', {
                  className: 'dsh-kb-input',
                  placeholder: '文件夹绝对路径，如 D:\\docs',
                  value: form.path,
                  onChange: (event) => setForm({ ...form, path: event.target.value }),
                })
              : h(
                  React.Fragment,
                  null,
                  h('input', {
                    className: 'dsh-kb-input',
                    placeholder: '工具名，如 mcp__ima__search',
                    value: form.tool,
                    onChange: (event) => setForm({ ...form, tool: event.target.value }),
                  }),
                  h('textarea', {
                    className: 'dsh-kb-input',
                    style: { minHeight: 54, fontFamily: 'monospace' },
                    placeholder: '参数模板 JSON',
                    value: form.argsText,
                    onChange: (event) => setForm({ ...form, argsText: event.target.value }),
                  }),
                  h('textarea', {
                    className: 'dsh-kb-input',
                    style: { minHeight: 42, fontFamily: 'monospace' },
                    placeholder: '结果映射 JSON（可选）',
                    value: form.mapText,
                    onChange: (event) => setForm({ ...form, mapText: event.target.value }),
                  }),
                ),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h('button', { type: 'button', className: 'dsh-kb-btn is-primary', onClick: addSource }, form.kind === 'local' ? '创建并建索引' : '创建'),
              h('button', { type: 'button', className: 'dsh-kb-btn', onClick: () => setCreating(false) }, '取消'),
            ),
            h(
              'div',
              { className: 'dsh-kb-tip' },
              form.kind === 'local'
                ? '支持 Markdown / 文本 / PDF / docx；PDF 引用带页码。创建后自动建索引。'
                : '工具需已在 DSH 中注册（MCP server / skill / 其他插件工具）。',
            ),
          ),
        );

      const detailView = () =>
        h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dsh-kb-head' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('h1', { className: 'dsh-kb-h1' }, active.name),
              h(
                'div',
                { className: 'dsh-kb-meta' },
                (active.kind === 'local' ? `本地文件夹 · ${active.path}` : `外部工具 · ${active.tool}`) +
                  (docs?.at ? ` · 更新于 ${rel(docs.at)}` : ''),
              ),
            ),
            h('button', { type: 'button', className: 'dsh-kb-btn', onClick: () => { setSettingsOpen(true); setCreating(false); } }, '设置'),
            h('button', { type: 'button', className: 'dsh-kb-btn is-danger', onClick: () => removeSource(active.id) }, '删除'),
          ),
          h(
            'div',
            { className: 'dsh-kb-toolbar' },
            active.kind === 'local'
              ? h('button', { type: 'button', className: 'dsh-kb-btn is-primary', onClick: () => ingest(active.id) }, '重建索引')
              : h('button', { type: 'button', className: 'dsh-kb-btn is-primary', onClick: () => test(active.id) }, '测试连接'),
            h('span', { className: 'grow' }),
            h('span', { className: 'dsh-kb-meta' }, active.kind === 'local' ? `${files.length} 个文件` : '外部检索'),
          ),
          active.kind === 'local'
            ? files.length === 0
              ? h('div', { className: 'dsh-kb-empty' }, '还没有索引。点「重建索引」开始。')
              : h(
                  'table',
                  { className: 'dsh-kb-table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', { style: { width: '52%' } }, '名称'),
                      h('th', { style: { width: '12%' } }, '类型'),
                      h('th', { style: { width: '14%' } }, '状态'),
                      h('th', { style: { width: '22%' } }, '更新时间'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    files.map((file) =>
                      h(
                        'tr',
                        { key: file.path },
                        h(
                          'td',
                          null,
                          h(
                            'span',
                            { className: 'dsh-kb-file', title: file.path },
                            h(FileGlyph, { size: 14 }),
                            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, file.path),
                          ),
                        ),
                        h('td', null, file.type || '—'),
                        h(
                          'td',
                          null,
                          h(
                            'span',
                            {
                              className:
                                file.status === 'ready'
                                  ? 'dsh-kb-status-ready'
                                  : file.status === 'failed'
                                    ? 'dsh-kb-status-failed'
                                    : 'dsh-kb-status-muted',
                            },
                            file.status === 'ready'
                              ? '✓ 就绪'
                              : file.status === 'failed'
                                ? '✗ 失败'
                                : file.status === 'empty'
                                  ? '空'
                                  : '跳过',
                          ),
                        ),
                        h('td', { className: 'dsh-kb-meta' }, rel(file.updatedAt)),
                      ),
                    ),
                  ),
                )
            : h(
                'div',
                { className: 'dsh-kb-empty' },
                '外部工具源由对方系统负责解析与索引；这里只做检索与引用。',
              ),
        );

      const settingsView = () => {
        const config = configForm ?? state?.config ?? {};
        const embedding = config.embedding ?? { provider: 'none', model: '', baseUrl: '' };
        const rerank = config.rerank ?? { provider: 'none', model: '' };
        const patch = (next) => setConfigForm({ ...config, ...next });
        const patchEmbedding = (next) => patch({ embedding: { ...embedding, ...next } });
        const patchRerank = (next) => patch({ rerank: { ...rerank, ...next } });

        return h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dsh-kb-head' },
            h('h1', { className: 'dsh-kb-h1' }, '设置'),
            h('div', { style: { flex: 1 } }),
            h('button', { type: 'button', className: 'dsh-kb-btn', onClick: () => setSettingsOpen(false) }, '返回'),
            h('button', { type: 'button', className: 'dsh-kb-btn is-primary', onClick: saveConfig }, '保存'),
          ),
          h(
            'div',
            { className: 'dsh-kb-form', style: { maxWidth: 560 } },
            h('div', { className: 'dsh-kb-section' }, '分块'),
            h(
              'label',
              { className: 'dsh-kb-label' },
              '块大小（字符）',
              h('input', {
                className: 'dsh-kb-input',
                type: 'number',
                value: config.chunkSize ?? 900,
                onChange: (event) => patch({ chunkSize: Number(event.target.value) }),
              }),
            ),
            h(
              'label',
              { className: 'dsh-kb-label' },
              '重叠（字符）',
              h('input', {
                className: 'dsh-kb-input',
                type: 'number',
                value: config.chunkOverlap ?? 120,
                onChange: (event) => patch({ chunkOverlap: Number(event.target.value) }),
              }),
            ),
            h('div', { className: 'dsh-kb-tip' }, '修改分块参数后需要重建索引才会生效。'),
            h('div', { className: 'dsh-kb-section' }, '向量模型'),
            h(
              'label',
              { className: 'dsh-kb-label' },
              '提供方',
              h(
                'select',
                {
                  className: 'dsh-kb-input',
                  value: embedding.provider ?? 'none',
                  onChange: (event) => patchEmbedding({ provider: event.target.value }),
                },
                h('option', { value: 'none' }, '关闭（仅关键词检索）'),
                h('option', { value: 'openai' }, 'OpenAI 兼容接口'),
                h('option', { value: 'ollama' }, 'Ollama'),
                h('option', { value: 'local' }, '本地 ONNX 模型'),
              ),
            ),
            h(
              'label',
              { className: 'dsh-kb-label' },
              '模型 / 接口地址',
              h('input', {
                className: 'dsh-kb-input',
                placeholder: '如 bge-m3 或 http://127.0.0.1:11434',
                value: embedding.model ?? '',
                onChange: (event) => patchEmbedding({ model: event.target.value }),
              }),
            ),
            h('div', { className: 'dsh-kb-tip' }, '配置会保存；向量检索将在下一版接入，当前检索仍为关键词（FTS5）。'),
            h('div', { className: 'dsh-kb-section' }, '重排模型'),
            h(
              'label',
              { className: 'dsh-kb-label' },
              '提供方',
              h(
                'select',
                {
                  className: 'dsh-kb-input',
                  value: rerank.provider ?? 'none',
                  onChange: (event) => patchRerank({ provider: event.target.value }),
                },
                h('option', { value: 'none' }, '关闭'),
                h('option', { value: 'openai' }, 'OpenAI 兼容接口'),
                h('option', { value: 'cohere' }, 'Cohere Rerank'),
              ),
            ),
            h(
              'label',
              { className: 'dsh-kb-label' },
              '模型',
              h('input', {
                className: 'dsh-kb-input',
                placeholder: '如 bge-reranker-v2-m3',
                value: rerank.model ?? '',
                onChange: (event) => patchRerank({ model: event.target.value }),
              }),
            ),
            h('div', { className: 'dsh-kb-tip' }, '重排将在下一版接入；当前结果按 BM25 排序。'),
          ),
        );
      };

      return h(
        'div',
        { className: 'dsh-kb-shell' },
        h('style', null, css),
        h(
          'aside',
          { className: 'dsh-kb-rail' },
          h(
            'div',
            { className: 'dsh-kb-tabs' },
            [
              ['local', '本地知识库'],
              ['tool', '外部知识库'],
            ].map(([kind, label]) =>
              h(
                'button',
                {
                  key: kind,
                  type: 'button',
                  className: `dsh-kb-tab${tab === kind ? ' is-active' : ''}`,
                  onClick: () => switchTab(kind),
                },
                label,
              ),
            ),
          ),
          h('button', { type: 'button', className: 'dsh-kb-new', onClick: startCreate }, tab === 'local' ? '＋ 新建本地知识库' : '＋ 新建外部知识库'),
          visibleSources.length === 0 && !creating
            ? h('div', { className: 'dsh-kb-rail-empty' }, tab === 'local' ? '还没有本地知识库' : '还没有外部知识库')
            : visibleSources.map((source) =>
                h(
                  'button',
                  {
                    key: source.id,
                    type: 'button',
                    className: `dsh-kb-rail-item${source.id === activeId && !creating ? ' is-active' : ''}`,
                    onClick: () => { setActiveId(source.id); setCreating(false); setMessage(''); },
                  },
                  h('span', { className: 'dsh-kb-rail-name' }, source.name),
                ),
              ),
        ),
        h(
          'section',
          { className: 'dsh-kb-main' },
          creating ? createView() : active ? detailView() : h('div', { className: 'dsh-kb-empty' }, '选择左侧知识库，或新建一个。'),
          message ? h('div', { className: 'dsh-kb-msg' }, message) : null,
        ),
        settingsOpen
          ? ReactDOM.createPortal(
              h(
                'div',
                {
                  className: 'dsh-kb-mask',
                  onMouseDown: (event) => {
                    if (event.target === event.currentTarget) setSettingsOpen(false);
                  },
                },
                h('div', { className: 'dsh-kb-dialog', role: 'dialog', 'aria-label': '知识库设置' }, settingsView()),
              ),
              document.body,
            )
          : null,
      );
    }

    /** Generic file glyph for the document table. */
    function FileGlyph(props) {
      const size = props?.size ?? 14;
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M4 1.8h5l3 3v9.4H4z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }),
        h('path', { d: 'M9 1.8v3h3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }),
      );
    }

    function PanelIcon(props) {
      return h(BookGlyph, { size: props?.size ?? 16 });
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        runtime.layout = ctx.layout;
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-kb-chip', order: 40 }, SourceChip),
        );
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'dsh-kb-citations', order: 30 }, CitationPanel),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-kb', order: 50, label: '知识库' }, PanelIcon),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'dsh-kb' }, ManagerPanel),
        );
      },
    };
  },
});
