import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { runConcurrentQueue } from './concurrentQueue'
import { exportExcelBatch, prepareExcelBatchModelColumns, readExcelBatch, readExcelBatchModelResults, writeExcelBatchModelOutput, type ExcelBatchDocument, type ExcelBatchModelColumn, type ExcelBatchResultStatus, type ExcelBatchRow } from './excelBatch'

type IconName = 'arrow' | 'bot' | 'check' | 'chevron' | 'close' | 'copy' | 'download' | 'flask' | 'message' | 'plus' | 'refresh' | 'search' | 'send' | 'settings' | 'sliders' | 'spark' | 'trash' | 'upload' | 'user' | 'wand'
type WorkspaceModule = 'prompt' | 'evaluation' | 'testing'
type EvaluationStatus = 'idle' | 'running' | 'done' | 'error'

type Evaluation = { id: number; model: string; prompt: string; temperature: number; maxTokens: number; status: EvaluationStatus; result: string; startedAt?: number; duration?: number; inputTokens?: number; outputTokens?: number }
type ModelOption = { id: string; label: string; model: string; provider: string; providerId: string; available: boolean }
type ApiResult = { text: string; duration?: number; inputTokens?: number; outputTokens?: number }
type Framework = { id: string; code: string; chinese: string; description: string; useCase: string; sections: Array<[string, string]> }
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; modelLabel?: string; duration?: number }
type ProviderProtocol = 'openai-responses' | 'openai-chat' | 'anthropic-messages' | 'google-generate-content'
type ProviderSetting = { id: string; label: string; protocol: ProviderProtocol; baseUrl: string; model: string; suggestedModels: string[]; enabled: boolean; builtIn: boolean; hasApiKey: boolean; apiKeyMasked: string; keySource: 'local' | 'environment' | 'none' }

const FRAMEWORKS: Framework[] = [
  { id: 'star', code: 'S.T.A.R', chinese: '情景 · 任务 · 行动 · 结果', description: 'Situation / Task / Action / Result，强调复盘与成果导向。', useCase: '适合复盘、案例表达、项目总结和结果导向型任务。', sections: [['情景（Situation）', '描述任务背景、已有条件和相关上下文'], ['任务（Task）', '明确模型需要完成的核心任务'], ['行动（Action）', '定义模型应执行的步骤、方法和约束'], ['结果（Result）', '定义预期结果、输出格式和质量标准']] },
  { id: 'ape', code: 'A.P.E', chinese: '行动 · 目的 · 期望', description: 'Action / Purpose / Expectation，快速明确任务意图。', useCase: '适合快速指令、短任务和目标清晰的日常工作。', sections: [['行动（Action）', '说明模型具体需要执行什么行动'], ['目的（Purpose）', '解释执行该行动的业务目的'], ['期望（Expectation）', '定义预期输出、风格和完成标准']] },
  { id: 'broke', code: 'B.R.O.K.E', chinese: '背景 · 角色 · 目标 · 关键结果 · 改进', description: '适合多角色、多目标的复杂任务，并强调关键结果与持续改进。', useCase: '适合复杂项目、策略分析和需要迭代优化的任务。', sections: [['背景（Background）', '交代业务背景、现状和已知条件'], ['角色（Role）', '定义模型承担的角色、专业能力和边界'], ['目标（Objective）', '说明需要达成的核心目标'], ['关键结果（Key Result）', '定义可验证的关键结果和验收条件'], ['改进（Evolve）', '说明如何检查、反思并改进输出']] },
  { id: 'coast', code: 'C.O.A.S.T', chinese: '背景 · 目标 · 行动 · 场景 · 任务', description: 'Context / Objective / Action / Scenario / Task。', useCase: '适合需要明确应用场景、行动路径与最终任务的工作。', sections: [['背景（Context）', '提供任务所需背景、资料和限制条件'], ['目标（Objective）', '说明最终希望实现的目标'], ['行动（Action）', '规定模型需要采取的行动方式'], ['场景（Scenario）', '描述输出将被使用的具体场景'], ['任务（Task）', '给出当前需要完成的具体任务']] },
  { id: 'tag', code: 'T.A.G', chinese: '任务 · 行动 · 目标', description: 'Task / Action / Goal，结构最精简。', useCase: '适合简单、明确、强调行动结果的快速任务。', sections: [['任务（Task）', '说明当前需要处理的任务'], ['行动（Action）', '规定完成任务所需的行动'], ['目标（Goal）', '定义最终目标和成功标准']] },
  { id: 'rise', code: 'R.I.S.E', chinese: '角色 · 输入 · 步骤 · 期望', description: 'Role / Input / Steps / Expectation。', useCase: '适合有明确输入数据和操作步骤的流程型任务。', sections: [['角色（Role）', '定义模型角色、能力和职责边界'], ['输入（Input）', '说明输入数据、变量和数据格式'], ['步骤（Steps）', '列出模型必须依次执行的步骤'], ['期望（Expectation）', '定义输出形式和验收标准']] },
  { id: 'trace', code: 'T.R.A.C.E', chinese: '任务 · 请求 · 操作 · 上下文 · 示例', description: 'Task / Request / Action / Context / Example。', useCase: '适合需要示例约束、上下文充分和执行方式明确的任务。', sections: [['任务（Task）', '描述需要解决的核心任务'], ['请求（Request）', '明确用户提出的具体请求'], ['操作（Action）', '规定模型应采用的处理方法'], ['上下文（Context）', '补充背景、限制和相关信息'], ['示例（Example）', '提供期望输出示例或反例']] },
  { id: 'era', code: 'E.R.A', chinese: '期望 · 角色 · 行动', description: 'Expectation / Role / Action。', useCase: '适合先确定结果，再指定角色与执行方式的任务。', sections: [['期望（Expectation）', '先定义输出结果和完成标准'], ['角色（Role）', '指定模型需要扮演的角色'], ['行动（Action）', '说明模型需要执行的行动']] },
  { id: 'care', code: 'C.A.R.E', chinese: '上下文 · 行动 · 结果 · 示例', description: 'Context / Action / Result / Example。', useCase: '适合强调背景、输出结果并通过示例校准质量的任务。', sections: [['上下文（Context）', '提供任务背景和必要信息'], ['行动（Action）', '规定模型需要采取的行动'], ['结果（Result）', '定义需要交付的结果'], ['示例（Example）', '提供正例、反例或格式样例']] },
  { id: 'roses', code: 'R.O.S.E.S', chinese: '角色 · 目标 · 场景 · 解决方案 · 步骤', description: 'Role / Objective / Scenario / Solution / Steps。', useCase: '适合需要从场景推导方案并给出落地步骤的复杂任务。', sections: [['角色（Role）', '定义模型的专业角色与责任'], ['目标（Objective）', '说明需要实现的目标'], ['场景（Scenario）', '描述问题发生和方案使用的场景'], ['解决方案（Solution）', '规定需要形成的解决方案'], ['步骤（Steps）', '给出执行解决方案的具体步骤']] },
  { id: 'icio', code: 'I.C.I.O', chinese: '指令 · 背景 · 输入数据 · 输出引导', description: 'Instruction / Context / Input / Output。', useCase: '适合数据处理、内容转换和输出格式严格的任务。', sections: [['指令（Instruction）', '给出模型必须执行的核心指令'], ['背景（Context）', '提供完成指令所需的背景'], ['输入数据（Input）', '定义输入内容、变量与数据格式'], ['输出引导（Output）', '定义输出结构、格式与质量要求']] },
  { id: 'crispe', code: 'C.R.I.S.P.E', chinese: '能力 · 角色 · 见解 · 声明 · 个性 · 实验', description: 'Capacity / Role / Insight / Statement / Personality / Experiment。', useCase: '适合创意表达、人格化助手和需要通过示例迭代的任务。', sections: [['能力（Capacity）', '定义模型需要具备的专业能力'], ['角色（Role）', '指定模型的身份、职责和边界'], ['见解（Insight）', '提供判断问题所需的核心见解'], ['声明（Statement）', '明确需要表达或完成的核心任务'], ['个性（Personality）', '规定语言个性、语气和风格'], ['实验（Experiment）', '提供示例、变体或迭代验证方式']] },
  { id: 'race', code: 'R.A.C.E', chinese: '角色 · 行动 · 背景 · 期望', description: 'Role / Action / Context / Expectation。', useCase: '适合以角色为起点、强调行动与结果标准的通用任务。', sections: [['角色（Role）', '定义模型的角色、专业能力和职责'], ['行动（Action）', '说明模型需要执行的行动'], ['背景（Context）', '提供行动所需的背景和限制'], ['期望（Expectation）', '定义输出格式、风格和成功标准']] },
]

const frameworkTemplate = (framework: Framework) => `# ${framework.code} 系统提示词\n\n${framework.sections.map(([title, guidance]) => `## ${title}\n\n{{${guidance}}}`).join('\n\n')}\n\n## 通用约束\n\n- 严格遵循上述目标、步骤与输出要求。\n- 信息不足时先指出缺失信息，不得擅自编造事实。\n- 输出前检查内容是否完整、准确、可执行。`
const DEFAULT_SYSTEM_PROMPT = frameworkTemplate(FRAMEWORKS[0])
const DEFAULT_PROMPTS = ['分析 AI 原生产品在新用户引导中最常见的三个问题，并给出改进建议。', '用产品经理能快速理解的方式，总结 AI 原生产品新用户引导的关键设计原则。']
const OPTIMIZE_MODES = [['clear', '更清晰', '消除歧义'], ['strict', '更严格', '强化边界'], ['concise', '更精简', '减少 Token'], ['stable', '更稳定', '一致输出'], ['structured', '结构化', '整理层级'], ['custom', '自定义', '按需优化']] as const

async function requestModelEvaluation(input: { modelId: string; systemPrompt: string; userPrompt: string; temperature: number; maxTokens: number }): Promise<ApiResult> {
  const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `模型调用失败（HTTP ${response.status}）`)
  return data
}

function formatResponseTime(duration?: number) {
  if (duration == null || !Number.isFinite(duration)) return '—'
  if (duration < 1) return `${Math.max(1, Math.round(duration * 1000))} ms`
  return `${duration.toFixed(duration < 10 ? 2 : 1)} s`
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>, bot: <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/></>, check: <path d="m5 12 4 4L19 6"/>, chevron: <path d="m8 10 4 4 4-4"/>, close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>, copy: <><rect width="12" height="12" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></>, flask: <><path d="M9 3h6"/><path d="M10 9V3h4v6l5 9a2 2 0 0 1-1.7 3H6.7A2 2 0 0 1 5 18l5-9Z"/></>, message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>, plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></>, send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.01V3h4v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>, sliders: <><path d="M4 7h10M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2M10 17h10"/><circle cx="8" cy="17" r="2"/></>, spark: <><path d="m12 3-1.2 3.6a2 2 0 0 1-1.2 1.2L6 9l3.6 1.2a2 2 0 0 1 1.2 1.2L12 15l1.2-3.6a2 2 0 0 1 1.2-1.2L18 9l-3.6-1.2a2 2 0 0 1-1.2-1.2L12 3Z"/><path d="M5 16v4M3 18h4"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6M10 11v5M14 11v5"/></>, upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 20h14"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>, wand: <><path d="m15 4 5 5L8 21H3v-5Z"/><path d="m6 14 5 5M18 2v3M22 6h-3"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function createEvaluation(id: number, model = ''): Evaluation { return { id, model, prompt: DEFAULT_PROMPTS[(id - 1) % DEFAULT_PROMPTS.length] ?? '', temperature: 0.7, maxTokens: 2048, status: 'idle', result: '' } }

function App() {
  const [activeModule, setActiveModule] = useState<WorkspaceModule>('prompt')
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem('prompt-studio-content') || DEFAULT_SYSTEM_PROMPT)
  const [documentTitle, setDocumentTitle] = useState('未命名系统提示词')
  const [activeFrameworkId, setActiveFrameworkId] = useState('star')
  const [frameworkSearch, setFrameworkSearch] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const [evaluations, setEvaluations] = useState<Evaluation[]>([createEvaluation(1), createEvaluation(2)])
  const [nextId, setNextId] = useState(3)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [testModel, setTestModel] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const [chatStartedAt, setChatStartedAt] = useState<number | null>(null)
  const [optimizeModel, setOptimizeModel] = useState('')
  const [optimizeMode, setOptimizeMode] = useState<(typeof OPTIMIZE_MODES)[number][0]>('clear')
  const [customInstruction, setCustomInstruction] = useState('')
  const [optimizationResult, setOptimizationResult] = useState('')
  const [optimizationError, setOptimizationError] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [optimizeScope, setOptimizeScope] = useState<'document' | 'selection'>('document')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [providerSettings, setProviderSettings] = useState<ProviderSetting[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('openai')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [providerModelLists, setProviderModelLists] = useState<Record<string, string[]>>({})
  const [providerModelsLoaded, setProviderModelsLoaded] = useState<Record<string, boolean>>({})
  const [customModelMode, setCustomModelMode] = useState(false)
  const [modelListBusy, setModelListBusy] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState<'loading' | 'saving' | 'testing' | ''>('')
  const [settingsNotice, setSettingsNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [providerTestStartedAt, setProviderTestStartedAt] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchModels, setBatchModels] = useState<string[]>([])
  const [batchDocument, setBatchDocument] = useState<ExcelBatchDocument | null>(null)
  const [batchRows, setBatchRows] = useState<ExcelBatchRow[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 })
  const [batchNotice, setBatchNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [skipExistingOutput, setSkipExistingOutput] = useState(true)
  const [batchDragging, setBatchDragging] = useState(false)
  const [batchConcurrency, setBatchConcurrency] = useState(4)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const batchFileInputRef = useRef<HTMLInputElement>(null)
  const batchStopRef = useRef(false)

  const activeFramework = FRAMEWORKS.find((item) => item.id === activeFrameworkId) ?? FRAMEWORKS[0]
  const availableModels = useMemo(() => models.filter((model) => model.available), [models])
  const configuredCount = availableModels.length
  const selectedTestModel = models.find((model) => model.id === testModel)
  const selectedOptimizeModel = models.find((model) => model.id === optimizeModel)
  const selectedBatchModels = batchModels.flatMap((id) => {
    const model = models.find((item) => item.id === id)
    return model ? [model] : []
  })
  const isRunning = evaluations.some((item) => item.status === 'running')
  const completedCount = evaluations.filter((item) => item.status === 'done').length
  const runnableCount = evaluations.filter((item) => models.find((model) => model.id === item.model)?.available).length
  const tokenEstimate = Math.ceil(systemPrompt.length / 2.4)
  const columnStyle = useMemo(() => ({ '--column-count': evaluations.length } as React.CSSProperties), [evaluations.length])
  const filteredFrameworks = FRAMEWORKS.filter((item) => `${item.code}${item.chinese}${item.description}`.toLowerCase().includes(frameworkSearch.toLowerCase()))
  const selectedProvider = providerSettings.find((provider) => provider.id === selectedProviderId)
  const selectedProviderModels = selectedProvider ? [...new Set([selectedProvider.model, ...(providerModelLists[selectedProvider.id] || selectedProvider.suggestedModels || [])].filter(Boolean))] : []

  const applyModels = (nextModels: ModelOption[]) => {
    setModels(nextModels)
    const nextAvailableModels = nextModels.filter((model) => model.available)
    const firstAvailableId = nextAvailableModels[0]?.id ?? ''
    setTestModel((current) => nextAvailableModels.some((model) => model.id === current) ? current : firstAvailableId)
    setOptimizeModel((current) => nextAvailableModels.some((model) => model.id === current) ? current : firstAvailableId)
    setBatchModels((current) => {
      const valid = current.filter((id) => nextAvailableModels.some((model) => model.id === id))
      return valid.length ? valid : nextAvailableModels.slice(0, Math.min(2, nextAvailableModels.length)).map((model) => model.id)
    })
    setEvaluations((items) => items.map((item, index) => nextAvailableModels.some((model) => model.id === item.model) ? item : { ...item, model: nextAvailableModels[index % Math.max(1, nextAvailableModels.length)]?.id ?? '', status: 'idle', result: '', startedAt: undefined, duration: undefined, inputTokens: undefined, outputTokens: undefined }))
  }

  const refreshModels = async () => {
    const response = await fetch('/api/models')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法读取模型配置。')
    applyModels(data.models as ModelOption[])
    setCatalogError(Array.isArray(data.warnings) ? data.warnings.join('；') : '')
  }

  const loadProviderSettings = async (preferredId?: string) => {
    setSettingsBusy('loading'); setSettingsNotice(null)
    try {
      const response = await fetch('/api/provider-settings')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法读取 API 配置。')
      const nextProviders = data.providers as ProviderSetting[]
      setProviderSettings(nextProviders)
      setProviderModelLists((current) => Object.fromEntries(nextProviders.map((provider) => [provider.id, [...new Set([provider.model, ...(current[provider.id] || []), ...(provider.suggestedModels || [])].filter(Boolean))]])))
      const nextId = preferredId && nextProviders.some((item) => item.id === preferredId) ? preferredId : nextProviders.some((item) => item.id === selectedProviderId) ? selectedProviderId : nextProviders[0]?.id ?? ''
      setSelectedProviderId(nextId); setApiKeyDraft(''); setClearApiKey(false); setCustomModelMode(false)
    } catch (error) { setSettingsNotice({ kind: 'error', text: error instanceof Error ? error.message : '无法读取 API 配置。' }) }
    finally { setSettingsBusy('') }
  }

  useEffect(() => {
    const refresh = () => void refreshModels().catch((error: Error) => setCatalogError(error.message))
    refresh()
    const timer = window.setInterval(refresh, 5 * 60 * 1000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => { setSaveState('saving'); const timer = window.setTimeout(() => { localStorage.setItem('prompt-studio-content', systemPrompt); setSaveState('saved') }, 450); return () => window.clearTimeout(timer) }, [systemPrompt])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages, chatLoading])
  useEffect(() => {
    const timingActive = evaluations.some((item) => item.status === 'running') || chatStartedAt != null || providerTestStartedAt != null
    if (!timingActive) return
    setClock(Date.now())
    const timer = window.setInterval(() => setClock(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [evaluations, chatStartedAt, providerTestStartedAt])
  useEffect(() => {
    if (!settingsOpen) return
    const handleEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [settingsOpen])
  useEffect(() => {
    if (!batchOpen || batchRunning) return
    const handleEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setBatchOpen(false) }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [batchOpen, batchRunning])
  useEffect(() => {
    if (!batchDocument || batchRunning) return
    const modelColumns = batchModels.flatMap((id) => {
      const model = models.find((item) => item.id === id)
      return model ? [{ id: model.id, header: `${model.provider} · ${model.label} 输出` }] : []
    })
    setBatchRows(readExcelBatchModelResults(batchDocument, modelColumns))
    setBatchProgress({ completed: 0, total: batchDocument.rows.length * modelColumns.length })
  }, [batchModels])

  const updateEvaluation = (id: number, patch: Partial<Evaluation>) => setEvaluations((items) => items.map((item) => {
    if (item.id !== id) return item
    const modelChanged = patch.model !== undefined && patch.model !== item.model
    return { ...item, ...(modelChanged ? { status: 'idle' as const, result: '', startedAt: undefined, duration: undefined, inputTokens: undefined, outputTokens: undefined } : {}), ...patch }
  }))
  const addEvaluation = () => { if (evaluations.length < 3) { const model = availableModels[(nextId - 1) % Math.max(1, availableModels.length)]?.id ?? ''; setEvaluations((items) => [...items, createEvaluation(nextId, model)]); setNextId((value) => value + 1) } }
  const removeEvaluation = (id: number) => { if (evaluations.length > 1) setEvaluations((items) => items.filter((item) => item.id !== id)) }
  const runEvaluation = async (id: number) => {
    const evaluation = evaluations.find((item) => item.id === id)
    if (!evaluation || evaluation.status === 'running') return
    const selectedModel = models.find((model) => model.id === evaluation.model)
    if (!evaluation.prompt.trim()) return updateEvaluation(id, { status: 'error', result: '请先填写该栏的用户提示词，再开始运行。' })
    if (!selectedModel?.available) return updateEvaluation(id, { status: 'error', result: `${selectedModel?.provider || '该供应商'} 尚未配置 API Key。请填写 .env.local 并重启服务。` })
    const startedAt = Date.now()
    updateEvaluation(id, { status: 'running', result: '', startedAt, duration: undefined, inputTokens: undefined, outputTokens: undefined })
    try { const data = await requestModelEvaluation({ modelId: evaluation.model, systemPrompt, userPrompt: evaluation.prompt, temperature: evaluation.temperature, maxTokens: evaluation.maxTokens }); updateEvaluation(id, { status: 'done', result: data.text, startedAt: undefined, duration: data.duration, inputTokens: data.inputTokens, outputTokens: data.outputTokens }) }
    catch (error) { updateEvaluation(id, { status: 'error', result: error instanceof Error ? error.message : '模型调用失败。', startedAt: undefined, duration: (Date.now() - startedAt) / 1000 }) }
  }
  const runAll = () => evaluations.forEach((item) => { if (models.find((model) => model.id === item.model)?.available) void runEvaluation(item.id) })
  const loadBatchFile = async (file?: File) => {
    if (!file) return
    if (!/\.(xlsx|xls|xlsm|xlsb)$/i.test(file.name)) return setBatchNotice({ kind: 'error', text: '请选择 .xlsx、.xls、.xlsm 或 .xlsb 格式的 Excel 文件。' })
    setBatchNotice({ kind: 'info', text: '正在读取 Excel…' })
    try {
      const document = await readExcelBatch(file)
      setBatchDocument(document)
      const modelColumns = selectedBatchModels.map((model) => ({ id: model.id, header: `${model.provider} · ${model.label} 输出` }))
      setBatchRows(readExcelBatchModelResults(document, modelColumns))
      setBatchProgress({ completed: 0, total: document.rows.length * modelColumns.length })
      setBatchNotice(document.inputWasGuessed
        ? { kind: 'info', text: `没有找到标准“输入”列名，已将“${document.inputHeader}”作为输入列，请确认后运行。` }
        : { kind: 'success', text: `已识别 ${document.rows.length} 条输入；每个所选模型会生成一个独立输出列。` })
    } catch (error) {
      setBatchDocument(null); setBatchRows([]); setBatchProgress({ completed: 0, total: 0 })
      setBatchNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Excel 读取失败。' })
    }
  }
  const importBatchFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    void loadBatchFile(file)
  }
  const dropBatchFile = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setBatchDragging(false)
    void loadBatchFile(event.dataTransfer.files?.[0])
  }
  const batchModelColumns = (): ExcelBatchModelColumn[] => selectedBatchModels.map((model) => ({ id: model.id, header: `${model.provider} · ${model.label} 输出` }))
  const updateBatchModel = (index: number, modelId: string) => setBatchModels((current) => current.map((id, itemIndex) => itemIndex === index ? modelId : id))
  const addBatchModel = () => {
    const nextModel = availableModels.find((model) => !batchModels.includes(model.id))
    if (nextModel) setBatchModels((current) => [...current, nextModel.id])
  }
  const removeBatchModel = (index: number) => setBatchModels((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const batchRowStatus = (row: ExcelBatchRow): ExcelBatchResultStatus => {
    const statuses = selectedBatchModels.map((model) => row.results[model.id]?.status ?? 'pending')
    if (statuses.includes('running')) return 'running'
    if (statuses.includes('error') && statuses.every((status) => ['done', 'error', 'skipped'].includes(status))) return 'error'
    if (statuses.length && statuses.every((status) => status === 'skipped')) return 'skipped'
    if (statuses.length && statuses.every((status) => ['done', 'skipped'].includes(status))) return 'done'
    return 'pending'
  }
  const runBatchEvaluation = async () => {
    if (!batchDocument || !selectedBatchModels.length || batchRunning) return
    const rowsToRun = prepareExcelBatchModelColumns(batchDocument, batchModelColumns()).map((row) => ({
      ...row,
      results: Object.fromEntries(selectedBatchModels.map((model) => [model.id, { ...row.results[model.id], status: 'pending' as const }])),
    }))
    const tasks = selectedBatchModels.flatMap((model) => rowsToRun.map((row) => ({ model, row })))
    const executableCount = tasks.filter(({ model, row }) => !(skipExistingOutput && row.results[model.id]?.output.trim())).length
    if (!executableCount) return setBatchNotice({ kind: 'info', text: '所选模型的每一行都已有输出。如需重新生成，请关闭“跳过已有输出”。' })

    batchStopRef.current = false
    setBatchRunning(true); setBatchRows(rowsToRun); setBatchProgress({ completed: 0, total: tasks.length })
    const workerCount = Math.min(batchConcurrency, executableCount)
    setBatchNotice({ kind: 'info', text: `正在运行 ${selectedBatchModels.length} 个模型、${tasks.length} 次调用，以 ${workerCount} 路并发进行评测…` })
    let completed = 0
    let failed = 0
    let skipped = 0

    await runConcurrentQueue(tasks, batchConcurrency, () => batchStopRef.current, async ({ model, row }) => {
      const currentResult = row.results[model.id]
      if (skipExistingOutput && currentResult?.output.trim()) {
        skipped += 1; completed += 1
        setBatchRows((items) => items.map((item) => item.id === row.id ? { ...item, results: { ...item.results, [model.id]: { ...item.results[model.id], status: 'skipped' } } } : item))
        setBatchProgress({ completed, total: tasks.length })
        return
      }

      setBatchRows((items) => items.map((item) => item.id === row.id ? { ...item, results: { ...item.results, [model.id]: { ...item.results[model.id], status: 'running' } } } : item))
      const startedAt = Date.now()
      try {
        const data = await requestModelEvaluation({ modelId: model.id, systemPrompt, userPrompt: row.input, temperature: 0.7, maxTokens: 4096 })
        writeExcelBatchModelOutput(batchDocument, model.id, row.sheetRow, data.text)
        setBatchRows((items) => items.map((item) => item.id === row.id ? { ...item, results: { ...item.results, [model.id]: { output: data.text, status: 'done', duration: data.duration } } } : item))
      } catch (error) {
        failed += 1
        const errorText = error instanceof Error ? error.message : '模型调用失败。'
        const output = `错误：${errorText}`
        writeExcelBatchModelOutput(batchDocument, model.id, row.sheetRow, output)
        setBatchRows((items) => items.map((item) => item.id === row.id ? { ...item, results: { ...item.results, [model.id]: { output, status: 'error', duration: (Date.now() - startedAt) / 1000 } } } : item))
      }
      completed += 1
      setBatchProgress({ completed, total: tasks.length })
    })

    setBatchRunning(false)
    if (batchStopRef.current) setBatchNotice({ kind: 'info', text: `已停止，当前完成 ${completed} / ${tasks.length} 次调用，可直接导出当前结果。` })
    else if (failed) setBatchNotice({ kind: 'error', text: `批量评测完成：成功 ${completed - failed - skipped} 次，失败 ${failed} 次，跳过 ${skipped} 次。失败原因已写入对应模型列。` })
    else setBatchNotice({ kind: 'success', text: `批量评测完成：生成 ${completed - skipped} 个结果，跳过已有输出 ${skipped} 个。现在可以下载结果 Excel。` })
  }
  const stopBatchEvaluation = () => { batchStopRef.current = true; setBatchNotice({ kind: 'info', text: '已停止派发新任务，正在等待当前并行请求完成。' }) }
  const downloadBatchResult = () => { if (batchDocument) { prepareExcelBatchModelColumns(batchDocument, batchModelColumns()); exportExcelBatch(batchDocument) } }
  const applyFramework = (framework: Framework) => { setActiveFrameworkId(framework.id); setSystemPrompt(frameworkTemplate(framework)); setOptimizationResult('') }
  const exportPrompt = () => { const url = URL.createObjectURL(new Blob([systemPrompt], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${documentTitle || 'system-prompt'}.md`; link.click(); URL.revokeObjectURL(url) }

  const optimizePrompt = async () => {
    if (!selectedOptimizeModel?.available) return setOptimizationError('所选模型尚未配置 API Key。')
    const source = optimizeScope === 'selection' ? selectedText : systemPrompt
    if (!source.trim()) return
    const modeLabel = OPTIMIZE_MODES.find((mode) => mode[0] === optimizeMode)?.[1] ?? '更清晰'
    setOptimizing(true); setOptimizationError(''); setOptimizationResult('')
    try { const data = await requestModelEvaluation({ modelId: optimizeModel, systemPrompt: '你是专业的系统提示词优化器。只输出优化后的完整提示词正文，不要解释，不要使用代码围栏。必须保留原意、关键约束、定义和输出要求。', userPrompt: `优化目标：${modeLabel}${optimizeMode === 'custom' && customInstruction ? `；补充要求：${customInstruction}` : ''}\n\n待优化内容：\n${source}`, temperature: 0.2, maxTokens: 4096 }); setOptimizationResult(data.text) }
    catch (error) { setOptimizationError(error instanceof Error ? error.message : '优化失败，请重试。') }
    finally { setOptimizing(false) }
  }
  const applyOptimization = () => { if (!optimizationResult) return; setSystemPrompt((value) => optimizeScope === 'selection' && selectedText ? value.replace(selectedText, optimizationResult) : optimizationResult); setOptimizationResult(''); setSelectedText(''); setOptimizeScope('document') }

  const sendChat = async (preset?: string) => {
    const content = (preset ?? chatInput).trim()
    if (!content || chatLoading || !selectedTestModel?.available) return
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content }
    const context = [...chatMessages, userMessage].map((message) => `${message.role === 'user' ? '用户' : '模型'}：${message.content}`).join('\n\n')
    const startedAt = Date.now()
    setChatMessages((items) => [...items, userMessage]); setChatInput(''); setChatLoading(true); setChatStartedAt(startedAt); setChatError('')
    try { const data = await requestModelEvaluation({ modelId: testModel, systemPrompt, userPrompt: context, temperature: 0.7, maxTokens: 4096 }); setChatMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: data.text, modelLabel: `${selectedTestModel.provider} · ${selectedTestModel.label}`, duration: data.duration }]) }
    catch (error) { setChatError(`${error instanceof Error ? error.message : '模型测试失败，请重试。'} · 响应时间 ${formatResponseTime((Date.now() - startedAt) / 1000)}`) }
    finally { setChatLoading(false); setChatStartedAt(null) }
  }
  const handleChatKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat() } }

  const openSettings = () => { setSettingsOpen(true); void loadProviderSettings() }
  const selectProvider = (id: string) => { setSelectedProviderId(id); setApiKeyDraft(''); setClearApiKey(false); setCustomModelMode(false); setSettingsNotice(null) }
  const updateProviderSetting = (patch: Partial<ProviderSetting>) => setProviderSettings((items) => items.map((item) => item.id === selectedProviderId ? { ...item, ...patch } : item))
  const providerPayload = () => selectedProvider ? { ...selectedProvider, apiKey: apiKeyDraft, clearApiKey } : null

  const saveProvider = async () => {
    const payload = providerPayload()
    if (!payload) return
    setSettingsBusy('saving'); setSettingsNotice(null)
    try {
      const response = await fetch('/api/provider-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存失败。')
      applyModels(data.models as ModelOption[])
      setCatalogError(Array.isArray(data.warnings) ? data.warnings.join('；') : '')
      await loadProviderSettings(payload.id)
      setSettingsNotice({ kind: 'success', text: `${payload.label} 配置已保存，模型列表已刷新。` })
    } catch (error) { setSettingsNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存失败。' }) }
    finally { setSettingsBusy('') }
  }

  const testProvider = async () => {
    const payload = providerPayload()
    if (!payload) return
    const startedAt = Date.now()
    setSettingsBusy('testing'); setProviderTestStartedAt(startedAt); setSettingsNotice(null)
    try {
      const response = await fetch('/api/provider-settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '连接测试失败。')
      setSettingsNotice({ kind: 'success', text: `连接成功 · ${data.model} · 响应时间 ${formatResponseTime(Number(data.duration))} · 返回“${data.preview}”` })
    } catch (error) { setSettingsNotice({ kind: 'error', text: `${error instanceof Error ? error.message : '连接测试失败。'} · 响应时间 ${formatResponseTime((Date.now() - startedAt) / 1000)}` }) }
    finally { setSettingsBusy(''); setProviderTestStartedAt(null) }
  }

  const loadProviderModels = async () => {
    const payload = providerPayload()
    if (!payload) return
    setModelListBusy(true); setSettingsNotice(null)
    try {
      const response = await fetch('/api/provider-settings/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '获取模型列表失败。')
      const nextModels = data.models as string[]
      setProviderModelLists((current) => ({ ...current, [payload.id]: [...new Set([payload.model, ...nextModels].filter(Boolean))] }))
      setProviderModelsLoaded((current) => ({ ...current, [payload.id]: true }))
      if (!payload.model && nextModels[0]) updateProviderSetting({ model: nextModels[0] })
      setCustomModelMode(false)
      setSettingsNotice({ kind: 'success', text: `已从 ${payload.label} 获取 ${nextModels.length} 个可用模型，请选择后保存。` })
    } catch (error) { setSettingsNotice({ kind: 'error', text: error instanceof Error ? error.message : '获取模型列表失败。' }) }
    finally { setModelListBusy(false) }
  }

  const addCustomProvider = () => {
    const id = `custom-${Date.now().toString(36)}`
    const setting: ProviderSetting = { id, label: '自定义厂商', protocol: 'openai-chat', baseUrl: 'https://', model: '', suggestedModels: [], enabled: true, builtIn: false, hasApiKey: false, apiKeyMasked: '', keySource: 'none' }
    setProviderSettings((items) => [...items, setting]); selectProvider(id); setCustomModelMode(true)
  }

  const removeCustomProvider = async () => {
    if (!selectedProvider || selectedProvider.builtIn || !window.confirm(`删除“${selectedProvider.label}”的本地 API 配置？`)) return
    setSettingsBusy('saving'); setSettingsNotice(null)
    try {
      const response = await fetch(`/api/provider-settings/${encodeURIComponent(selectedProvider.id)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除失败。')
      applyModels(data.models as ModelOption[])
      await loadProviderSettings()
      setSettingsNotice({ kind: 'success', text: '自定义厂商已删除。' })
    } catch (error) { setSettingsNotice({ kind: 'error', text: error instanceof Error ? error.message : '删除失败。' }) }
    finally { setSettingsBusy('') }
  }

  return <div className="app-shell">
    <header className="topbar studio-topbar">
      <div className="studio-brand"><span className="brand-mark"><Icon name="spark" size={18}/></span><div><strong>Prompt Studio</strong><small>AI 工作台</small></div></div>
      <nav className="module-nav" aria-label="工作站模块"><button className={activeModule === 'prompt' ? 'active' : ''} onClick={() => setActiveModule('prompt')}><Icon name="spark" size={14}/>系统提示词搭建</button><button className={activeModule === 'testing' ? 'active' : ''} onClick={() => setActiveModule('testing')}><Icon name="message" size={14}/>模型测试</button><button className={activeModule === 'evaluation' ? 'active' : ''} onClick={() => setActiveModule('evaluation')}><Icon name="flask" size={14}/>模型评测</button></nav>
      <div className="topbar-actions"><span className="save-status"><span className={`save-dot ${configuredCount ? '' : 'offline'}`}/>{configuredCount} / {models.length} 服务可用</span>{activeModule === 'evaluation' && <><button className="secondary-button" onClick={addEvaluation} disabled={evaluations.length >= 3}><Icon name="plus"/>添加模型</button><button className="primary-button" onClick={runAll} disabled={isRunning || runnableCount === 0}><Icon name="spark"/>{isRunning ? '正在评测' : '运行全部'}</button></>}<button className="api-settings-button" onClick={openSettings}><Icon name="settings" size={15}/>API 设置</button><button className="studio-avatar" aria-label="用户菜单">P</button></div>
    </header>

    {activeModule === 'prompt' && <main className="prompt-studio-workspace">
      <aside className="framework-panel"><div className="studio-panel-heading"><div><p>FRAMEWORKS</p><h2>框架库</h2></div><span>{FRAMEWORKS.length}</span></div><label className="framework-search"><Icon name="search" size={14}/><input value={frameworkSearch} onChange={(event) => setFrameworkSearch(event.target.value)} placeholder="搜索提示词框架"/></label><button className="recommend-card" onClick={() => applyFramework(FRAMEWORKS[2])}><span><Icon name="spark" size={15}/></span><span><strong>AI 智能推荐</strong><small>根据复杂任务推荐 B.R.O.K.E</small></span><Icon name="arrow" size={14}/></button><div className="framework-list">{filteredFrameworks.map((framework) => <button key={framework.id} className={`framework-item ${activeFrameworkId === framework.id ? 'is-active' : ''}`} onClick={() => applyFramework(framework)}><strong>{framework.code}</strong><span>{framework.chinese}</span>{activeFrameworkId === framework.id && <Icon name="check" size={14}/>}</button>)}</div><div className="framework-detail"><div><span>框架说明</span><strong>{activeFramework.code}</strong></div><p>{activeFramework.description}</p><small>{activeFramework.useCase}</small></div></aside>
      <section className="studio-editor-panel"><header className="studio-editor-toolbar"><div><input value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} aria-label="提示词标题"/><p><span>{activeFramework.code}</span><b className={saveState}>{saveState === 'saving' ? '正在保存' : '已保存到本地'}</b></p></div><div className="studio-toolbar-actions"><button onClick={() => void navigator.clipboard.writeText(systemPrompt)}><Icon name="copy" size={14}/>复制</button><button onClick={exportPrompt}><Icon name="download" size={14}/>导出</button></div></header><textarea className="studio-prompt-editor" value={systemPrompt} onChange={(event) => { setSystemPrompt(event.target.value); setOptimizationResult('') }} onSelect={(event) => { const target = event.currentTarget; const text = target.value.slice(target.selectionStart, target.selectionEnd); setSelectedText(text); if (text) setOptimizeScope('selection') }} spellCheck={false} aria-label="系统提示词编辑器"/><footer className="studio-editor-footer"><span>Markdown</span><span>{systemPrompt.length.toLocaleString()} 字符</span><span>约 {tokenEstimate.toLocaleString()} Tokens</span>{selectedText && <strong>已选中 {selectedText.length} 字符</strong>}</footer></section>
      <aside className="optimizer-panel"><div className="studio-panel-heading optimizer-heading"><div><p>OPTIMIZER</p><h2>提示词优化</h2></div><i/></div><div className="optimizer-scroll"><section><label>优化模型</label><select value={optimizeModel} disabled={!availableModels.length} onChange={(event) => setOptimizeModel(event.target.value)}>{!availableModels.length && <option value="">暂无可用模型</option>}{availableModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><small>{selectedOptimizeModel ? `${selectedOptimizeModel.provider} · API 已连接` : '请先在 API 设置中配置模型'}</small></section><section><label>优化范围</label><div className="scope-switch"><button className={optimizeScope === 'document' ? 'is-active' : ''} onClick={() => setOptimizeScope('document')}>整体提示词</button><button className={optimizeScope === 'selection' ? 'is-active' : ''} disabled={!selectedText} onClick={() => setOptimizeScope('selection')}>选中内容{selectedText && <span>{selectedText.length}</span>}</button></div>{selectedText ? <div className="selection-preview"><span>当前选区</span><p>{selectedText}</p></div> : <small>在中间编辑器选择文字即可启用局部优化。</small>}</section><section><label>优化目标</label><div className="mode-grid">{OPTIMIZE_MODES.map(([id, label, description]) => <button key={id} className={optimizeMode === id ? 'is-active' : ''} onClick={() => setOptimizeMode(id)}><strong>{label}</strong><small>{description}</small>{optimizeMode === id && <Icon name="check" size={12}/>}</button>)}</div>{optimizeMode === 'custom' && <textarea value={customInstruction} onChange={(event) => setCustomInstruction(event.target.value)} placeholder="例如：改为适合客服机器人的专业语气"/>}</section>{optimizationError && <div className="optimizer-error">{optimizationError}</div>}{optimizationResult && <section className="optimization-result"><header><Icon name="spark" size={15}/><div><strong>优化完成</strong><small>已生成可应用的新版本</small></div></header><pre>{optimizationResult}</pre><div><button onClick={() => setOptimizationResult('')}>放弃</button><button className="primary" onClick={applyOptimization}>应用修改</button></div></section>}</div><div className="optimizer-footer"><button onClick={() => void optimizePrompt()} disabled={optimizing || !selectedOptimizeModel?.available}><Icon name="wand" size={16}/>{optimizing ? '正在优化…' : optimizationResult ? '重新优化' : '开始优化'}</button></div></aside>
    </main>}

    {activeModule === 'testing' && <main className="playground-workspace">
      <section className="playground-prompt"><header><div><p>SYSTEM PROMPT</p><h2>系统提示词</h2></div><div><span>{activeFramework.code}</span><b>{saveState === 'saving' ? '正在同步' : '与搭建区同步'}</b></div></header><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} spellCheck={false} aria-label="测试用系统提示词"/><footer><span>每次发送均使用当前内容</span><span>{systemPrompt.length.toLocaleString()} 字符</span><span>约 {tokenEstimate.toLocaleString()} Tokens</span></footer></section>
      <section className="playground-chat">
        <header><div><p>MODEL PLAYGROUND</p><h2>测试对话</h2></div><button onClick={() => { setChatMessages([]); setChatError('') }} disabled={!chatMessages.length}><Icon name="trash" size={14}/>清空对话</button></header>
        <div className="playground-modelbar"><label>测试模型</label><select value={testModel} disabled={!availableModels.length} onChange={(event) => setTestModel(event.target.value)}>{!availableModels.length && <option value="">暂无可用模型</option>}{availableModels.map((model) => <option key={model.id} value={model.id}>{model.provider} · {model.label}</option>)}</select><p>{selectedTestModel ? 'API 已连接，发送消息将调用真实模型。' : '请先在 API 设置中配置模型。'}</p></div>
        <div className="playground-messages">
          {!chatMessages.length ? <div className="playground-empty"><span><Icon name="message" size={22}/></span><h3>用当前系统提示词开始测试</h3><p>左侧提示词会随每次消息一起发送。切换模型不会清空对话，方便比较不同模型的表现。</p><div>{['请介绍你的角色和工作边界', '遇到信息不足时，你会如何处理？', '请按照规定格式给出一个示例结果'].map((example) => <button key={example} onClick={() => void sendChat(example)}><Icon name="spark" size={13}/>{example}</button>)}</div></div> : chatMessages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}><span><Icon name={message.role === 'assistant' ? 'bot' : 'user'} size={15}/></span><div><p><strong>{message.role === 'assistant' ? '模型回复' : '你'}</strong>{message.modelLabel && <small>{message.modelLabel}</small>}{message.duration != null && <small className="response-time">响应时间 {formatResponseTime(message.duration)}</small>}</p><div>{message.content}</div></div></article>)}
          {chatLoading && <article className="chat-message assistant"><span><Icon name="bot" size={15}/></span><div><p><strong>模型正在思考</strong>{chatStartedAt != null && <small className="response-time live">已等待 {formatResponseTime((clock - chatStartedAt) / 1000)}</small>}</p><div className="thinking-dots"><i/><i/><i/></div></div></article>}
          <div ref={chatEndRef}/>
        </div>
        <div className="playground-composer-wrap">{chatError && <div className="playground-error">{chatError}</div>}<div className="playground-composer"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={handleChatKeyDown} placeholder="输入测试消息，Enter 发送，Shift + Enter 换行"/><footer><span>{chatInput.length} 字符</span><button onClick={() => void sendChat()} disabled={!chatInput.trim() || chatLoading || !selectedTestModel?.available}><Icon name="send" size={14}/>{chatLoading && chatStartedAt != null ? `生成中 · ${formatResponseTime((clock - chatStartedAt) / 1000)}` : '发送'}</button></footer></div></div>
      </section>
    </main>}

    {activeModule === 'evaluation' && <main className="workbench">
      <aside className="system-panel"><div className="panel-kicker"><span>共享条件</span><span className="shared-badge">应用于 {evaluations.length} 个模型</span></div><div className="section-heading"><h2>系统提示词</h2><p>定义所有评测栏共同遵循的角色、边界和输出要求。</p></div><label className="prompt-field system-prompt-field"><span className="sr-only">系统提示词</span><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="输入所有模型共同使用的系统提示词…" spellCheck={false}/><span className="character-count">{systemPrompt.length} 字符</span></label><div className="system-note"><span className="note-icon"><Icon name="spark" size={14}/></span><div><strong>保持控制变量一致</strong><p>系统提示词的修改会同步到全部评测栏，便于直接比较模型差异。</p></div></div><div className={`provider-note ${configuredCount ? 'ready' : ''}`}><div className="provider-note-heading"><strong>真实 API 模式</strong><span>{configuredCount}/{models.length} 已连接</span></div><p>{catalogError || (configuredCount ? '运行时将直接调用已配置供应商，Token 数据来自真实响应。' : '在 .env.local 中填写至少一个供应商 API Key，然后重启服务。')}</p><div className="provider-dots">{models.map((model) => <span className={model.available ? 'available' : ''} key={model.id}/>)}</div></div><div className="run-summary"><div><span>本轮进度</span><strong>{completedCount}<small> / {evaluations.length}</small></strong></div><div className="progress-track"><span style={{ width: `${(completedCount / evaluations.length) * 100}%` }}/></div></div></aside>
      <section className="comparison-area">
        <div className="comparison-header"><div><span className="eyebrow">并排评测</span><h2>比较模型响应</h2></div><div className="comparison-header-actions"><button className="batch-launch-button" onClick={() => setBatchOpen(true)}><Icon name="upload" size={14}/>Excel 批量评测</button><span className="column-limit">{evaluations.length} / 3 栏</span></div></div>
        <div className="evaluation-grid" style={columnStyle}>
          {evaluations.map((evaluation, index) => <article className={`evaluation-column status-${evaluation.status}`} key={evaluation.id}>
            <div className="signal-track"/>
            <div className="model-header"><div className="column-number">{String(index + 1).padStart(2, '0')}</div><div className="select-wrap"><label>{models.find((model) => model.id === evaluation.model)?.provider || '评测模型'}</label><select value={evaluation.model} disabled={!availableModels.length} onChange={(event) => updateEvaluation(evaluation.id, { model: event.target.value })}>{!availableModels.length && <option value="">暂无可用模型</option>}{availableModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><span className="select-chevron"><Icon name="chevron" size={14}/></span></div><button className="icon-button destructive" disabled={evaluations.length <= 1} onClick={() => removeEvaluation(evaluation.id)}><Icon name="trash" size={15}/></button></div>
            <div className="column-body">
              <div className="field-label-row"><label>用户提示词</label><span>独立输入</span></div>
              <textarea className="user-prompt" value={evaluation.prompt} onChange={(event) => updateEvaluation(evaluation.id, { prompt: event.target.value })} placeholder="输入要发送给该模型的用户提示词…"/>
              <details className="parameters"><summary><span><Icon name="sliders" size={15}/>模型参数</span><span className="parameter-summary">T {evaluation.temperature.toFixed(1)} · {evaluation.maxTokens}</span></summary><div className="parameter-content"><label><span>温度 <output>{evaluation.temperature.toFixed(1)}</output></span><input type="range" min="0" max="1" step="0.1" value={evaluation.temperature} onChange={(event) => updateEvaluation(evaluation.id, { temperature: Number(event.target.value) })}/></label><label><span>最大输出 Token</span><select value={evaluation.maxTokens} onChange={(event) => updateEvaluation(evaluation.id, { maxTokens: Number(event.target.value) })}><option value={1024}>1,024</option><option value={2048}>2,048</option><option value={4096}>4,096</option><option value={8192}>8,192</option></select></label></div></details>
              <button className="run-column-button" onClick={() => void runEvaluation(evaluation.id)} disabled={evaluation.status === 'running' || !models.find((model) => model.id === evaluation.model)?.available}>{evaluation.status === 'running' ? <span className="spinner"/> : <Icon name="arrow"/>}{evaluation.status === 'running' && evaluation.startedAt != null ? `生成响应中 · ${formatResponseTime((clock - evaluation.startedAt) / 1000)}` : models.find((model) => model.id === evaluation.model)?.available ? '运行此模型' : '需要 API Key'}</button>
              <div className="result-section">
                <div className="result-heading"><div><span className={`status-indicator ${evaluation.status}`}/><h3>模型响应</h3>{evaluation.status === 'running' && evaluation.startedAt != null && <small className="response-time live">已等待 {formatResponseTime((clock - evaluation.startedAt) / 1000)}</small>}</div>{evaluation.status === 'done' && <button className="copy-button" onClick={async () => { await navigator.clipboard.writeText(evaluation.result); setCopiedId(evaluation.id); setTimeout(() => setCopiedId(null), 1200) }}><Icon name={copiedId === evaluation.id ? 'check' : 'copy'} size={14}/>{copiedId === evaluation.id ? '已复制' : '复制'}</button>}</div>
                <div className={`result-content ${evaluation.status}`}>{evaluation.status === 'idle' && <div className="empty-state"><span><Icon name="spark" size={18}/></span><strong>等待运行</strong><p>填写该栏的用户提示词，然后运行模型查看响应。</p></div>}{evaluation.status === 'running' && <div className="loading-state"><span className="loading-line wide"/><span className="loading-line"/><span className="loading-line medium"/><span className="loading-line short"/></div>}{evaluation.status === 'error' && <div className="error-state"><strong>无法完成评测</strong><p>{evaluation.result}</p></div>}{evaluation.status === 'done' && <pre className="plain-result">{evaluation.result}</pre>}</div>
                {(evaluation.status === 'done' || evaluation.status === 'error') && <div className="metrics-row"><span><b>{formatResponseTime(evaluation.duration)}</b>响应时间</span><span><b>{evaluation.inputTokens ?? '—'}</b>输入 Token</span><span><b>{evaluation.outputTokens ?? '—'}</b>输出 Token</span></div>}
              </div>
            </div>
          </article>)}
          {evaluations.length < 3 && <button className="add-column-card" onClick={addEvaluation}><span><Icon name="plus" size={18}/></span><strong>添加评测模型</strong><small>最多同时比较 3 个模型</small></button>}
        </div>
      </section>
    </main>}

    {batchOpen && <dialog className="batch-evaluation-dialog" open aria-modal="true" aria-labelledby="batch-evaluation-title">
      <div className="batch-evaluation-card">
        <header className="batch-evaluation-header"><div><span className="batch-evaluation-icon"><Icon name="upload" size={18}/></span><div><h2 id="batch-evaluation-title">Excel 批量评测</h2><p>导入一列输入，同时运行多个模型，并将各模型结果写入同一张表</p></div></div><button onClick={() => setBatchOpen(false)} disabled={batchRunning} aria-label="关闭 Excel 批量评测"><Icon name="close" size={17}/></button></header>
        <div className="batch-evaluation-body">
          <input ref={batchFileInputRef} className="batch-file-input" type="file" accept=".xlsx,.xls,.xlsm,.xlsb" onChange={(event) => void importBatchFile(event)}/>
          {!batchDocument ? <div className="batch-empty-state"><button className={`batch-upload-zone ${batchDragging ? 'is-dragging' : ''}`} onClick={() => batchFileInputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setBatchDragging(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setBatchDragging(true) }} onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBatchDragging(false) }} onDrop={dropBatchFile}><span><Icon name="upload" size={24}/></span><strong>{batchDragging ? '松开即可导入' : '点击选择或拖入 Excel 文件'}</strong><p>支持 .xlsx、.xls、.xlsm、.xlsb</p><small>优先识别“输入 / Prompt / 问题”列；运行后按模型分别创建输出列</small></button>{batchNotice && <div className={`batch-notice ${batchNotice.kind}`} role="status">{batchNotice.kind === 'success' ? <Icon name="check" size={14}/> : batchNotice.kind === 'info' ? <Icon name="spark" size={14}/> : <span>!</span>}<p>{batchNotice.text}</p></div>}</div> : <>
            <section className="batch-file-summary"><div><span><Icon name="check" size={14}/></span><div><strong>{batchDocument.sourceName}</strong><small>{batchDocument.sheetName} · 共 {batchRows.length} 条有效输入</small></div></div><button onClick={() => batchFileInputRef.current?.click()} disabled={batchRunning}>更换文件</button></section>
            <section className="batch-setup-grid">
              <div className="batch-model-setup"><span>输出列模型</span><div className="batch-model-list">{selectedBatchModels.map((selectedModel, index) => <div className="batch-model-row" key={`${selectedModel.id}-${index}`}><b>模型 {index + 1}</b><select aria-label={`模型 ${index + 1}`} value={selectedModel.id} disabled={batchRunning} onChange={(event) => updateBatchModel(index, event.target.value)}>{availableModels.filter((model) => model.id === selectedModel.id || !batchModels.includes(model.id)).map((model) => <option key={model.id} value={model.id}>{model.provider} · {model.label}</option>)}</select><button aria-label={`移除模型 ${index + 1}`} disabled={batchRunning || selectedBatchModels.length <= 1} onClick={() => removeBatchModel(index)}><Icon name="close" size={12}/></button></div>)}</div>{availableModels.length ? <button className="batch-add-model" disabled={batchRunning || batchModels.length >= availableModels.length} onClick={addBatchModel}><Icon name="plus" size={12}/>添加模型</button> : <small>请先在 API 设置中配置模型</small>}<small>列表顺序就是下载表中的模型输出列顺序</small></div>
              <div className="batch-column-map"><span>列结构</span><div><b>{batchDocument.inputHeader}</b><Icon name="arrow" size={14}/><b>{selectedBatchModels.length} 个模型输出列</b></div><small>每个模型独占一列，结果写入同一行</small></div>
              <label><span>并发数量</span><select value={batchConcurrency} disabled={batchRunning} onChange={(event) => setBatchConcurrency(Number(event.target.value))}><option value={1}>1 路 · 稳定</option><option value={2}>2 路</option><option value={4}>4 路 · 推荐</option><option value={8}>8 路 · 最快</option></select><small>数量越高，越可能触发厂商限流</small></label>
              <label className="batch-skip-option"><input type="checkbox" checked={skipExistingOutput} disabled={batchRunning} onChange={(event) => setSkipExistingOutput(event.target.checked)}/><span><strong>跳过已有输出</strong><small>保留已完成结果，避免重复调用</small></span></label>
            </section>
            {batchNotice && <div className={`batch-notice ${batchNotice.kind}`} role="status">{batchNotice.kind === 'success' ? <Icon name="check" size={14}/> : batchNotice.kind === 'info' ? <Icon name="spark" size={14}/> : <span>!</span>}<p>{batchNotice.text}</p></div>}
            <section className="batch-table-section">
              <header><div><strong>数据预览</strong><span>系统提示词使用当前评测页内容</span></div><span>{batchProgress.completed} / {batchProgress.total}</span></header>
              <div className="batch-progress-track"><span style={{ width: `${batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}%` }}/></div>
              <div className="batch-table-scroll"><table className="batch-multi-model-table" style={{ minWidth: `${420 + selectedBatchModels.length * 220}px` }}><thead><tr><th className="batch-row-number-column">行</th><th className="batch-input-column">输入</th>{selectedBatchModels.map((model, index) => <th className="batch-output-column" key={model.id}><span>模型 {index + 1}</span>{model.label}</th>)}<th className="batch-state-column">状态</th></tr></thead><tbody>{batchRows.map((row) => { const status = batchRowStatus(row); const finished = selectedBatchModels.filter((model) => ['done', 'error', 'skipped'].includes(row.results[model.id]?.status ?? 'pending')).length; return <tr key={row.id} className={`batch-row-${status}`}><td>{row.sheetRow}</td><td title={row.input}>{row.input}</td>{selectedBatchModels.map((model) => { const result = row.results[model.id]; return <td key={model.id} title={result?.output || ''}>{result?.output || '—'}</td> })}<td><span className={`batch-status ${status}`}>{status === 'pending' ? '待处理' : status === 'running' ? '生成中' : status === 'done' ? '已完成' : status === 'error' ? '有失败' : '已跳过'}</span><small>{finished} / {selectedBatchModels.length}</small></td></tr> })}</tbody></table></div>
            </section>
          </>}
        </div>
        <footer className="batch-evaluation-footer"><button className="batch-cancel-button" onClick={() => setBatchOpen(false)} disabled={batchRunning}>关闭</button><div>{batchDocument && <button className="batch-download-button" onClick={downloadBatchResult}><Icon name="download" size={14}/>下载结果 Excel</button>}{batchDocument && (batchRunning ? <button className="batch-stop-button" onClick={stopBatchEvaluation}>停止任务</button> : <button className="batch-run-button" onClick={() => void runBatchEvaluation()} disabled={!selectedBatchModels.length}><Icon name="spark" size={14}/>开始多模型评测</button>)}</div></footer>
      </div>
    </dialog>}

    {settingsOpen && <dialog className="api-settings-dialog" open aria-modal="true" aria-labelledby="api-settings-title">
      <div className="api-settings-card">
        <header className="api-settings-header"><div><span className="api-settings-icon"><Icon name="settings" size={18}/></span><div><h2 id="api-settings-title">模型 API 设置</h2><p>统一管理各厂商接口，保存后供三个模块共用</p></div></div><button className="api-settings-close" onClick={() => setSettingsOpen(false)} aria-label="关闭 API 设置"><Icon name="close" size={17}/></button></header>
        <div className="api-settings-body">
          <aside className="provider-settings-list"><div className="provider-list-heading"><span>模型厂商</span><button onClick={addCustomProvider}><Icon name="plus" size={13}/>添加</button></div><div className="provider-list-scroll">{providerSettings.map((provider) => <button className={provider.id === selectedProviderId ? 'is-active' : ''} key={provider.id} onClick={() => selectProvider(provider.id)}><span className={`provider-connection-dot ${provider.hasApiKey && provider.enabled ? 'connected' : ''}`}/><span><strong>{provider.label}</strong><small>{provider.model || '待填写模型 ID'}</small></span>{provider.builtIn && <em>内置</em>}</button>)}</div><div className="provider-security-note"><Icon name="check" size={13}/><span>API Key 仅写入本机服务端文件，浏览器不会读取明文。</span></div></aside>

          <section className="provider-settings-form">
            {settingsBusy === 'loading' || !selectedProvider ? <div className="settings-loading"><span className="spinner"/><p>正在读取本地配置…</p></div> : <>
              <div className="provider-form-title"><div><span className={`provider-connection-dot ${selectedProvider.hasApiKey && selectedProvider.enabled ? 'connected' : ''}`}/><div><h3>{selectedProvider.label}</h3><p>{selectedProvider.hasApiKey ? `已保存密钥 · ${selectedProvider.apiKeyMasked}` : '尚未配置 API Key'}</p></div></div><label className="enabled-switch"><input type="checkbox" checked={selectedProvider.enabled} onChange={(event) => updateProviderSetting({ enabled: event.target.checked })}/><span>启用</span></label></div>
              {settingsBusy === 'testing' && providerTestStartedAt != null && <div className="settings-notice timing" role="status"><span className="spinner"/><p>正在等待模型响应 · <b>{formatResponseTime((clock - providerTestStartedAt) / 1000)}</b></p></div>}
              {settingsNotice && <div className={`settings-notice ${settingsNotice.kind}`} role="status">{settingsNotice.kind === 'success' ? <Icon name="check" size={14}/> : <span>!</span>}<p>{settingsNotice.text}</p></div>}
              <div className="provider-field-grid">
                <label><span>厂商名称</span><input value={selectedProvider.label} onChange={(event) => updateProviderSetting({ label: event.target.value })} placeholder="例如：OpenAI"/></label>
                <label><span>厂商 ID</span><input value={selectedProvider.id} disabled/><small>保存后用于模型唯一标识</small></label>
                <label className="wide"><span>接口协议</span><select value={selectedProvider.protocol} onChange={(event) => updateProviderSetting({ protocol: event.target.value as ProviderProtocol })}><option value="openai-responses">OpenAI Responses API</option><option value="openai-chat">OpenAI 兼容 Chat Completions</option><option value="anthropic-messages">Anthropic Messages API</option><option value="google-generate-content">Google GenerateContent API</option></select><small>多数第三方中转、硅基流动、OpenRouter 等兼容服务可选择 Chat Completions。</small></label>
                <label className="wide"><span>Base URL</span><input value={selectedProvider.baseUrl} onChange={(event) => updateProviderSetting({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" spellCheck={false}/><small>只填写接口根地址，系统会自动拼接对应请求路径。</small></label>
                <label className="wide model-choice-field"><span>模型</span><div className="model-selector-row"><select value={customModelMode ? '__custom__' : selectedProvider.model} onChange={(event) => { if (event.target.value === '__custom__') setCustomModelMode(true); else { setCustomModelMode(false); updateProviderSetting({ model: event.target.value }) } }} aria-label="选择模型"><option value="" disabled>请选择模型</option>{selectedProviderModels.map((model) => <option key={model} value={model}>{model}</option>)}<option value="__custom__">自定义模型 ID…</option></select><button type="button" className="fetch-models-button" onClick={() => void loadProviderModels()} disabled={modelListBusy || settingsBusy !== ''}>{modelListBusy ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}获取模型列表</button></div>{customModelMode && <input className="custom-model-input" value={selectedProvider.model} onChange={(event) => updateProviderSetting({ model: event.target.value })} placeholder="输入厂商提供的模型 ID" spellCheck={false} autoFocus/>}<small>{providerModelsLoaded[selectedProvider.id] ? `已从厂商加载 ${selectedProviderModels.length} 个模型；选择后保存即可供三个模块共用。` : '当前显示推荐模型；填写 API Key 后可读取该账号真实可用列表，也可自定义模型 ID。'}</small></label>
                <label className="wide"><span>API Key</span><input type="password" value={apiKeyDraft} onChange={(event) => { setApiKeyDraft(event.target.value); setClearApiKey(false) }} placeholder={selectedProvider.hasApiKey ? `已保存：${selectedProvider.apiKeyMasked}（留空不修改）` : '输入 API Key'} autoComplete="off" spellCheck={false}/><small>{selectedProvider.keySource === 'environment' ? '当前来自环境变量；在此填写可创建本地覆盖配置。' : clearApiKey ? '保存后将清除本地密钥。' : '留空会保留已保存密钥，不会将掩码当作真实 Key。'}</small></label>
              </div>
              <div className="provider-form-footer"><div>{selectedProvider.hasApiKey && selectedProvider.keySource !== 'environment' && <button className="clear-key-button" onClick={() => { setApiKeyDraft(''); setClearApiKey(true); setSettingsNotice(null) }}>清除密钥</button>}{!selectedProvider.builtIn && <button className="delete-provider-button" onClick={() => void removeCustomProvider()}><Icon name="trash" size={13}/>删除厂商</button>}</div><div><button className="test-connection-button" onClick={() => void testProvider()} disabled={settingsBusy !== ''}>{settingsBusy === 'testing' ? <span className="spinner"/> : <Icon name="flask" size={14}/>}测试连接{settingsBusy === 'testing' && providerTestStartedAt != null ? ` · ${formatResponseTime((clock - providerTestStartedAt) / 1000)}` : ''}</button><button className="save-provider-button" onClick={() => void saveProvider()} disabled={settingsBusy !== ''}>{settingsBusy === 'saving' ? <span className="spinner"/> : <Icon name="check" size={14}/>}保存配置</button></div></div>
            </>}
          </section>
        </div>
      </div>
    </dialog>}
  </div>
}

export default App
