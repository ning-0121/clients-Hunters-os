'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [ready, setReady] = useState(false)   // recovery session detected
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    // The recovery link establishes a session (detectSessionInUrl) and fires PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true) })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('密码至少 8 位'); return }
    setLoading(true); setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError(error.message); setLoading(false); return }
      setDone(true)
      setTimeout(() => { router.push('/bd/today'); router.refresh() }, 1200)
    } catch (err) {
      setError(String(err)); setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight">设置新密码</h1>
        </div>
        <div className="border rounded-lg p-5 bg-card">
          {done ? (
            <p className="text-sm">✅ 密码已更新，正在进入系统…</p>
          ) : !ready ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>请通过邮件里的重置链接打开本页面。</p>
              <Link href="/forgot" className="text-primary hover:underline text-xs">重新发送重置邮件</Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">新密码（至少 8 位）</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full text-sm px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
                {loading ? '更新中…' : '更新密码并进入'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
