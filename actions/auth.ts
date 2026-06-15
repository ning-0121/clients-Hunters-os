'use server'

import { createDirectClient } from '@/lib/supabase/server'

/**
 * Create a team account, gated by an invite code (SIGNUP_CODE).
 * Uses the service-role admin API with email_confirm:true so the new user can
 * sign in immediately (no email-confirmation round-trip). The client signs in
 * after this returns ok.
 */
export async function createAccount(input: { email: string; password: string; code: string; name?: string }): Promise<{ ok?: boolean; error?: string }> {
  const email = input.email?.trim().toLowerCase()
  const password = input.password ?? ''
  const code = input.code?.trim() ?? ''

  if (!email || !password) return { error: '请填写邮箱和密码' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: '邮箱格式不正确' }
  if (password.length < 8) return { error: '密码至少 8 位' }

  const expected = process.env.SIGNUP_CODE
  if (!expected) return { error: '系统未配置邀请码，请联系管理员' }
  if (code !== expected) return { error: '邀请码不正确，请向管理员索取' }

  const sb = createDirectClient()
  const { error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'salesperson', name: input.name?.trim() || email.split('@')[0] },
  })
  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { error: '该邮箱已注册，请直接登录或找回密码' }
    }
    return { error: error.message }
  }
  return { ok: true }
}
