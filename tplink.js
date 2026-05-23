#!/usr/bin/env node
// tplink — TP-Link EasyMesh router CLI (XDR / 易展 series)
// Usage: tplink <command> [subcommand] [args...]

const VERSION = '4.0.0';
const IP = process.env.TPLINK_IP || '192.168.0.1';
const SESSION_FILE = (process.env.HOME || require('os').homedir()) + '/.tplink-session';
const KEY1 = 'RDpbLfCPsJZ7fiv';
const KEY2 = 'yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW';

const CH = { '0':'Auto','36':'36','40':'40','44':'44','48':'48','52':'52','56':'56','60':'60','64':'64',
  '149':'149','153':'153','157':'157','161':'161','165':'165' };
const BW = { '0':'Auto','1':'20MHz','2':'40MHz','3':'80MHz' };
const PW = { '0':'High','1':'Mid','2':'Low' };

function enc(input, k1, k2) {
  let r = '', n = Math.max(input.length, k1.length);
  for (let m = 0; m < n; m++) {
    let k = 187, l = 187;
    m >= input.length ? l = k1.charCodeAt(m) : m >= k1.length ? k = input.charCodeAt(m) : (k = input.charCodeAt(m), l = k1.charCodeAt(m));
    r += k2.charAt((k ^ l) % k2.length);
  }
  return r;
}

// ---- Session ----
function load() { try { const fs = require('fs'); return fs.existsSync(SESSION_FILE) ? JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) : null; } catch { return null; } }
function save(s) { const fs = require('fs'); fs.writeFileSync(SESSION_FILE, JSON.stringify(s)); try { fs.chmodSync(SESSION_FILE, 0o600); } catch {} }
function clear() { try { require('fs').unlinkSync(SESSION_FILE); } catch {} }

async function login(pwd) {
  const e = enc(pwd, KEY1, KEY2);
  const r = await post('/', { method: 'do', login: { password: e } });
  if (r.error_code !== 0) throw new Error(`Login failed (code ${r.error_code})`);
  return encodeURIComponent(decodeURIComponent(r.stok));
}

async function checkStok(stok) {
  try {
    const r = await post(`/stok=${stok}/ds`, { method: 'get', device_info: { name: 'info' } });
    return r.error_code === 0;
  } catch { return false; }
}

async function post(path, body) {
  const r = await fetch(`http://${IP}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Referer': `http://${IP}/` },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function getStok() {
  const s = load();
  if (!s?.stok) throw new Error('Not logged in. Run: tplink login -p <password>');
  if (await checkStok(s.stok)) return s.stok;
  if (!s.pwd) throw new Error('Session expired and no saved password. Run: tplink login -p <password>');
  const stok = await login(s.pwd);
  save({ stok, pwd: s.pwd });
  return stok;
}

async function reauth(s, pwd) {
  const stok = await login(pwd);
  save({ stok, pwd });
  return stok;
}

// ---- Commands ----
async function cmdLogin(pwd) {
  if (!pwd) {
    try { pwd = require('readline').createInterface({ input: process.stdin, output: process.stderr }).question('Password: '); } catch {}
    if (!pwd) throw new Error('Password required. Use: tplink login -p <password>');
  }
  const stok = await login(pwd);
  save({ stok, pwd });
  const r = await post(`/stok=${stok}/ds`, { method: 'get', device_info: { name: 'info' } });
  const i = r.device_info?.info || {};
  console.log(`Logged in to ${i.device_model || IP}`);
  console.log(`Firmware: ${i.sw_version || '?'}`);
}

function cmdLogout() {
  clear();
  console.log('Logged out.');
}

async function cmdStatus(stok) {
  const [r, w] = await Promise.all([
    post(`/stok=${stok}/ds`, { method: 'get', device_info: { name: 'info' }, hosts_info: { table: 'host_info' },
      network: { name: ['wan_status', 'lan'] }, function: { name: 'new_module_spec' } }),
    post(`/stok=${stok}/ds`, { method: 'get', wireless: { name: ['wlan_host_2g', 'wlan_host_5g', 'wlan_bs'] } }),
  ]);
  const wi = r.device_info?.info || {};
  const wan = r.network?.wan_status || {};
  const lan = r.network?.lan || {};
  const sp = r.function?.new_module_spec || {};
  const h5 = w.wireless?.wlan_host_5g || {};
  const h2 = w.wireless?.wlan_host_2g || {};

  const hi = r.hosts_info?.host_info || [];
  const hosts = hi.length === 1 && Object.keys(hi[0]).length > 1
    ? Object.values(hi[0]).map(h => Object.values(h)[0])
    : hi.map(h => Object.values(h)[0]);

  console.log(wi.device_model || 'TP-Link Router');
  console.log(`  Firmware  ${wi.sw_version || '?'} (HW ${wi.hw_version || '?'})`);
  console.log(`  WAN       ${wan.proto || '?'}  ${wan.ipaddr || '?'}  →  gw ${wan.gateway || '?'}`);
  console.log(`  LAN       ${lan.ipaddr || '?'} / ${lan.macaddr || '?'}`);
  console.log(`  WiFi      CH 5G:${CH[h5.channel]||'?'}  BW:${BW[h5.bandwidth]||'?'}  Power:${PW[h5.power]||'?'}  │  CH 2G:${CH[h2.channel]||'?'}  BW:${BW[h2.bandwidth]||'?'}  Power:${PW[h2.power]||'?'}`);
  console.log(`  Features  BandSteering:${sp.wifison==='1'?'ON':'OFF'}  HWNAT:${sp.hnat==='1'?'ON':'OFF'}`);

  console.log(`\n  Devices (${hosts.length})`);
  console.log(`  TYPE  HOSTNAME                              IP               MAC                SPEED`);
  console.log(`  ────  ────────────────────────────────────  ───────────────  ─────────────────  ─────`);
  for (const h of hosts.sort((a, b) => (a.wifi_mode||'').localeCompare(b.wifi_mode||''))) {
    const t = h.type === '0' ? 'ETH' : h.wifi_mode === '0' ? '2.4G' : h.wifi_mode === '1' ? '5G ' : '  ?';
    const n = decodeURIComponent((h.hostname||'').replace(/\+/g,' ')) || '(unnamed)';
    const s = h.down_speed !== '0' ? `${h.down_speed}` : '';
    console.log(`  ${t}   ${n.padEnd(37)} ${(h.ip||'-').padEnd(16)} ${h.mac.padEnd(18)} ${s}`);
  }
}

async function cmdDevices(stok) {
  const r = await post(`/stok=${stok}/ds`, { method: 'get', hosts_info: { table: 'host_info' } });
  const hi = r.hosts_info?.host_info || [];
  const hosts = hi.length === 1 && Object.keys(hi[0]).length > 1
    ? Object.values(hi[0]).map(h => Object.values(h)[0])
    : hi.map(h => Object.values(h)[0]);
  for (const h of hosts.sort((a,b) => (a.wifi_mode||'').localeCompare(b.wifi_mode||''))) {
    const t = h.type === '0' ? 'ETH' : h.wifi_mode === '0' ? '2.4G' : h.wifi_mode === '1' ? '5G ' : '?';
    const n = decodeURIComponent((h.hostname||'').replace(/\+/g,' ')) || '(unnamed)';
    console.log(`${t}  ${n}  ${h.ip||'-'}  ${h.mac}`);
  }
}

async function cmdWifiShow(stok) {
  const w = await post(`/stok=${stok}/ds`, { method: 'get', wireless: { name: ['wlan_host_2g', 'wlan_host_5g', 'wlan_bs'] } });
  const h2 = w.wireless?.wlan_host_2g || {};
  const h5 = w.wireless?.wlan_host_5g || {};
  const bs = w.wireless?.wlan_bs || {};
  console.log(`SSID: ${bs.ssid || '?'}  BandSteering: ${bs.bs_enable==='1'?'ON':'OFF'}  Auth: ${bs.encryption==='1'?'WPA2':bs.encryption==='2'?'WPA3':'Open'}`);
  console.log(`5GHz  │ CH ${CH[h5.channel]||'?'} │ ${BW[h5.bandwidth]||'?'} │ Power ${PW[h5.power]||'?'} │ OFDMA ${h5.ofdma==='1'?'✓':'✗'} │ Mode ${h5.mode==='10'?'ax':h5.mode}`);
  console.log(`2.4G │ CH ${CH[h2.channel]||'?'} │ ${BW[h2.bandwidth]||'?'} │ Power ${PW[h2.power]||'?'} │ OFDMA ${h2.ofdma==='1'?'✓':'✗'} │ Mode ${h2.mode==='9'?'ax':h2.mode}`);
}

async function cmdWifiSet(stok, key, val) {
  const rev = { channel: { map: Object.fromEntries(Object.entries(CH).map(([k,v])=>[v.toLowerCase(),k])), name:'Channel', mod:'wlan_host_5g', field:'channel' },
    power: { map: { high:'0', mid:'1', low:'2' }, name:'Power', mod:'wlan_host_5g', field:'power',
      mod2:'wlan_host_2g', field2:'power' },
    bandwidth: { map: { auto:'0', 20:'1', 40:'2', 80:'3' }, name:'Bandwidth', mod:'wlan_host_5g', field:'bandwidth' } };
  const def = rev[key];
  if (!def) throw new Error(`Unknown wifi setting: ${key}. Use: channel, power, bandwidth`);
  const v = def.map[String(val).toLowerCase()];
  if (v == null) throw new Error(`Invalid ${key}: ${val}. Options: ${Object.keys(def.map).join(', ')}`);
  const o = {};
  o[def.mod] = { [def.field]: v };
  if (def.mod2) o[def.mod2] = { [def.field2]: v };
  const r = await post(`/stok=${stok}/ds`, { method: 'set', wireless: o });
  if (r.error_code === 0) {
    const label = { channel: CH[v]||v, power: PW[v]||v, bandwidth: BW[v]||v }[key];
    console.log(`${def.name} set to ${label}`);
  } else {
    throw new Error(`Failed: ${JSON.stringify(r)}`);
  }
}

async function cmdWan(stok) {
  const r = await post(`/stok=${stok}/ds`, { method: 'get', network: { name: ['wan_status', 'lan'] } });
  const w = r.network?.wan_status || {};
  const l = r.network?.lan || {};
  console.log(`WAN  ${w.proto||'?'}  ${w.ipaddr||'?'}  gw ${w.gateway||'?'}  dns ${w.pri_dns||'?'}`);
  console.log(`     Link ${w.link_status==1?'UP':'DOWN'}  PHY ${w.phy_status==1?'Connected':'Disconnected'}  Uptime ${Math.floor((w.up_time||0)/3600)}h`);
  console.log(`LAN  ${l.ipaddr||'?'}/${l.netmask||'?'}  MAC ${l.macaddr||'?'}`);
}

async function cmdTopology(stok) {
  const [r, w] = await Promise.all([
    post(`/stok=${stok}/ds`, { method: 'get', device_info: { name: 'info' }, hosts_info: { table: 'host_info' },
      network: { name: ['wan_status', 'lan'] }, function: { name: 'new_module_spec' } }),
    post(`/stok=${stok}/ds`, { method: 'get', wireless: { name: ['wlan_host_2g', 'wlan_host_5g', 'wlan_bs'] } }),
  ]);
  const wi = r.device_info?.info || {};
  const wan = r.network?.wan_status || {};
  const lan = r.network?.lan || {};
  const sp = r.function?.new_module_spec || {};
  const h5 = w.wireless?.wlan_host_5g || {};
  const h2 = w.wireless?.wlan_host_2g || {};
  const bs = w.wireless?.wlan_bs || {};

  const hi = r.hosts_info?.host_info || [];
  const hosts = hi.length === 1 && Object.keys(hi[0]).length > 1
    ? Object.values(hi[0]).map(h => Object.values(h)[0])
    : hi.map(h => Object.values(h)[0]);

  const eth = hosts.filter(h => h.type === '0');
  const g5 = hosts.filter(h => h.type !== '0' && h.wifi_mode === '1');
  const g2 = hosts.filter(h => h.type !== '0' && h.wifi_mode === '0');

  console.log(`\n  Internet`);
  console.log(`  ────────`);
  console.log(`  │  ${wan.proto || '?'}  ${wan.ipaddr || '?'}`);
  console.log(`  │  WAN Link: ${wan.link_status==1?'UP':'DOWN'}  Uptime: ${Math.floor((wan.up_time||0)/3600)}h`);
  console.log(`  │`);
  console.log(`  ONT (${wan.gateway || '?'})`);
  console.log(`  │  [gigabit Ethernet]`);
  console.log(`  │`);
  console.log(`  ${wi.device_model || 'TP-Link'}  (${lan.ipaddr || '?'})`);
  console.log(`  ├── FW: ${wi.sw_version || '?'}`);
  console.log(`  ├── 5GHz CH ${CH[h5.channel]||'?'} @ ${BW[h5.bandwidth]||'?'}  Power: ${PW[h5.power]||'?'}`);
  console.log(`  ├── 2.4G CH ${CH[h2.channel]||'?'} @ ${BW[h2.bandwidth]||'?'}  Power: ${PW[h2.power]||'?'}`);
  console.log(`  ├── SSID: ${bs.ssid || '?'}  (${bs.encryption==='1'?'WPA2':bs.encryption==='2'?'WPA3':'Open'})`);
  console.log(`  ├── Band Steering: ${sp.wifison==='1'?'ON':'OFF'}  HW NAT: ${sp.hnat==='1'?'ON':'OFF'}`);
  console.log(`  │`);
  console.log(`  ├── Mesh Node (C81F)  [gigabit wired backhaul]`);
  console.log(`  │   ├── MAC: 3c-06-a7-5d-c8-1f`);
  console.log(`  │   └── 5GHz CH same  @ 80MHz`);

  if (eth.length > 0) {
    console.log(`  │`);
    console.log(`  ├── Wired (${eth.length})`);
    for (const h of eth) {
      const n = decodeURIComponent((h.hostname||'').replace(/\+/g,' ')) || '(unnamed)';
      console.log(`  │   └── ${n}  ${h.ip||'-'}  ${h.mac}`);
    }
  }

  console.log(`  │`);
  console.log(`  ├── 5GHz WiFi (${g5.length})`);
  for (const h of g5) {
    const n = decodeURIComponent((h.hostname||'').replace(/\+/g,' ')) || '(unnamed)';
    const s = h.down_speed !== '0' ? ` ↓${h.down_speed}KB/s` : '';
    console.log(`  │   ├── ${n}  ${h.ip||'-'}  ${h.mac}${s}`);
  }

  console.log(`  │`);
  console.log(`  └── 2.4GHz WiFi (${g2.length})`);
  for (const h of g2) {
    const n = decodeURIComponent((h.hostname||'').replace(/\+/g,' ')) || '(unnamed)';
    console.log(`      ├── ${n}  ${h.ip||'-'}  ${h.mac}`);
  }
}

async function cmdReboot(stok) {
  const r = await post(`/stok=${stok}/ds`, { method: 'do', system: { reboot: null } });
  if (r.error_code === 0) console.log('Rebooting...');
  else throw new Error(`Reboot failed: ${JSON.stringify(r)}`);
}

async function cmdApi(stok, json) {
  try {
    const body = JSON.parse(json);
    const r = await post(`/stok=${stok}/ds`, body);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('Invalid JSON. Example: tplink api \'{"device_info":{"name":"info"}}\'');
    throw e;
  }
}

function showHelp(cmd) {
  if (cmd === 'login') { console.log(`tplink login -p <password>

  Log in to the router and save credentials.
  After login, other commands work without re-entering password.`); }
  else if (cmd === 'logout') { console.log(`tplink logout

  Clear saved credentials.`); }
  else if (cmd === 'status') { console.log(`tplink status

  Show router summary: model, firmware, WAN/LAN, WiFi settings,
  and all connected devices with real-time speed.`); }
  else if (cmd === 'devices') { console.log(`tplink devices

  List all connected devices (ETH / 5G / 2.4G).`); }
  else if (cmd === 'wifi') { console.log(`tplink wifi show
  tplink wifi set channel <149|153|157|161|165|36|40|44|48|auto>
  tplink wifi set power <high|mid|low>
  tplink wifi set bandwidth <auto|20|40|80>

  Show or configure WiFi radio settings.
  5GHz channels available: 36,40,44,48,52,56,60,64,149,153,157,161,165 (Auto)
  Setting power or bandwidth affects BOTH 2.4GHz and 5GHz radios.`); }
  else if (cmd === 'wan') { console.log(`tplink wan

  Show WAN (internet) connection status and LAN address.`); }
  else if (cmd === 'reboot') { console.log(`tplink reboot

  Reboot the router.`); }
  else if (cmd === 'api') { console.log(`tplink api '<json>'

  Send a raw API request. The JSON body is sent as-is.

  Known modules: device_info, hosts_info, network, wireless, function

  Example:
    tplink api '{"method":"get","device_info":{"name":"info"}}'
    tplink api '{"method":"get","wireless":{"name":["wlan_host_5g"]}}'`); }
  else {
    console.log(`tplink — TP-Link EasyMesh router CLI  v${VERSION}

USAGE
  tplink <command> [args...]

AUTH
  tplink login -p <password>     Log in and save credentials
  tplink logout                  Clear saved credentials

READ
  tplink status                  Router summary + all devices
  tplink topology                Network tree (ONT → routers → devices)
  tplink devices                 List all connected devices
  tplink wifi show               WiFi radio settings
  tplink wan                     WAN/LAN connection details

WRITE
  tplink wifi set channel <ch>   Set 5GHz channel
  tplink wifi set power <p>      Set TX power (high|mid|low)
  tplink wifi set bandwidth <bw> Set 5GHz bandwidth (auto|20|40|80)
  tplink reboot                  Reboot the router

ADVANCED
  tplink api '<json>'            Raw API request

FLAGS
  -p, --password <pwd>           Password (only for login)
  --help, help [cmd]             Show help (optionally for a command)
  --version                      Show version

ENV
  TPLINK_IP                      Router IP (default: 192.168.0.1)

EXAMPLES
  tplink login -p mypassword
  tplink status
  tplink wifi show
  tplink wifi set channel 149
  tplink reboot
  tplink api '{"device_info":{"name":"info"}}'
`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = { help: false, version: false, cmdHelp: null, pwd: null };
  const pos = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { flags.help = true; continue; }
    if (args[i] === '--version') { flags.version = true; continue; }
    if (args[i] === '-p' || args[i] === '--password') { flags.pwd = args[++i]; continue; }
    if (args[i] === 'help') { flags.help = true; flags.cmdHelp = args[i+1]; i++; continue; }
    pos.push(args[i]);
  }

  if (flags.version) { console.log(`tplink v${VERSION}`); process.exit(0); }
  if (flags.help) { showHelp(flags.cmdHelp || ''); process.exit(0); }

  const cmd = pos[0];

  // login/logout don't need existing session
  if (cmd === 'login') {
    await cmdLogin(flags.pwd);
    process.exit(0);
  }
  if (cmd === 'logout') { cmdLogout(); process.exit(0); }

  // All other commands need auth
  let stok, session;
  try {
    if (flags.pwd) {
      stok = await reauth(session, flags.pwd);
    } else {
      stok = await getStok();
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    if (!load()) console.error('  Hint: run "tplink login -p <password>" first.');
    process.exit(1);
  }

  // Dispatch
  try {
    switch (cmd) {
      case 'status': await cmdStatus(stok); break;
      case 'devices': await cmdDevices(stok); break;
      case 'wifi':
        if (pos[1] === 'show' || !pos[1]) await cmdWifiShow(stok);
        else if (pos[1] === 'set') await cmdWifiSet(stok, pos[2], pos[3]);
        else { console.error(`Unknown subcommand: wifi ${pos[1]}. Use: wifi show | wifi set <key> <val>`); process.exit(1); }
        break;
      case 'wan': await cmdWan(stok); break;
      case 'topology': await cmdTopology(stok); break;
      case 'reboot': await cmdReboot(stok); break;
      case 'api': await cmdApi(stok, pos[1] || ''); break;
      default: showHelp(''); process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
