/**
 * Domestic Customer Intelligence Report (国内外贸公司) — Chinese, different logic.
 * Stored in customer_intelligence_reports.domestic_report (report_kind='domestic').
 */
import { z } from 'zod'

const maybe = z.string().nullable().optional()
// Array fields tolerant of an explicit `null` (LLMs emit "key": null) → []
const strArr = z.array(z.string()).nullish().transform((v) => v ?? [])
const objArr = <T extends z.ZodTypeAny>(s: T) => z.array(s).nullish().transform((v) => v ?? [])

export const DomesticReportSchema = z.object({
  公司基本信息: z.object({
    名称: z.string(),
    地区: maybe,
    成立年份: maybe,
    规模: maybe,
    网站: maybe,
    简介: maybe,
  }),
  主营品类: strArr,
  出口市场: z.object({
    主要市场: strArr,
    说明: maybe,
  }),
  业务模式: z.string(),
  订单合作可能性: z.object({
    评分: z.number().min(0).max(10),
    说明: z.string(),
  }),
  软件系统需求可能性: z.object({
    评分: z.number().min(0).max(10),
    说明: z.string(),
  }),
  招聘扩张信号: strArr,
  管理痛点推断: strArr,
  推荐合作模式: z.string(),   // 订单合作 / 软件销售 / 渠道合作 + 理由
  推荐第一轮沟通话术: z.string(),
  电话微信开场白: z.string(),
  下一步动作: strArr,
  draft_messages: z.object({
    wechat_message: z.string(),
    phone_script: z.string(),
    formal_email: z.object({ subject: z.string(), body: z.string() }),
    software_demo_invitation: z.string(),
    order_cooperation_intro: z.string(),
  }),
  source_urls: objArr(z.object({ url: z.string(), used_for: z.string() })),
  confidence_score: z.number().min(0).max(1),
})

export type DomesticReport = z.infer<typeof DomesticReportSchema>

export interface DomesticReportValidation {
  ok: boolean
  report?: DomesticReport
  errors?: string[]
}

export function validateDomesticReport(raw: unknown): DomesticReportValidation {
  const result = DomesticReportSchema.safeParse(raw)
  if (result.success) return { ok: true, report: result.data }
  return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
}
