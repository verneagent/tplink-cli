#!/usr/bin/env node
// TP-Link EasyMesh Router CLI — for XDR / 易展 series
// Usage: node tplink.js -p <password> <command> [args...]
//
// Commands:
//   status                    Router info + all devices
//   wifi                      WiFi settings (channel, bw, power, band steering)
//   wan                       WAN/LAN connection details
//   info                      Firmware & hardware version only
//   channel [5G-channel]      Show or set 5GHz channel (149,153,157,161,165,36-64,auto=0)
//   power [high|mid|low]      Show or set radio TX power (both bands)
//   bandwidth [auto|20|40|80] Show or set 5GHz bandwidth
//   reboot                    Reboot the router
//   raw '<json>'              Arbitrary API query
//
// Examples:
//   node tplink.js -p mypass status
//   node tplink.js -p mypass channel 149
//   node tplink.js -p mypass power high
//   node tplink.js -p mypass reboot
//   node tplink.js -p mypass raw '{"device_info":{"name":"info"}}'

const CONFIG = { ip: process.env.TPLINK_IP || '192.168.0.1' };
const SESSION_FILE = (process.env.HOME || '~') + '/.tplink-session';
const KEY1 = 'RDpbLfCPsJZ7fiv';
const KEY2 = 'yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW';

const CH_NAMES = { '0':'Auto','36':'36','40':'40','44':'44','48':'48','52':'52','56':'56','60':'60','64':'64',
  '149':'149','153':'153','157':'157','161':'161','165':'165' };
const CH_REVERSE = Object.fromEntries(Object.entries(CH_NAMES).map(([k,v]) => [v,k]));
const BW_NAMES = { '0': 'Auto', '1': '20MHz', '2': '40MHz', '3': '80MHz' };
const BW_REVERSE = { 'auto': '0', '20': '1', '40': '2', '80': '3' };
const POWER_NAMES = { '0': 'High', '1': 'Mid', '2': 'Low' };
const POWER_REVERSE = { 'high': '0', 'mid': '1', 'low': '2' };

function securityEncode(input, key1, key2) {
  let result = '';
  const maxLen = Math.max(input.length, key1.length);
  for (let m = 0; m < maxLen; m++) {
    let k = 187, l = 187;
    if (m >= input.length) l = key1.charCodeAt(m);
    else if (m >= key1.length) k = input.charCodeAt(m);
    else { k = input.charCodeAt(m); l = key1.charCodeAt(m); }
    result += key2.charAt((k ^ l) % key2.length);
  }
  return result;
}

// ---- Session cache ----
function loadSession() {
  try {
    const fs = require('fs');
    if (!fs.existsSync(SESSION_FILE)) return null;
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch { return null; }
}

function saveSession(stok, pwd) {
  const fs = require('fs');
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ stok, pwd, saved: Date.now() }));
  try { fs.chmodSync(SESSION_FILE, 0o600); } catch {}
}

async function getStok(pwd) {
  // Try cached stok first
  const sess = loadSession();
  if (sess?.stok) {
    const r = await fetch(`http://${CONFIG.ip}/stok=${sess.stok}/ds`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Referer': `http://${CONFIG.ip}/` },
      body: JSON.stringify({ method: 'get', device_info: { name: 'info' } }),
    }).then(r => r.json()).catch(() => ({}));
    if (r.error_code === 0) {
      console.error(`[using cached session]`);
      return sess.stok;
    }
  }
  // Full login
  const thePwd = pwd || sess?.pwd;
  if (!thePwd) throw new Error('No password. Use -p <password> or set TPLINK_PWD env var.');
  const encoded = securityEncode(thePwd, KEY1, KEY2);
  const resp = await fetch(`http://${CONFIG.ip}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Referer': `http://${CONFIG.ip}/` },
    body: JSON.stringify({ method: 'do', login: { password: encoded } }),
  });
  const data = await resp.json();
  if (data.error_code !== 0) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  const stok = encodeURIComponent(decodeURIComponent(data.stok));
  saveSession(stok, thePwd);
  return stok;
}

async function api(stok, query) {
  const url = `http://${CONFIG.ip}/stok=${stok}/ds`;
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Referer': `http://${CONFIG.ip}/` },
    body: JSON.stringify(query),
  });
  return resp.json();
}

async function getWireless(stok) {
  const r = await api(stok, { method: 'get', wireless: { name: ['wlan_host_2g', 'wlan_host_5g', 'wlan_bs'] } });
  return r.wireless || {};
}

async function cmdStatus(stok) {
  const [r, w] = await Promise.all([
    api(stok, { method: 'get', device_info: { name: 'info' }, hosts_info: { table: 'host_info' },
      network: { name: ['wan_status', 'lan'] }, function: { name: 'new_module_spec' } }),
    getWireless(stok),
  ]);
  const info = r.device_info?.info || {};
  const wan = r.network?.wan_status || {};
  const lan = r.network?.lan || {};
  const spec = r.function?.new_module_spec || {};
  const h5g = w.wlan_host_5g || {};
  const h2g = w.wlan_host_2g || {};

  const hi = r.hosts_info?.host_info || [];
  const hosts = hi.length === 1 && Object.keys(hi[0]).length > 1
    ? Object.values(hi[0]).map(h => Object.values(h)[0])
    : hi.map(h => Object.values(h)[0]);

  console.log(`=== Router ===`);
  console.log(`  Model:        ${info.device_model || '?'}`);
  console.log(`  Firmware:     ${info.sw_version || '?'}`);
  console.log(`  WAN IP:       ${wan.ipaddr || '?'} (${wan.proto || '?'})`);
  console.log(`  Gateway:      ${wan.gateway || '?'}`);
  console.log(`  WAN Link:     ${wan.link_status === 1 ? 'UP' : 'DOWN'}`);
  console.log(`  LAN:          ${lan.ipaddr || '?'} / ${lan.macaddr || '?'}`);
  console.log(`  Band Steering: ${spec.wifison === '1' ? 'ON' : 'OFF'} | HW NAT: ${spec.hnat === '1' ? 'ON' : 'OFF'}`);
  console.log(`  5GHz:         CH ${CH_NAMES[h5g.channel] || h5g.channel} @ ${BW_NAMES[h5g.bandwidth] || h5g.bandwidth} | Power: ${POWER_NAMES[h5g.power] || h5g.power}`);
  console.log(`  2.4GHz:       CH ${CH_NAMES[h2g.channel] || h2g.channel} @ ${BW_NAMES[h2g.bandwidth] || h2g.bandwidth} | Power: ${POWER_NAMES[h2g.power] || h2g.power}`);

  const eth = hosts.filter(h => h.type === '0').length;
  const g5 = hosts.filter(h => h.type !== '0' && h.wifi_mode === '1').length;
  const g2 = hosts.filter(h => h.type !== '0' && h.wifi_mode === '0').length;
  console.log(`  Devices:      ${hosts.length} total (${eth} ETH + ${g5} 5G + ${g2} 2.4G)`);

  console.log(`\n=== Devices (${hosts.length}) ===`);
  for (const h of hosts.sort((a, b) => (a.wifi_mode || '').localeCompare(b.wifi_mode || ''))) {
    const band = h.type === '0' ? 'ETH' : (h.wifi_mode === '0' ? '2.4G' : h.wifi_mode === '1' ? '5G' : '?');
    const name = decodeURIComponent((h.hostname || '').replace(/\+/g, ' ')) || '(unnamed)';
    const dn = h.down_speed !== '0' ? ` ↓${h.down_speed}kB/s` : '';
    const up = h.up_speed !== '0' ? ` ↑${h.up_speed}kB/s` : '';
    console.log(`  ${name.padEnd(35)} ${band.padEnd(4)} ${(h.ip || '-').padEnd(16)} ${h.mac}${dn}${up}`);
  }
}

async function cmdWifi(stok) {
  const w = await getWireless(stok);
  const h2g = w.wlan_host_2g || {};
  const h5g = w.wlan_host_5g || {};
  const bs = w.wlan_bs || {};

  console.log('=== WiFi ===');
  console.log(`  Band Steering: ${bs.wifi_enable === '1' && bs.bs_enable === '1' ? 'ON' : 'OFF'}  SSID: ${bs.ssid || '(none)'}`);
  console.log(`  Auth: ${bs.encryption === '1' ? 'WPA2' : bs.encryption === '2' ? 'WPA3' : 'Open'} / ${bs.cipher === '1' ? 'AES' : 'TKIP'}`);
  console.log(`\n  5GHz │ CH ${CH_NAMES[h5g.channel] || h5g.channel} │ ${BW_NAMES[h5g.bandwidth] || h5g.bandwidth} │ Power ${POWER_NAMES[h5g.power] || h5g.power} │ OFDMA ${h5g.ofdma === '1' ? '✓' : '✗'}`);
  console.log(`  2.4G │ CH ${CH_NAMES[h2g.channel] || h2g.channel} │ ${BW_NAMES[h2g.bandwidth] || h2g.bandwidth} │ Power ${POWER_NAMES[h2g.power] || h2g.power} │ OFDMA ${h2g.ofdma === '1' ? '✓' : '✗'}`);
}

async function cmdInfo(stok) {
  const r = await api(stok, { method: 'get', device_info: { name: 'info' } });
  const i = r.device_info?.info || {};
  console.log(`Model:    ${i.device_model || '?'}`);
  console.log(`Firmware: ${i.sw_version || '?'}`);
  console.log(`HW:       ${i.hw_version || '?'}`);
}

async function cmdWan(stok) {
  const r = await api(stok, { method: 'get', network: { name: ['wan_status', 'lan'] } });
  const wan = r.network?.wan_status || {};
  const lan = r.network?.lan || {};
  console.log(`=== WAN ===`);
  console.log(`  Protocol: ${wan.proto || '?'}  IP: ${wan.ipaddr || '?'}`);
  console.log(`  Gateway:  ${wan.gateway || '?'}  DNS: ${wan.pri_dns || '?'}`);
  console.log(`  Link:     ${wan.link_status === 1 ? 'UP ✅' : 'DOWN ❌'}  PHY: ${wan.phy_status === 1 ? 'Connected' : 'Disconnected'}`);
  console.log(`  Uptime:   ${Math.floor((wan.up_time||0)/3600)}h ${Math.floor(((wan.up_time||0)%3600)/60)}m`);
  console.log(`=== LAN ===`);
  console.log(`  IP: ${lan.ipaddr || '?'}  Netmask: ${lan.netmask || '?'}  MAC: ${lan.macaddr || '?'}`);
}

async function cmdChannel(stok, val) {
  const w = await getWireless(stok);
  const h5g = w.wlan_host_5g || {};
  if (!val) {
    console.log(`5G Channel: ${CH_NAMES[h5g.channel] || h5g.channel}`);
    console.log(`Available: ${Object.values(CH_NAMES).join(', ')}`);
    return;
  }
  const ch = val === 'auto' ? '0' : (CH_REVERSE[val] || val);
  if (!CH_NAMES[ch]) { console.error(`Invalid channel: ${val}. Use: ${Object.values(CH_NAMES).join(', ')}`); process.exit(1); }
  const r = await api(stok, { method: 'set', wireless: { wlan_host_5g: { channel: ch } } });
  if (r.error_code === 0) console.log(`5G Channel set to ${CH_NAMES[ch]}`);
  else console.log(`FAIL: ${JSON.stringify(r)}`);
}

async function cmdPower(stok, val) {
  const w = await getWireless(stok);
  const h5g = w.wlan_host_5g || {}, h2g = w.wlan_host_2g || {};
  if (!val) {
    console.log(`2.4G Power: ${POWER_NAMES[h2g.power] || h2g.power}`);
    console.log(`5G   Power: ${POWER_NAMES[h5g.power] || h5g.power}`);
    return;
  }
  const p = POWER_REVERSE[val.toLowerCase()];
  if (!p) { console.error(`Invalid: ${val}. Use: high, mid, low`); process.exit(1); }
  const r = await api(stok, { method: 'set', wireless: { wlan_host_2g: { power: p }, wlan_host_5g: { power: p } } });
  if (r.error_code === 0) console.log(`TX Power set to ${POWER_NAMES[p]} (both bands)`);
  else console.log(`FAIL: ${JSON.stringify(r)}`);
}

async function cmdBandwidth(stok, val) {
  const w = await getWireless(stok);
  const h5g = w.wlan_host_5g || {}, h2g = w.wlan_host_2g || {};
  if (!val) {
    console.log(`2.4G Bandwidth: ${BW_NAMES[h2g.bandwidth] || h2g.bandwidth}`);
    console.log(`5G   Bandwidth: ${BW_NAMES[h5g.bandwidth] || h5g.bandwidth}`);
    return;
  }
  const bw = BW_REVERSE[val.toLowerCase()];
  if (!bw) { console.error(`Invalid: ${val}. Use: auto, 20, 40, 80`); process.exit(1); }
  const r = await api(stok, { method: 'set', wireless: { wlan_host_5g: { bandwidth: bw } } });
  if (r.error_code === 0) console.log(`5G Bandwidth set to ${BW_NAMES[bw]}`);
  else console.log(`FAIL: ${JSON.stringify(r)}`);
}

async function cmdReboot(stok) {
  console.log('Rebooting...');
  const r = await api(stok, { method: 'do', system: { reboot: null } });
  if (r.error_code === 0) console.log('OK: router is restarting.');
  else console.log(`FAIL: ${JSON.stringify(r)}`);
}

const HELP = `TP-Link CLI v3 — for XDR / 易展 series

Usage: node tplink.js -p <password> <command> [args...]

Commands:
  status                    Router summary + all devices with realtime speed
  wifi                      WiFi radio settings (channel, bw, power)
  wan                       WAN/LAN connection details
  info                      Firmware & hardware version
  channel [num|auto]        Show or set 5GHz channel
  power [high|mid|low]       Show or set TX power (both bands)
  bandwidth [auto|20|40|80]  Show or set 5GHz bandwidth
  reboot                    Reboot the router
  raw '<json>'              Arbitrary API query

Examples:
  TPLINK_PWD=mypass node tplink.js status         # env var, no -p needed
  node tplink.js -p mypass wifi
  node tplink.js -p mypass channel 149            # switch to channel 149
  node tplink.js -p mypass power high             # max TX power
  node tplink.js -p mypass reboot                 # restart router
`;

async function main() {
  const args = process.argv.slice(2);
  let pwd, i = 0;
  if (args[0] === '-p') { pwd = args[1]; i = 2; }
  pwd = pwd || process.env.TPLINK_PWD;
  if (args[0] === '-h' || args[0] === 'help') { console.log(HELP); process.exit(0); }

  const stok = await getStok(pwd);
  const cmd = args[i] || 'status';
  const arg = args[i+1];

  switch (cmd) {
    case 'status': case 'devices': await cmdStatus(stok); break;
    case 'wifi': await cmdWifi(stok); break;
    case 'wan': await cmdWan(stok); break;
    case 'info': await cmdInfo(stok); break;
    case 'channel': await cmdChannel(stok, arg); break;
    case 'power': await cmdPower(stok, arg); break;
    case 'bandwidth': await cmdBandwidth(stok, arg); break;
    case 'reboot': await cmdReboot(stok); break;
    case 'raw': {
      const r = await api(stok, JSON.parse(args[i+1] || '{"device_info":{"name":"info"}}'));
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    default: console.error(`Unknown: ${cmd}. Use -h for help.`); process.exit(1);
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
