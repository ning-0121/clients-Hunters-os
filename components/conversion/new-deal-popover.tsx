'use client'

import { useState, useRef, useEffect } from 'react'
import { createDeal } from '@/actions/deals'

/**
 * New-opportunity popover. Unlike the old <details> (which never closed unless
 * you clicked the summary again), this dismisses on Cancel, click-outside, or Esc
 * — so opening it and deciding not to create no longer leaves it stuck open.
 */
export function NewDealPopover({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc) }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-primary cursor-pointer hover:underline">
        ＋ 新建机会
      </button>
      {open && (
        <form action={createDeal} className="absolute right-0 z-20 mt-1 w-72 border rounded-md bg-card p-3 space-y-2 shadow-lg">
          <input type="hidden" name="companyId" value={companyId} />
          <input name="title" required placeholder="机会标题，如 Leggings 5000pcs" className="w-full px-2 py-1 text-sm border rounded-md bg-background" />
          <div className="grid grid-cols-2 gap-2">
            <input name="product_category" placeholder="品类" className="px-2 py-1 text-xs border rounded-md bg-background" />
            <input name="qty" type="number" placeholder="数量" className="px-2 py-1 text-xs border rounded-md bg-background" />
            <input name="est_value_usd" type="number" placeholder="预估额 USD" className="px-2 py-1 text-xs border rounded-md bg-background" />
            <input name="expected_close_date" type="date" className="px-2 py-1 text-xs border rounded-md bg-background" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">创建机会</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">取消</button>
          </div>
        </form>
      )}
    </div>
  )
}
