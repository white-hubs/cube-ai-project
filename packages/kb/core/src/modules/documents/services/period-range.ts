import { BadRequestException } from '@dangao/bun-server'

export interface PeriodRange {
  /** 格式：yyyy-MM-dd HH:mm:ss */
  startTime: string
  /** 格式：yyyy-MM-dd HH:mm:ss */
  endTime: string
}

export interface ParsedPeriodRange {
  start: Date
  end: Date
}

function parseDateTimeString(value: string, fieldName: string): Date {
  const v = value.trim()
  if (!v) {
    throw new BadRequestException(`${fieldName} is required`)
  }
  // JS Date 对 `YYYY-MM-DD HH:mm:ss` 兼容性不一，这里转成 ISO 形式
  const isoLike = v.replace(' ', 'T')
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} is invalid, expected 'YYYY-MM-DD HH:mm:ss'`)
  }
  return date
}

/**
 * 将 period.startTime / period.endTime（yyyy-MM-dd HH:mm:ss）解析成 Date 区间。
 */
export function parsePeriodRange(period?: Partial<PeriodRange>): ParsedPeriodRange | undefined {
  if (!period) {
    return undefined
  }

  const start = typeof period.startTime === 'string' ? parseDateTimeString(period.startTime, 'period.startTime') : null
  const end = typeof period.endTime === 'string' ? parseDateTimeString(period.endTime, 'period.endTime') : null

  if (!start || !end) {
    throw new BadRequestException('period.startTime and period.endTime are required')
  }
  if (start.getTime() > end.getTime()) {
    throw new BadRequestException('period.startTime must be <= period.endTime')
  }

  return { start, end }
}

