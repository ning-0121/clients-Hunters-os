/**
 * Map a free-text job title to a normalized decision-maker role, and rank roles
 * by how worth-contacting they are for QIMO (sourcing/product/founder first).
 * Generic enough to extend per-industry later (kept config-light for V1).
 */
export type ContactRole =
  | 'founder' | 'sourcing' | 'product' | 'production'
  | 'operations' | 'marketing' | 'sales' | 'finance' | 'hr' | 'other'

export const ROLE_LABELS: Record<ContactRole, string> = {
  founder: '创始人/CEO',
  sourcing: '采购/Sourcing',
  product: '产品/买手',
  production: '生产/供应链',
  operations: '运营',
  marketing: '市场',
  sales: '销售',
  finance: '财务',
  hr: 'HR',
  other: '其他',
}

// Priority for "who to contact first" — ranked by BUYING INFLUENCE, not seniority.
// P1 sourcing/production/merch > P2 product-dev/ops/supply-chain > P3 founder/CEO > P4 rest.
// Founder is deliberately BELOW sourcing/production: at a brand with a real sourcing
// org, the founder is rarely the person who places OEM/ODM orders.
const RANK: Record<ContactRole, number> = {
  sourcing: 10, production: 9, product: 8, operations: 6,
  founder: 5, marketing: 4, sales: 3, finance: 2, hr: 1, other: 0,
}
export const roleRank = (r: ContactRole) => RANK[r] ?? 0

const PATTERNS: [ContactRole, RegExp][] = [
  ['founder',    /(founder|co-?founder|owner|ceo|chief executive|president|总裁|创始|老板|总经理|董事)/i],
  ['sourcing',   /(sourcing|procure|purchas|buyer|采购|供应链采购)/i],
  // production before product: "Production" contains the substring "product".
  ['production', /(production|supply chain|manufactur|operations? manager|plant|生产|供应链|跟单|工厂)/i],
  ['product',    /(product|merchandis|design|品类|产品|买手|设计)/i],
  ['operations', /(operation|coo|运营|ops)/i],
  ['marketing',  /(marketing|brand|growth|cmo|市场|品牌|增长)/i],
  ['sales',      /(sales|business development|bd|commercial|销售|业务)/i],
  ['finance',    /(finance|cfo|account|财务)/i],
  ['hr',         /(human resource|\bhr\b|talent|recruit|人事|招聘)/i],
]

export function classifyRole(title?: string | null): ContactRole {
  if (!title) return 'other'
  for (const [role, re] of PATTERNS) if (re.test(title)) return role
  return 'other'
}
