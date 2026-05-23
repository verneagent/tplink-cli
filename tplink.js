#!/usr/bin/env node
// TP-Link EasyMesh Router CLI — for XDR / 易展 series
// Usage: node tplink.js -p <password> [status|wifi|wan|devices|raw <json>]

const CONFIG = { ip: process.env.TPLINK_IP || '192.168.0.1' };
const KEY1 = 'RDpbLfCPsJZ7fiv';
const KEY2 = 'yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW';
const CHANNELS = { '0': 'Auto', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
  '7': '7', '8': '8', '9': '9', '10': '10', '11': '11', '12': '12', '13': '13',
  '36': '36', '40': '40', '44': '44', '48': '48', '52': '52', '56': '56', '60': '60', '64': '64',
  '149': '149', '153': '153', '157': '157', '161': '161', '165': '165' };
const BW = { '0': 'Auto', '1': '20MHz', '2': '40MHz', '3': '80MHz' };

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

async function login(pwd) {
  const encoded = securityEncode(pwd, KEY1, KEY2);
  const resp = await fetch(`http://${CONFIG.ip}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Referer': `http://${CONFIG.ip}/` },
    body: JSON.stringify({ method: 'do', login: { password: encoded } }),
  });
  const data = await resp.json();
  if (data.error_code !== 0) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return encodeURIComponent(decodeURIComponent(data.stok));
}

async function api(stok, query) {
  const url = `http://${CONFIG.ip}/stok=${stok}/ds`;
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Referer': `http://${CONFIG.ip}/` },
    body: JSON.stringify(query),
  });
  return resp.json();
}

async function cmdStatus(stok) {
  const r = await api(stok, { method: 'get',
    device_info: { name: 'info' },
    hosts_info: { table: 'host_info' },
    network: { name: ['wan_status', 'lan'] },
    function: { name: 'new_module_spec' },
  });

  const info = r.device_info?.info || {};
  const spec = r.function?.new_module_spec || {};
  const wan = r.network?.wan_status || {};
  const lan = r.network?.lan || {};

  // Devices — host_info is either [{all_devices}] or [{dev1},{dev2}...]
  const hi = r.hosts_info?.host_info || [];
  const hosts = hi.length === 1 && Object.keys(hi[0]).length > 1
    ? Object.values(hi[0]).map(h => Object.values(h)[0])
    : hi.map(h => Object.values(h)[0]);

  console.log('=== Router ===');
  console.log(`  Model:    ${info.device_model || '?'}`);
  console.log(`  Firmware: ${info.sw_version || '?'}`);
  console.log(`  HW:       ${info.hw_version || '?'}`);
  console.log(`  WAN IP:   ${wan.ipaddr || '?'} (${wan.proto || '?'})`);
  console.log(`  Gateway:  ${wan.gateway || '?'}`);
  console.log(`  WAN Link: ${wan.link_status === 1 ? 'UP' : 'DOWN'} (${wan.phy_status === 1 ? 'connected' : 'disconnected'})`);
  console.log(`  LAN IP:   ${lan.ipaddr || '?'}`);
  console.log(`  Band Steering: ${spec.wifison === '1' ? 'ON' : 'OFF'}`);
  console.log(`  HW NAT:   ${spec.hnat === '1' ? 'enabled' : 'disabled'}`);

  console.log(`\n=== Devices (${hosts.length}) ===`);
  for (const h of hosts.sort((a, b) => (a.wifi_mode || '').localeCompare(b.wifi_mode || ''))) {
    // type="0" = ETH, type="1" = WiFi; wifi_mode="0"=2.4G, "1"=5G
    const band = h.type === '0' ? 'ETH' : (h.wifi_mode === '0' ? '2.4G' : h.wifi_mode === '1' ? '5G' : '?');
    const name = decodeURIComponent((h.hostname || '').replace(/\+/g, ' ')) || '(unnamed)';
    console.log(`  ${name.padEnd(35)} ${band.padEnd(4)} ${(h.ip || '-').padEnd(16)} ${h.mac}`);
  }
}

async function cmdWifi(stok) {
  const r = await api(stok, { method: 'get',
    wireless: { name: ['wlan_host_2g', 'wlan_host_5g', 'wlan_bs'] },
    function: { name: 'new_module_spec' },
  });

  const h2g = r.wireless?.wlan_host_2g || {};
  const h5g = r.wireless?.wlan_host_5g || {};
  const bs = r.wireless?.wlan_bs || {};
  const spec = r.function?.new_module_spec || {};

  console.log('=== WiFi ===');
  console.log(`  Band Steering (双频合一): ${bs.wifi_enable === '1' && bs.bs_enable === '1' ? 'ON' : 'OFF'}`);
  console.log(`  SSID:   ${bs.ssid || '(none)'}`);
  console.log(`  Auth:   ${bs.encryption === '1' ? 'WPA2' : bs.encryption === '2' ? 'WPA3' : 'Open'}`);
  console.log(`  Cipher: ${bs.cipher === '1' ? 'AES' : 'TKIP/AES'}`);
  if (spec.wifison_sched_enable === '1')
    console.log(`  Schedule: ${spec.wifison_sched_tm_begin}-${spec.wifison_sched_tm_end}`);
  if (spec.wifison_guest_enable === '1')
    console.log(`  Guest SSID: ${spec.wifison_guest_ssid || '?'}`);

  console.log(`\n  --- 2.4GHz Radio ---`);
  console.log(`  Enable:  ${h2g.enable === '1' ? 'Yes' : 'No'}`);
  console.log(`  Channel: ${CHANNELS[h2g.channel] || h2g.channel}`);
  console.log(`  Bandwidth: ${BW[h2g.bandwidth] || h2g.bandwidth}`);
  console.log(`  Mode:    ${h2g.mode === '9' ? '802.11b/g/n/ax' : h2g.mode}`);
  console.log(`  Power:   ${h2g.power === '0' ? 'High' : h2g.power === '1' ? 'Mid' : h2g.power === '2' ? 'Low' : h2g.power}`);
  console.log(`  OFDMA:   ${h2g.ofdma === '1' ? 'On' : 'Off'}`);

  console.log(`\n  --- 5GHz Radio ---`);
  console.log(`  Enable:  ${h5g.enable === '1' ? 'Yes' : 'No'}`);
  console.log(`  Channel: ${CHANNELS[h5g.channel] || h5g.channel}`);
  console.log(`  Bandwidth: ${BW[h5g.bandwidth] || h5g.bandwidth}`);
  console.log(`  Mode:    ${h5g.mode === '10' ? '802.11a/n/ac/ax' : h5g.mode}`);
  console.log(`  Power:   ${h5g.power === '0' ? 'High' : h5g.power === '1' ? 'Mid' : h5g.power === '2' ? 'Low' : h5g.power}`);
  console.log(`  OFDMA:   ${h5g.ofdma === '1' ? 'On' : 'Off'}`);
}

async function cmdWan(stok) {
  const r = await api(stok, { method: 'get', network: { name: ['wan_status', 'lan', 'internet'] } });
  const wan = r.network?.wan_status || {};
  const lan = r.network?.lan || {};
  console.log('=== WAN ===');
  console.log(`  Protocol:    ${wan.proto || '?'}`);
  console.log(`  IP:          ${wan.ipaddr || '?'}`);
  console.log(`  Netmask:     ${wan.netmask || '?'}`);
  console.log(`  Gateway:     ${wan.gateway || '?'}`);
  console.log(`  DNS:         ${wan.pri_dns || '?'} / ${wan.snd_dns || '?'}`);
  console.log(`  Link:        ${wan.link_status === 1 ? 'UP' : 'DOWN'}`);
  console.log(`  PHY:         ${wan.phy_status === 1 ? 'Connected' : 'Disconnected'}`);
  console.log(`  Uptime:      ${Math.floor((wan.up_time || 0) / 3600)}h ${Math.floor(((wan.up_time || 0) % 3600) / 60)}m`);
  console.log(`\n=== LAN ===`);
  console.log(`  IP:          ${lan.ipaddr || '?'}`);
  console.log(`  Netmask:     ${lan.netmask || '?'}`);
  console.log(`  MAC:         ${lan.macaddr || '?'}`);
}

async function cmdSet(stok, module, field, value) {
  const body = { method: 'set', wireless: {} };
  body.wireless[module] = { [field]: value };
  const r = await api(stok, body);
  if (r.error_code === 0) console.log(`OK: set ${module}.${field} = ${value}`);
  else console.log(`FAIL: ${JSON.stringify(r)}`);
}

async function main() {
  const args = process.argv.slice(2);
  let pwd = process.env.TPLINK_PWD, i = 0;
  if (args[0] === '-p') { pwd = args[1]; i = 2; }
  if (!pwd) { console.error('Usage: node tplink.js -p <password> [status|wifi|wan|devices|raw <json>|set <module> <field> <value>]'); process.exit(1); }

  const stok = await login(pwd);
  const cmd = args[i] || 'status';

  switch (cmd) {
    case 'status': case 'devices': await cmdStatus(stok); break;
    case 'wifi': await cmdWifi(stok); break;
    case 'wan': await cmdWan(stok); break;
    case 'set': await cmdSet(stok, args[i+1], args[i+2], args[i+3]); break;
    case 'raw': {
      const r = await api(stok, JSON.parse(args[i+1] || '{"device_info":{"name":"info"}}'));
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    default: console.error(`Unknown: ${cmd}`); process.exit(1);
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
