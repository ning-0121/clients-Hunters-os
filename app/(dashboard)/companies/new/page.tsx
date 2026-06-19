import Link from 'next/link'
import { createCompanyManually } from '@/actions/companies'

const inputCls = 'w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background'

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams

  return (
    <div className="p-6 max-w-2xl">
      <Link href="/companies" className="text-xs text-muted-foreground hover:underline">← 返回客户公司</Link>
      <h1 className="text-2xl font-bold mt-2">新建客户</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        手动添加一个客户。保存后会<strong>自动分派给你</strong>，并进入 富集 → 评分 → 分级 流程，可直接跟进、建任务、报价。
      </p>

      {error === 'name' && <p className="text-sm text-red-600 mb-3">公司名称必填。</p>}
      {error === 'create' && <p className="text-sm text-red-600 mb-3">创建失败，请重试。</p>}

      <form action={createCompanyManually} className="space-y-4">
        <fieldset className="space-y-3 border rounded-lg p-4">
          <legend className="text-sm font-semibold px-1">客户信息</legend>
          <div>
            <label className="text-xs text-muted-foreground">公司名称 *</label>
            <input name="name" required className={inputCls} placeholder="如 Acme Activewear" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">网站</label>
              <input name="website" className={inputCls} placeholder="https://acme.com" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">国家</label>
              <input name="country" defaultValue="United States" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">品类（逗号分隔）</label>
            <input name="categories" className={inputCls} placeholder="leggings, sports bra, activewear" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">简介</label>
            <textarea name="description" rows={2} className={inputCls} placeholder="客户简介 / 你了解到的背景" />
          </div>
        </fieldset>

        <fieldset className="space-y-3 border rounded-lg p-4">
          <legend className="text-sm font-semibold px-1">联系人（可选）</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">姓名</label>
              <input name="contactName" className={inputCls} placeholder="Jordan Buyer" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">职位</label>
              <input name="contactTitle" className={inputCls} placeholder="Head of Sourcing" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">邮箱</label>
              <input name="contactEmail" type="email" className={inputCls} placeholder="jordan@acme.com" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">电话 / WhatsApp</label>
              <input name="contactPhone" className={inputCls} placeholder="+1 555 123 4567" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            有「有效电话/WhatsApp」或「已验证邮箱」才会进入开发；否则先入池标注「待补联系方式」，系统会定期重找。
          </p>
        </fieldset>

        <button type="submit" className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
          创建客户并开始跟进
        </button>
      </form>
    </div>
  )
}
