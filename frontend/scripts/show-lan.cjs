/* eslint-disable no-console */
const os = require('os')

console.log('\nOpen one of these on your phone (same Wi‑Fi as this PC):\n')
const nets = os.networkInterfaces()
let any = false
for (const name of Object.keys(nets)) {
  for (const net of nets[name] || []) {
    const fam = net.family === 'IPv4' || net.family === 4
    if (fam && !net.internal) {
      any = true
      console.log(`  http://${net.address}:3000`)
    }
  }
}
if (!any) {
  console.log('  (no non-loopback IPv4 found — check Wi‑Fi / VPN)\n')
} else {
  console.log('\nCamera on phones usually needs HTTPS when not on localhost.')
  console.log('Use: pnpm dev:https   then open https://<IP>:3000 (accept cert warning)\n')
}
