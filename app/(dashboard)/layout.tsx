import Link from 'next/link'
import {
  LayoutDashboard,
  Search,
  Building2,
  Users,
  Send,
  CheckSquare,
  TrendingUp,
  BarChart3,
  Settings,
  Heart,
  Cpu,
  ListTodo,
  Package,
  ClipboardList,
  Sun,
  Inbox,
  FileText,
  Gauge,
} from 'lucide-react'

const bdItems = [
  { href: '/bd/today',             label: '今日工作台',  icon: Sun      },
  { href: '/bd/leads',             label: '客户池',      icon: Search   },
  { href: '/bd/replies',           label: '回复箱',      icon: Inbox    },
  { href: '/bd/reports',           label: '报告中心',    icon: FileText },
  { href: '/manager/bd-dashboard', label: '经理看板',    icon: Gauge    },
]

const navItems = [
  { href: '/dashboard',             label: '总览',       icon: LayoutDashboard },
  { href: '/tasks',                 label: '任务',       icon: ListTodo        },
  { href: '/leads',                 label: '线索',       icon: Search          },
  { href: '/companies',             label: '客户公司',   icon: Building2       },
  { href: '/contacts',              label: '联系人',     icon: Users           },
  { href: '/pipeline',              label: '销售漏斗',   icon: TrendingUp      },
  { href: '/outreach',              label: '开发信',     icon: Send            },
  { href: '/samples',               label: '样品',       icon: Package         },
  { href: '/orders',                label: '订单',       icon: ClipboardList   },
  { href: '/approvals',             label: '审批',       icon: CheckSquare     },
  { href: '/analytics',             label: '数据分析',   icon: BarChart3       },
  { href: '/settings',              label: '设置',       icon: Settings        },
]

const systemItems = [
  { href: '/system/email-health',   label: '邮件健康',   icon: Heart           },
  { href: '/system/workers',        label: '后台进程',   icon: Cpu             },
]

// Most-used items for the mobile bottom nav
const mobileNav = [
  { href: '/bd/today',   label: '今日',   icon: Sun             },
  { href: '/tasks',      label: '任务',   icon: ListTodo        },
  { href: '/approvals',  label: '审批',   icon: CheckSquare     },
  { href: '/samples',    label: '样品',   icon: Package         },
  { href: '/companies',  label: '客户',   icon: Building2       },
]

const navLinkCls =
  'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:text-white hover:bg-sidebar-accent transition-colors'

const sectionCls = 'text-[11px] font-medium text-sidebar-foreground/45 uppercase tracking-wider'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-56 flex-col shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-4 py-5 border-b border-sidebar-border">
          <h1 className="text-lg font-bold tracking-tight text-white">ARAOS</h1>
          <p className="text-xs text-sidebar-foreground/60 mt-0.5">QIMO 客户开发系统</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          <div className="pb-1 px-3">
            <p className={sectionCls}>BD 工作台</p>
          </div>
          {bdItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={navLinkCls}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
          <div className="pt-3 pb-1 px-3">
            <p className={sectionCls}>客户管理</p>
          </div>
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={navLinkCls}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
          <div className="pt-3 pb-1 px-3">
            <p className={sectionCls}>系统</p>
          </div>
          {systemItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={navLinkCls}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-xs text-sidebar-foreground/50">QIMO · 运动服 OEM/ODM</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t bg-card flex justify-around">
        {mobileNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-0.5 py-2 px-2 flex-1 text-[10px] text-muted-foreground hover:text-foreground active:bg-accent transition-colors"
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
