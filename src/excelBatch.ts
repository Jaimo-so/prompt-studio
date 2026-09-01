import { read, utils, writeFileXLSX, type WorkBook, type WorkSheet } from 'xlsx'

export type ExcelBatchResultStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export type ExcelBatchModelResult = {
  output: string
  status: ExcelBatchResultStatus
  duration?: number
}

export type ExcelBatchModelColumn = {
  id: string
  header: string
}

export type ExcelBatchRow = {
  id: string
  sheetRow: number
  input: string
  results: Record<string, ExcelBatchModelResult>
}

export type ExcelBatchDocument = {
  workbook: WorkBook
  worksheet: WorkSheet
  sheetName: string
  sourceName: string
  inputHeader: string
  inputColumn: number
  headerRow: number
  inputWasGuessed: boolean
  rows: ExcelBatchRow[]
  modelOutputColumns: Record<string, number>
}

const INPUT_ALIASES = ['输入', '用户输入', '输入内容', '问题', '提问', '用户提示词', '提示词', 'prompt', 'input', 'question', 'query']
const cellText = (value: unknown) => value == null ? '' : String(value).trim()
const normalizedHeader = (value: unknown) => cellText(value).toLowerCase().replace(/[\s_\-—:：/\\]+/g, '')
const matchesAlias = (value: unknown, aliases: string[]) => aliases.some((alias) => normalizedHeader(value) === normalizedHeader(alias))

const readCell = (worksheet: WorkSheet, row: number, column: number) => cellText(worksheet[utils.encode_cell({ r: row, c: column })]?.v)

const findModelOutputColumn = (document: ExcelBatchDocument, model: ExcelBatchModelColumn) => {
  const cached = document.modelOutputColumns[model.id]
  if (cached != null) return cached
  const range = document.worksheet['!ref'] ? utils.decode_range(document.worksheet['!ref']) : { s: { c: 0, r: 0 }, e: { c: document.inputColumn, r: document.headerRow } }
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    if (normalizedHeader(readCell(document.worksheet, document.headerRow, column)) === normalizedHeader(model.header)) {
      document.modelOutputColumns[model.id] = column
      return column
    }
  }
  return -1
}

export async function readExcelBatch(file: File): Promise<ExcelBatchDocument> {
  const workbook = read(await file.arrayBuffer(), { cellDates: true, cellStyles: true })
  const sheetName = workbook.SheetNames[0]
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheetName || !worksheet) throw new Error('Excel 中没有可读取的工作表。')

  const matrix = utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: false })
  if (!matrix.length) throw new Error('Excel 工作表为空，请先填写表头和输入内容。')

  const scanRows = matrix.slice(0, 20)
  const aliasHeaderIndex = scanRows.findIndex((row) => row.some((cell) => matchesAlias(cell, INPUT_ALIASES)))
  const firstContentIndex = scanRows.findIndex((row) => row.some((cell) => cellText(cell)))
  const headerRow = aliasHeaderIndex >= 0 ? aliasHeaderIndex : firstContentIndex
  if (headerRow < 0) throw new Error('没有找到可识别的表头。')

  const headers = matrix[headerRow].map(cellText)
  let inputColumn = headers.findIndex((header) => matchesAlias(header, INPUT_ALIASES))
  const inputWasGuessed = inputColumn < 0
  if (inputColumn < 0) inputColumn = headers.findIndex(Boolean)
  if (inputColumn < 0) throw new Error('没有找到可作为输入的列。')

  const rows: ExcelBatchRow[] = matrix.slice(headerRow + 1).flatMap((row, offset) => {
    const input = cellText(row[inputColumn])
    if (!input) return []
    const sheetRowIndex = headerRow + 1 + offset
    return [{
      id: `excel-${sheetRowIndex}`,
      sheetRow: sheetRowIndex + 1,
      input,
      results: {},
    }]
  })
  if (!rows.length) throw new Error(`“${headers[inputColumn] || '输入'}”列中没有可评测的内容。`)

  return {
    workbook,
    worksheet,
    sheetName,
    sourceName: file.name,
    inputHeader: headers[inputColumn] || `第 ${inputColumn + 1} 列`,
    inputColumn,
    headerRow,
    inputWasGuessed,
    rows,
    modelOutputColumns: {},
  }
}

export function readExcelBatchModelResults(document: ExcelBatchDocument, models: ExcelBatchModelColumn[]) {
  return document.rows.map((row) => ({
    ...row,
    results: Object.fromEntries(models.map((model) => {
      const column = findModelOutputColumn(document, model)
      return [model.id, {
        output: column >= 0 ? readCell(document.worksheet, row.sheetRow - 1, column) : '',
        status: 'pending' as const,
      }]
    })),
  }))
}

export function prepareExcelBatchModelColumns(document: ExcelBatchDocument, models: ExcelBatchModelColumn[]) {
  const range = document.worksheet['!ref'] ? utils.decode_range(document.worksheet['!ref']) : { s: { c: 0, r: 0 }, e: { c: document.inputColumn, r: document.headerRow } }
  let nextColumn = range.e.c + 1
  models.forEach((model) => {
    if (findModelOutputColumn(document, model) >= 0) return
    utils.sheet_add_aoa(document.worksheet, [[model.header]], { origin: { r: document.headerRow, c: nextColumn } })
    document.modelOutputColumns[model.id] = nextColumn
    nextColumn += 1
  })
  return readExcelBatchModelResults(document, models)
}

export function writeExcelBatchModelOutput(document: ExcelBatchDocument, modelId: string, sheetRow: number, output: string) {
  const outputColumn = document.modelOutputColumns[modelId]
  if (outputColumn == null) throw new Error('没有找到该模型对应的输出列。')
  utils.sheet_add_aoa(document.worksheet, [[output]], { origin: { r: sheetRow - 1, c: outputColumn } })
}

export function exportExcelBatch(document: ExcelBatchDocument) {
  const baseName = document.sourceName.replace(/\.(xlsx|xls|xlsb|xlsm)$/i, '') || '模型评测'
  writeFileXLSX(document.workbook, `${baseName}-评测结果.xlsx`, { compression: true })
}
