'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createAccount } from '@/actions/auth'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await createAccount({ email, password, code, name })
      if (res.error) { setError(res.error); setLoading(false); return }
      const supabase = createClient()
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (signErr) { setError('注册成功，但自动登录失败，请去登录页手动登录'); setLoading(false); return }
      router.push('/bd/today')
      router.refresh()
    } catch (err) {
      setError(String(err)); setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight">ARAOS</h1>
          <p className="text-xs text-muted-foreground mt-1">注册团队账号</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 border rounded-lg p-5 bg-card">
          <div>
            <label className="text-xs text-muted-foreground">姓名</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">邮箱</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">密码（至少 8 位）</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">邀请码</label>
            <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="向管理员索取"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full text-sm px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
            {loading ? '注册中…' : '注册并进入'}
          </button>
          <p className="text-[11px] text-muted-foreground text-center pt-1">
            已有账号？<Link href="/login" className="text-primary hover:underline">去登录</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
