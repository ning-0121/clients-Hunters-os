'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset`,
      })
      if (error) { setError(error.message); setLoading(false); return }
      setSent(true)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight">找回密码</h1>
          <p className="text-xs text-muted-foreground mt-1">输入邮箱，我们发送重置链接</p>
        </div>
        {sent ? (
          <div className="border rounded-lg p-5 bg-card text-sm space-y-2">
            <p>✅ 重置邮件已发送到 <span className="font-medium">{email}</span>。</p>
            <p className="text-xs text-muted-foreground">请查收邮件（含垃圾箱），点链接设置新密码。链接会打开本系统的重置页。</p>
            <Link href="/login" className="text-primary hover:underline text-xs">← 返回登录</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3 border rounded-lg p-5 bg-card">
            <div>
              <label className="text-xs text-muted-foreground">邮箱</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full text-sm px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {loading ? '发送中…' : '发送重置链接'}
            </button>
            <p className="text-[11px] text-muted-foreground text-center pt-1">
              想起来了？<Link href="/login" className="text-primary hover:underline">去登录</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
