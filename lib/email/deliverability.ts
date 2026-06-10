/**
 * Email Deliverability Checker
 * Checks SPF, DKIM, DMARC for the sending domain
 */

export interface DnsRecord {
  status: 'pass' | 'fail' | 'warn'
  value: string | null
  message: string
  recommendation?: string
}

export interface DeliverabilityReport {
  domain: string
  spf: DnsRecord
  dkim: DnsRecord
  dmarc: DnsRecord
  overallScore: number     // 0-100
  overallStatus: 'good' | 'warn' | 'danger'
  checkedAt: string
}

export async function checkDeliverability(domain: string): Promise<DeliverabilityReport> {
  const [spf, dkim, dmarc] = await Promise.all([
    checkSPF(domain),
    checkDKIM(domain),
    checkDMARC(domain),
  ])

  const scores = [spf, dkim, dmarc].map(r =>
    r.status === 'pass' ? 33 : r.status === 'warn' ? 17 : 0
  ) as number[]
  const overallScore = scores.reduce((a: number, b: number) => a + b, 0)

  return {
    domain,
    spf,
    dkim,
    dmarc,
    overallScore,
    overallStatus: overallScore >= 80 ? 'good' : overallScore >= 40 ? 'warn' : 'danger',
    checkedAt: new Date().toISOString(),
  }
}

async function checkSPF(domain: string): Promise<DnsRecord> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${domain}&type=TXT`)
    const json = await res.json() as { Answer?: Array<{ data: string }> }
    const records: string[] = (json.Answer ?? []).map((a) => a.data.replace(/"/g, ''))
    const spfRecord = records.find((r) => r.startsWith('v=spf1'))

    if (!spfRecord) {
      return {
        status: 'fail',
        value: null,
        message: 'No SPF record found',
        recommendation: 'Add TXT record: v=spf1 include:_spf.google.com ~all',
      }
    }

    const hasGoogle = spfRecord.includes('_spf.google.com') || spfRecord.includes('google.com')
    const hasSoftFail = spfRecord.endsWith('~all')
    const hasHardFail = spfRecord.endsWith('-all')

    if (!hasGoogle) {
      return {
        status: 'warn',
        value: spfRecord,
        message: 'SPF exists but missing Google include',
        recommendation: `Update to include: include:_spf.google.com (current: ${spfRecord})`,
      }
    }

    return {
      status: 'pass',
      value: spfRecord,
      message: `SPF configured${hasSoftFail ? ' (softfail ~all)' : hasHardFail ? ' (hardfail -all)' : ''}`,
    }
  } catch {
    return { status: 'fail', value: null, message: 'DNS lookup failed' }
  }
}

async function checkDKIM(domain: string): Promise<DnsRecord> {
  // Try common DKIM selectors
  const selectors = ['google', 'mail', 'default', 'k1', 'dkim', 's1', 's2']

  for (const selector of selectors) {
    try {
      const res = await fetch(`https://dns.google/resolve?name=${selector}._domainkey.${domain}&type=TXT`)
      const json = await res.json() as { Answer?: Array<{ data: string }> }
      if (json.Answer && json.Answer.length > 0) {
        const value = json.Answer[0].data.replace(/"/g, '')
        return {
          status: 'pass',
          value: `${selector}._domainkey (${value.slice(0, 60)}...)`,
          message: `DKIM configured (selector: ${selector})`,
        }
      }
    } catch {
      continue
    }
  }

  return {
    status: 'fail',
    value: null,
    message: 'No DKIM record found for common selectors',
    recommendation: 'Go to Google Workspace Admin → Gmail → Authenticate email → Generate DKIM key → Add to DNS',
  }
}

async function checkDMARC(domain: string): Promise<DnsRecord> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=_dmarc.${domain}&type=TXT`)
    const json = await res.json() as { Answer?: Array<{ data: string }> }
    const records = (json.Answer ?? []).map((a) => a.data.replace(/"/g, ''))
    const dmarcRecord = records.find((r) => r.startsWith('v=DMARC1'))

    if (!dmarcRecord) {
      return {
        status: 'fail',
        value: null,
        message: 'No DMARC record found',
        recommendation: 'Add TXT record at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com',
      }
    }

    const policy = dmarcRecord.match(/p=(\w+)/)?.[1] ?? 'none'
    const policyStatus = policy === 'reject' ? 'pass' : policy === 'quarantine' ? 'pass' : 'warn'

    return {
      status: policyStatus,
      value: dmarcRecord,
      message: `DMARC configured (policy: ${policy})${policy === 'none' ? ' — monitoring only' : ''}`,
      recommendation: policy === 'none'
        ? 'Consider upgrading to p=quarantine after confirming legitimate mail is passing'
        : undefined,
    }
  } catch {
    return { status: 'fail', value: null, message: 'DNS lookup failed' }
  }
}
