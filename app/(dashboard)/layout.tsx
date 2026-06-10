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
  { href: '/dashboard',             label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/tasks',                 label: 'Tasks',         icon: ListTodo        },
  { href: '/leads',                 label: 'Leads',         icon: Search          },
  { href: '/companies',             label: 'Companies',     icon: Building2       },
  { href: '/contacts',              label: 'Contacts',      icon: Users           },
  { href: '/pipeline',              label: 'Pipeline',      icon: TrendingUp      },
  { href: '/outreach',              label: 'Outreach',      icon: Send            },
  { href: '/samples',               label: 'Samples',       icon: Package         },
  { href: '/orders',                label: 'Orders',        icon: ClipboardList   },
  { href: '/approvals',             label: 'Approvals',     icon: CheckSquare     },
  { href: '/analytics',             label: 'Analytics',     icon: BarChart3       },
  { href: '/settings',              label: 'Settings',      icon: Settings        },
]

const systemItems = [
  { href: '/system/email-health',   label: 'Email Health',  icon: Heart           },
  { href: '/system/workers',        label: 'Workers',       icon: Cpu             },
]

// Most-used items for the mobile bottom nav
const mobileNav = [
  { href: '/dashboard',  label: 'Home',      icon: LayoutDashboard },
  { href: '/tasks',      label: 'Tasks',     icon: ListTodo        },
  { href: '/approvals',  label: 'Approvals', icon: CheckSquare     },
  { href: '/samples',    label: 'Samples',   icon: Package         },
  { href: '/companies',  label: 'Companies', icon: Building2       },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-56 border-r bg-card flex-col shrink-0">
        <div className="px-4 py-5 border-b">
          <h1 className="text-lg font-bold tracking-tight">ARAOS</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Revenue Agent OS</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          <div className="pb-1 px-3">
            <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">BD 工作台</p>
          </div>
          {bdItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
          <div className="pt-3 pb-1 px-3">
            <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">CRM</p>
          </div>
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
          <div className="pt-3 pb-1 px-3">
            <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">System</p>
          </div>
          {systemItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t">
          <p className="text-xs text-muted-foreground">Activewear OEM/ODM</p>
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
