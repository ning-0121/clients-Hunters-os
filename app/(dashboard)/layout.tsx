import Link from 'next/link'
import {
  LayoutDashboard,
  Search,
  Building2,
  Users,
  Send,
  CheckSquare,
  TrendingUp,
  Brain,
  Cpu,
  Settings
} from 'lucide-react'

const navItems = [
  { href: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/leads',       label: 'Leads',        icon: Search },
  { href: '/companies',   label: 'Companies',    icon: Building2 },
  { href: '/contacts',    label: 'Contacts',     icon: Users },
  { href: '/outreach',    label: 'Outreach',     icon: Send },
  { href: '/approvals',   label: 'Approvals',    icon: CheckSquare },
  { href: '/pipeline',    label: 'Pipeline',     icon: TrendingUp },
  { href: '/learning',    label: 'Learning',     icon: Brain },
  { href: '/agents',      label: 'Agents',       icon: Cpu },
  { href: '/settings',    label: 'Settings',     icon: Settings },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r bg-card flex flex-col shrink-0">
        <div className="px-4 py-5 border-b">
          <h1 className="text-lg font-bold tracking-tight">ARAOS</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Revenue Agent OS</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
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
        </nav>
        <div className="px-4 py-3 border-t">
          <p className="text-xs text-muted-foreground">Activewear OEM/ODM</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
