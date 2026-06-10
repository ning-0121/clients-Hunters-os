'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
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
          <p className="text-xs text-muted-foreground mt-1">QIMO 客户开发系统 · BD 工作台</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 border rounded-lg p-5 bg-card">
          <div>
            <label className="text-xs text-muted-foreground">邮箱</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" placeholder="you@company.com" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">密码</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" placeholder="••••••••" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full text-sm px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
            {loading ? '登录中…' : '登录'}
          </button>
          <p className="text-[11px] text-muted-foreground text-center pt-1">登录后进入 /bd/today 工作台</p>
        </form>
      </div>
    </div>
  )
}
