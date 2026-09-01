import { createServer as createHttpServer } from 'node:http'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
const dataDirectory = resolve(process.env.MODEL_WORKBENCH_DATA_DIR?.trim() || process.cwd())

let env
let vite
if (mode === 'production') {
  for (const fileName of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try { process.loadEnvFile(resolve(dataDirectory, fileName)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  env = { ...process.env }
} else {
  const viteModule = await import('vite')
  env = viteModule.loadEnv(mode, process.cwd(), '')
  vite = await viteModule.createServer({ server: { middlewareMode: true }, appType: 'spa' })
}

const port = Number(env.PORT || 5173)
const host = env.HOST || '127.0.0.1'
const settingsPath = resolve(dataDirectory, '.model-api-settings.json')
const settingsTempPath = resolve(dataDirectory, '.model-api-settings.tmp.json')
const distDirectory = resolve(fileURLToPath(new URL('./dist/', import.meta.url)))
const modelCatalogCache = new Map()
const modelCatalogTtl = 5 * 60 * 1000

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const protocols = new Set(['openai-responses', 'openai-chat', 'anthropic-messages', 'google-generate-content'])
const defaults = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6', suggestedModels: ['gpt-5.6', 'gpt-5.1', 'gpt-4.1'], envKey: 'OPENAI_API_KEY', builtIn: true },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5', suggestedModels: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'], envKey: 'ANTHROPIC_API_KEY', builtIn: true },
  { id: 'google', label: 'Google Gemini', protocol: 'google-generate-content', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.7-flash', suggestedModels: ['gemini-3.7-flash', 'gemini-3.5-flash'], envKey: 'GEMINI_API_KEY', builtIn: true },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', suggestedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'], envKey: 'DEEPSEEK_API_KEY', builtIn: true },
]

async function readSettingsFile() {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    return Array.isArray(parsed.providers) ? parsed.providers : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new Error('本地模型配置文件无法读取。')
  }
}

async function saveSettingsFile(providers) {
  const body = `${JSON.stringify({ version: 1, providers }, null, 2)}\n`
  await writeFile(settingsTempPath, body, { encoding: 'utf8', mode: 0o600 })
  await rename(settingsTempPath, settingsPath)
}

async function providerSettings() {
  const saved = await readSettingsFile()
  const savedById = new Map(saved.map((item) => [item.id, item]))
  const builtIns = defaults.map((definition) => ({ ...definition, ...savedById.get(definition.id), builtIn: true }))
  const customs = saved.filter((item) => !defaults.some((definition) => definition.id === item.id)).map((item) => ({ ...item, suggestedModels: item.suggestedModels || (item.model ? [item.model] : []), builtIn: false }))
  return [...builtIns, ...customs].map((item) => ({ ...item, enabled: item.enabled !== false, apiKey: item.apiKey || (item.envKey ? env[item.envKey] : '') || '', keySource: item.apiKey ? 'local' : item.envKey && env[item.envKey] ? 'environment' : 'none' }))
}

function maskKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

function publicSetting(item) {
  const { apiKey, envKey, ...setting } = item
  return { ...setting, hasApiKey: Boolean(apiKey), apiKeyMasked: maskKey(apiKey) }
}

function publicModel(provider, model, available) {
  return { id: `${provider.id}:${model}`, provider: provider.label, providerId: provider.id, label: model, model, available }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 1_000_000) throw Object.assign(new Error('请求内容过大。'), { status: 413 })
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function fetchJson(url, options, timeoutMs = 120_000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || payload?.message || `上游服务返回 HTTP ${response.status}`
    throw Object.assign(new Error(message), { status: response.status })
  }
  return { payload, response }
}

function endpoint(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function joinText(parts) {
  return parts.filter(Boolean).join('\n').trim()
}

async function fetchProviderModelIds(provider) {
  let payload
  if (provider.protocol === 'anthropic-messages') {
    ;({ payload } = await fetchJson(endpoint(provider.baseUrl, 'v1/models'), {
      method: 'GET', headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
    }, 20_000))
  } else if (provider.protocol === 'google-generate-content') {
    ;({ payload } = await fetchJson(endpoint(provider.baseUrl, 'models'), {
      method: 'GET', headers: { 'x-goog-api-key': provider.apiKey },
    }, 20_000))
  } else {
    ;({ payload } = await fetchJson(endpoint(provider.baseUrl, 'models'), {
      method: 'GET', headers: { Authorization: `Bearer ${provider.apiKey}` },
    }, 20_000))
  }

  const rawModels = provider.protocol === 'google-generate-content'
    ? (payload.models || []).filter((item) => !Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.includes('generateContent')).map((item) => String(item.name || '').replace(/^models\//, ''))
    : (payload.data || payload.models || []).map((item) => typeof item === 'string' ? item : String(item.id || item.name || '').replace(/^models\//, ''))
  const models = [...new Set(rawModels.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 500)
  if (!models.length) throw Object.assign(new Error('厂商接口未返回可用模型，请检查 Base URL 或使用自定义模型 ID。'), { status: 502 })
  return models
}

async function providerModelIds(provider, force = false) {
  const cached = modelCatalogCache.get(provider.id)
  const fingerprint = `${provider.protocol}\n${provider.baseUrl}\n${provider.apiKey}`
  if (!force && cached?.fingerprint === fingerprint && Date.now() - cached.loadedAt < modelCatalogTtl) return cached.models
  try {
    const models = await fetchProviderModelIds(provider)
    modelCatalogCache.set(provider.id, { fingerprint, loadedAt: Date.now(), models })
    return models
  } catch (error) {
    if (cached?.fingerprint === fingerprint && cached.models?.length) return cached.models
    throw error
  }
}

async function publicCatalog(force = false) {
  const providers = (await providerSettings()).filter((item) => item.enabled)
  const results = await Promise.all(providers.map(async (provider) => {
    const ready = Boolean(provider.apiKey && provider.baseUrl && provider.model)
    if (!ready) return { models: [publicModel(provider, provider.model, false)], warning: '' }
    try {
      const models = await providerModelIds(provider, force)
      return { models: models.map((model) => publicModel(provider, model, true)), warning: '' }
    } catch (error) {
      return { models: [publicModel(provider, provider.model, true)], warning: `${provider.label} 自动扫描失败，暂时使用已保存模型：${error.message || '未知错误'}` }
    }
  }))
  return { models: results.flatMap((result) => result.models), warnings: results.map((result) => result.warning).filter(Boolean) }
}

async function callOpenAIResponses(provider, input) {
  const { payload, response } = await fetchJson(endpoint(provider.baseUrl, 'responses'), {
    method: 'POST', headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, instructions: input.systemPrompt || undefined, input: input.userPrompt, temperature: input.temperature, max_output_tokens: input.maxTokens, store: false }),
  })
  const text = payload.output_text || joinText((payload.output || []).flatMap((item) => item.type === 'message' ? (item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text) : []))
  return { text, inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens, requestId: response.headers.get('x-request-id') }
}

async function callOpenAIChat(provider, input) {
  const messages = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  messages.push({ role: 'user', content: input.userPrompt })
  const { payload, response } = await fetchJson(endpoint(provider.baseUrl, 'chat/completions'), {
    method: 'POST', headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, messages, temperature: input.temperature, max_tokens: input.maxTokens, stream: false }),
  })
  return { text: payload.choices?.[0]?.message?.content?.trim() || '', inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens, requestId: response.headers.get('x-request-id') || response.headers.get('request-id') }
}

async function callAnthropic(provider, input) {
  const { payload, response } = await fetchJson(endpoint(provider.baseUrl, 'v1/messages'), {
    method: 'POST', headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, system: input.systemPrompt || undefined, messages: [{ role: 'user', content: input.userPrompt }], temperature: input.temperature, max_tokens: input.maxTokens }),
  })
  return { text: joinText((payload.content || []).filter((part) => part.type === 'text').map((part) => part.text)), inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens, requestId: response.headers.get('request-id') }
}

async function callGoogle(provider, input) {
  const { payload, response } = await fetchJson(endpoint(provider.baseUrl, `models/${encodeURIComponent(provider.model)}:generateContent`), {
    method: 'POST', headers: { 'x-goog-api-key': provider.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: input.systemPrompt ? { parts: [{ text: input.systemPrompt }] } : undefined, contents: [{ role: 'user', parts: [{ text: input.userPrompt }] }], generationConfig: { temperature: input.temperature, maxOutputTokens: input.maxTokens } }),
  })
  return { text: joinText((payload.candidates || []).flatMap((candidate) => (candidate.content?.parts || []).map((part) => part.text))), inputTokens: payload.usageMetadata?.promptTokenCount, outputTokens: payload.usageMetadata?.candidatesTokenCount, requestId: response.headers.get('x-request-id') }
}

const adapters = { 'openai-responses': callOpenAIResponses, 'openai-chat': callOpenAIChat, 'anthropic-messages': callAnthropic, 'google-generate-content': callGoogle }

function validateSetting(candidate) {
  const id = String(candidate.id || '').trim().toLowerCase()
  const label = String(candidate.label || '').trim()
  const protocol = String(candidate.protocol || '')
  const baseUrl = String(candidate.baseUrl || '').trim().replace(/\/+$/, '')
  const model = String(candidate.model || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) throw Object.assign(new Error('厂商 ID 只能包含小写字母、数字和连字符。'), { status: 400 })
  if (!label) throw Object.assign(new Error('厂商名称不能为空。'), { status: 400 })
  if (!protocols.has(protocol)) throw Object.assign(new Error('不支持该接口协议。'), { status: 400 })
  let url
  try { url = new URL(baseUrl) } catch { throw Object.assign(new Error('Base URL 格式不正确。'), { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Base URL 必须使用 HTTP 或 HTTPS。'), { status: 400 })
  if (!model) throw Object.assign(new Error('模型 ID 不能为空。'), { status: 400 })
  return { id, label, protocol, baseUrl, model, enabled: candidate.enabled !== false }
}

async function upsertSetting(body) {
  const normalized = validateSetting(body)
  const current = await readSettingsFile()
  const existing = current.find((item) => item.id === normalized.id)
  const defaultDefinition = defaults.find((item) => item.id === normalized.id)
  const next = { ...(existing || {}), ...normalized }
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) next.apiKey = body.apiKey.trim()
  if (body.clearApiKey === true) delete next.apiKey
  if (defaultDefinition) next.builtIn = true
  const providers = [...current.filter((item) => item.id !== normalized.id), next]
  await saveSettingsFile(providers)
  modelCatalogCache.delete(normalized.id)
  return (await providerSettings()).find((item) => item.id === normalized.id)
}

async function deleteSetting(id) {
  if (defaults.some((item) => item.id === id)) throw Object.assign(new Error('内置厂商不能删除，可以将其停用。'), { status: 400 })
  const current = await readSettingsFile()
  await saveSettingsFile(current.filter((item) => item.id !== id))
  modelCatalogCache.delete(id)
}

async function invoke(provider, input) {
  const adapter = adapters[provider.protocol]
  if (!adapter) throw Object.assign(new Error('该接口协议尚未支持。'), { status: 400 })
  const startedAt = performance.now()
  const result = await adapter(provider, input)
  if (!result.text) throw new Error(`${provider.label} 返回了空响应。`)
  return { ...result, duration: (performance.now() - startedAt) / 1000, model: provider.model, provider: provider.label }
}

async function evaluate(req, res) {
  const body = await readJson(req)
  const requestedId = String(body.modelId || '')
  const separator = requestedId.indexOf(':')
  const providerId = separator > 0 ? requestedId.slice(0, separator) : ''
  const requestedModel = separator > 0 ? requestedId.slice(separator + 1).trim() : ''
  const providers = await providerSettings()
  const provider = providers.find((item) => item.id === providerId && item.enabled)
  if (!provider || !requestedModel) return json(res, 400, { error: '不支持该模型，模型配置可能已更新，请刷新后重试。' })
  if (!provider.apiKey) return json(res, 503, { error: `${provider.label} 尚未配置 API Key。` })
  if (requestedModel !== provider.model) {
    try {
      const models = await providerModelIds(provider)
      if (!models.includes(requestedModel)) return json(res, 400, { error: `${provider.label} 当前账号不可用模型 ${requestedModel}。请刷新模型列表后重试。` })
    } catch {
      return json(res, 503, { error: `${provider.label} 模型目录暂时无法验证，请刷新模型列表后重试。` })
    }
  }
  if (typeof body.userPrompt !== 'string' || !body.userPrompt.trim()) return json(res, 400, { error: '用户提示词不能为空。' })
  const input = { systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '', userPrompt: body.userPrompt.trim(), temperature: Math.min(1, Math.max(0, Number(body.temperature) || 0)), maxTokens: Math.min(8192, Math.max(1, Number(body.maxTokens) || 2048)) }
  return json(res, 200, await invoke({ ...provider, model: requestedModel }, input))
}

async function testSetting(req, res) {
  const body = await readJson(req)
  const normalized = validateSetting(body)
  const providers = await providerSettings()
  const existing = providers.find((item) => item.id === normalized.id)
  const provider = { ...existing, ...normalized, apiKey: String(body.apiKey || '').trim() || existing?.apiKey || '' }
  if (!provider.apiKey) return json(res, 400, { error: '请先填写 API Key。' })
  const result = await invoke(provider, { systemPrompt: '你正在进行 API 连接测试。', userPrompt: '只回复 OK', temperature: 0, maxTokens: 64 })
  return json(res, 200, { ok: true, duration: result.duration, model: result.model, preview: result.text.slice(0, 80) })
}

async function listProviderModels(req, res) {
  const body = await readJson(req)
  const normalized = validateSetting({ ...body, model: body.model || 'model-list-placeholder' })
  const providers = await providerSettings()
  const existing = providers.find((item) => item.id === normalized.id)
  const provider = { ...existing, ...normalized, apiKey: String(body.apiKey || '').trim() || existing?.apiKey || '' }
  if (!provider.apiKey) return json(res, 400, { error: '请先填写 API Key，再获取该账号可用的模型列表。' })
  const models = await fetchProviderModelIds(provider)
  modelCatalogCache.set(provider.id, { fingerprint: `${provider.protocol}\n${provider.baseUrl}\n${provider.apiKey}`, loadedAt: Date.now(), models })
  return json(res, 200, { models })
}

async function serveFrontend(req, res, pathname) {
  if (mode !== 'production') return vite.middlewares(req, res)

  const requestedPath = pathname === '/' ? '/index.html' : pathname
  let filePath = resolve(distDirectory, `.${requestedPath}`)
  if (filePath !== distDirectory && !filePath.startsWith(`${distDirectory}${sep}`)) return json(res, 403, { error: '禁止访问该路径。' })

  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    filePath = resolve(distDirectory, 'index.html')
  }

  const body = await readFile(filePath)
  const isAsset = filePath.startsWith(resolve(distDirectory, 'assets'))
  res.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  res.end(body)
}

const server = createHttpServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, name: 'prompt-studio' })
    if (req.method === 'GET' && url.pathname === '/api/models') return json(res, 200, await publicCatalog(url.searchParams.get('refresh') === '1'))
    if (req.method === 'GET' && url.pathname === '/api/provider-settings') return json(res, 200, { providers: (await providerSettings()).map(publicSetting) })
    if (req.method === 'PUT' && url.pathname === '/api/provider-settings') { const provider = await upsertSetting(await readJson(req)); const catalog = await publicCatalog(true); return json(res, 200, { provider: publicSetting(provider), ...catalog }) }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/provider-settings/')) { await deleteSetting(decodeURIComponent(url.pathname.slice('/api/provider-settings/'.length))); return json(res, 200, { ok: true, ...await publicCatalog() }) }
    if (req.method === 'POST' && url.pathname === '/api/provider-settings/test') return await testSetting(req, res)
    if (req.method === 'POST' && url.pathname === '/api/provider-settings/models') return await listProviderModels(req, res)
    if (req.method === 'POST' && url.pathname === '/api/evaluate') return await evaluate(req, res)
    if (req.method === 'GET' || req.method === 'HEAD') return serveFrontend(req, res, decodeURIComponent(url.pathname))
    json(res, 404, { error: '未找到该接口。' })
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500
    json(res, status, { error: error.message || '模型调用失败。' })
  }
})

const parentPid = Number(process.env.MODEL_WORKBENCH_PARENT_PID || 0)
if (Number.isInteger(parentPid) && parentPid > 1) {
  const parentMonitor = setInterval(() => {
    try { process.kill(parentPid, 0) }
    catch {
      clearInterval(parentMonitor)
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 1_000).unref()
    }
  }, 1_000)
  parentMonitor.unref()
}

server.listen(port, host, async () => {
  const catalog = await publicCatalog()
  console.log(`Prompt Studio: http://localhost:${port}`)
  console.log(`Available models: ${catalog.models.filter((item) => item.available).length}/${catalog.models.length}`)
})
