'use strict';

// 联网搜索后端：Tavily / Serper。两者都返回结构化结果，统一成 {title, url, snippet}[]。
const TIMEOUT = 20000;

async function requestJSON(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.message || ('HTTP ' + res.status));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function tavily(query, apiKey, opts = {}) {
  const data = await requestJSON('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: opts.depth || 'basic',
      max_results: opts.maxResults || 5,
      include_answer: false,
    }),
  });
  return (data.results || []).map(r => ({
    title: String(r.title || '').slice(0, 120),
    url: String(r.url || ''),
    snippet: String(r.content || '').slice(0, 300),
  }));
}

async function serper(query, apiKey, opts = {}) {
  const data = await requestJSON('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, num: opts.maxResults || 5, hl: 'zh-cn' }),
  });
  const organic = data.organic || [];
  const out = organic.map(r => ({
    title: String(r.title || '').slice(0, 120),
    url: String(r.link || ''),
    snippet: String(r.snippet || r.description || '').slice(0, 300),
  }));
  // Serper 的 answerBox / knowledgeGraph 对时效问题很有用，作为首条注入
  const answer = data.answerBox?.answer || data.answerBox?.snippet;
  if (answer) out.unshift({ title: '即时答案', url: data.answerBox?.link || '', snippet: String(answer).slice(0, 300) });
  return out;
}

function formatResults(results, maxChars = 2200) {
  if (!results.length) return '（搜索没有返回结果）';
  let text = '';
  for (const [i, r] of results.entries()) {
    const block = `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? '\n' + r.url : ''}\n\n`;
    if (text.length + block.length > maxChars) break;
    text += block;
  }
  return text.trim();
}

async function search(query, cfg) {
  const provider = (cfg.searchProvider || 'none').toLowerCase();
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new Error('搜索词为空');
  if (provider === 'tavily') {
    if (!cfg.tavilyKey) throw new Error('未配置 Tavily API Key');
    return { results: await tavily(q, cfg.tavilyKey), provider: 'tavily' };
  }
  if (provider === 'serper') {
    if (!cfg.serperKey) throw new Error('未配置 Serper API Key');
    return { results: await serper(q, cfg.serperKey), provider: 'serper' };
  }
  throw new Error('未启用联网搜索，请在语音设置中选择 Tavily 或 Serper');
}

async function test(provider, apiKey) {
  const probe = '今天日期';
  if (provider === 'tavily') {
    if (!apiKey) throw new Error('未填写 Tavily API Key');
    const t0 = Date.now();
    const results = await tavily(probe, apiKey, { maxResults: 1 });
    return { ok: true, provider, ms: Date.now() - t0, count: results.length };
  }
  if (provider === 'serper') {
    if (!apiKey) throw new Error('未填写 Serper API Key');
    const t0 = Date.now();
    const results = await serper(probe, apiKey, { maxResults: 1 });
    return { ok: true, provider, ms: Date.now() - t0, count: results.length };
  }
  throw new Error('请选择搜索服务');
}

module.exports = { search, test, tavily, serper, formatResults };
