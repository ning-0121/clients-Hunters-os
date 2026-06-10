import { sendGmail } from '../lib/email/gmail'

const result = await sendGmail({
  to: 'alex@jojofashion.us',
  toName: 'Alex',
  subject: 'ARAOS Email Test ✅',
  body: 'This is a test email from the ARAOS system.\n\nIf you see this, Gmail sending is working correctly!\n\nTalk soon,\nAlex\njojofashion.us',
})

console.log(JSON.stringify(result, null, 2))
