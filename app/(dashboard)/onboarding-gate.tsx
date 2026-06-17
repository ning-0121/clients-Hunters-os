import { getAppConfig, SALES_FOCUS_LABELS, OUTREACH_TONE_LABELS, type SalesFocus } from '@/lib/config'
import { saveSellerProfile } from '@/actions/settings'

/**
 * First-login onboarding. Rendered in place of the dashboard content until the
 * seller/company profile is captured, so the system knows WHAT we sell and HOW
 * to write outreach (instead of guessing / pitching the wrong thing).
 */
export async function OnboardingGate() {
  const cfg = await getAppConfig()
  const p = cfg.sellerProfile
  const input = 'w-full px-3 py-2 border rounded-md bg-background text-sm'
  const label = 'text-xs font-medium text-muted-foreground block mb-1'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">欢迎使用 ARAOS 👋 先花 1 分钟设置</h1>
        <p className="text-sm text-muted-foreground mt-1">
          这些信息决定系统给你<strong>找什么客户、怎么写开发信</strong>。填一次即可，之后可在「设置」里改。
        </p>
      </div>

      <form action={saveSellerProfile} className="space-y-5">
        {/* 主推方向 */}
        <div>
          <label className={label}>① 我们当前主推什么？</label>
          <div className="space-y-1.5">
            {(['activewear', 'activewear_first', 'software'] as SalesFocus[]).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="radio" name="salesFocus" value={f} defaultChecked={cfg.salesFocus === f} className="h-4 w-4" />
                {SALES_FOCUS_LABELS[f]}
              </label>
            ))}
          </div>
        </div>

        {/* 公司简介 */}
        <div>
          <label className={label}>② 公司一句话简介（开发信开头自我介绍用）</label>
          <textarea name="companyIntro" rows={2} defaultValue={p.companyIntro} className={input} />
        </div>

        {/* 核心卖点 */}
        <div>
          <label className={label}>③ 核心卖点 / 差异化（每行一个，开发信只会引用这里列出的）</label>
          <textarea name="sellingPoints" rows={4} defaultValue={p.sellingPoints.join('\n')}
            placeholder={'低起订量（50件/款起）\n自有设计打版\n30-45 天返单'} className={`${input} font-mono text-xs`} />
        </div>

        {/* 目标客户偏好 */}
        <div>
          <label className={label}>④ 目标客户偏好（想重点开发的地区 / 品类 / 客户类型，自由填）</label>
          <textarea name="targetPreferences" rows={2} defaultValue={p.targetPreferences}
            placeholder="例：欧美 + 拉美的瑜伽/运动品牌、Shopify DTC、年销$1M+；避开纯低价批发" className={input} />
        </div>

        {/* 开发信偏好 */}
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm font-medium">⑤ 开发信偏好</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>语气</label>
              <select name="outreachTone" defaultValue={p.outreachTone} className={input}>
                {(['professional', 'warm', 'concise'] as const).map((t) => (
                  <option key={t} value={t}>{OUTREACH_TONE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>默认语言</label>
              <select name="defaultLang" defaultValue={p.defaultLang} className={input}>
                <option value="auto">按客户国家自动</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="pt">Português</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </div>
          <div className="flex gap-5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mentionMoq" defaultChecked={p.mentionMoq} className="h-4 w-4" />提起订量（MOQ）</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mentionPrice" defaultChecked={p.mentionPrice} className="h-4 w-4" />提价格区间</label>
          </div>
          <div>
            <label className={label}>行动邀约（CTA）偏好</label>
            <input name="ctaPreference" defaultValue={p.ctaPreference} className={input} />
          </div>
          <div>
            <label className={label}>署名</label>
            <input name="signature" defaultValue={p.signature} className={input} />
          </div>
        </div>

        <button type="submit" className="w-full text-sm px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium">
          保存并开始使用
        </button>
      </form>
    </div>
  )
}
