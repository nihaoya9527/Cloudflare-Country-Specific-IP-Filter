/* ================== 1. 登录系统与全局工具 ================== */
const WORKER_PASSWORD = ''; // 可在此设置密码
const PASSWORD_ENV_KEY = 'ACCESS_PASSWORD';
const COOKIE_NAME = 'GXNAS_AUTH';

function getPassword(env) {
  return env?.[PASSWORD_ENV_KEY] || WORKER_PASSWORD;
}
function passwordConfigured(env) {
  const pw = getPassword(env);
  return typeof pw === 'string' && pw.length > 0;
}
function isLoggedIn(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return m && m[1] === btoa(getPassword(env));
}
function redirect(loc) {
  return new Response(null, { status: 302, headers: { Location: loc } });
}

// 数字转上标
function toSuperScript(num) {
  const map = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return num.toString().split('').map(c => map[c] || c).join('');
}

// 获取国旗 Emoji
function getFlagEmoji(countryCode) {
  if (countryCode === 'TW') return '🇹🇼';
  return countryCode.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
}

function loginPage(error = false) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>访问验证</title><style>body{background:#020617;color:#e5e7eb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.box{width:360px;padding:32px;border:1px solid #334155;border-radius:16px;background:#0f172a}input,button{width:100%;padding:12px;border-radius:8px;font-size:16px;box-sizing:border-box}input{background:#020617;border:1px solid #334155;color:#fff;margin-bottom:16px}button{border:none;background:#2563eb;color:#fff;cursor:pointer}button:hover{background:#1d4ed8}.err{color:#f87171;margin-top:12px;text-align:center}</style><div class="box"><h2>🔐 请输入访问密码</h2><form method="post"><input type="password" name="password" required autofocus><button>进入系统</button>${error ? '<div class="err">密码错误</div>' : ''}</form></div>`, {
    headers: { 'content-type': 'text/html;charset=utf-8' }
  });
}

/* ================== 2. 核心业务逻辑 ================== */
const REGION_MAP = {
  'US':'美国','GB':'英国','DE':'德国','FR':'法国','NL':'荷兰','JP':'日本','KR':'韩国',
  'SG':'新加坡','CA':'加拿大','AU':'澳大利亚','IN':'印度','TR':'土耳其','TH':'泰国',
  'ID':'印尼','MY':'马来西亚','VN':'越南','PH':'菲律宾','BR':'巴西','ZA':'南非',
  'IT':'意大利','ES':'西班牙','RU':'俄罗斯','HK':'香港','TW':'台湾','SE':'瑞典',
  'FI':'芬兰','PL':'波兰','CH':'瑞士','AE':'阿联酋','IL':'以色列','EE':'爱沙尼亚',
  'MD':'摩尔多瓦','CZ':'捷克','LV':'拉脱维亚','AL':'阿尔巴尼亚','SI':'斯洛文尼亚',
  'BG':'保加利亚','BE':'比利时','IE':'爱尔兰','RO':'罗马尼亚','IS':'冰岛',
  'LT':'立陶宛','AT':'奥地利','DK':'丹麦','NO':'挪威','PT':'葡萄牙','GR':'希腊',
  'HU':'匈牙利','NZ':'新西兰','MX':'墨西哥','AR':'阿根廷','CL':'智利',
  'UA':'乌克兰','KZ':'哈萨克斯坦','SA':'沙特','QA':'卡塔尔',
  'SK':'斯洛伐克','HR':'克罗地亚','LU':'卢森堡','RS':'塞尔维亚'
};

export default {
  async fetch(request, env) {
    if (!passwordConfigured(env)) {
      return new Response('ACCESS_PASSWORD 未设置，服务已禁用', { status: 500 });
    }

    const url = new URL(request.url);

    if (url.pathname === '/login') {
      if (request.method === 'POST') {
        const fd = await request.formData();
        if (fd.get('password') === getPassword(env)) {
          return new Response(null, {
            status: 302,
            headers: {
              'Set-Cookie': `${COOKIE_NAME}=${btoa(getPassword(env))}; Path=/; HttpOnly; SameSite=Strict`,
              'Location': '/'
            }
          });
        }
        return loginPage(true);
      }
      return loginPage();
    }

    if (!isLoggedIn(request, env)) return redirect('/login');

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    // 路由解析
    const limit = parseInt(url.searchParams.get('limit')) || 0;
    const rawPath = decodeURIComponent(url.pathname);
    const pathMatches = rawPath.replace(/\/+$/, '').match(/^\/(CFnew|edgetunnel)\/(.+)$/);
        
    if (pathMatches) {
      const type = pathMatches[1];
      const regions = pathMatches[2];
      // 如果是 CFnew，使用原始逗号分隔格式；如果是 edgetunnel，使用带备注的换行格式
      const format = (type === 'CFnew') ? 'cf_comma_short' : 'line';
      return handleRawRequest(regions, format, limit, request.url);
    }

    if (url.searchParams.has('api')) return handleApiRequest(url);
    if (url.searchParams.has('get_regions')) return handleGetRegions();
    
    return new Response(getHtml(), { headers: { 'content-type': 'text/html; charset=UTF-8' } });
  }
};

/* ================== 3. 数据处理函数 ================== */

async function handleGetRegions() {
  try {
    const res = await fetch("https://zip.cm.edu.kg/all.txt");
    const text = await res.text();
    const matches = text.match(/#[A-Z]+/g) || [];
    const counts = {};
    matches.forEach(tag => {
      const region = tag.replace('#', '');
      counts[region] = (counts[region] || 0) + 1;
    });
    const regions = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return new Response(JSON.stringify(regions), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }
}

async function handleApiRequest(url) {
  const regions = url.searchParams.get('region')?.split(',') || [];
  const format = url.searchParams.get('format') || 'line';
  return handleRawRequest(regions.join(','), format, 0, url.toString());
}

async function handleRawRequest(regionStr, format, limit = 0, requestUrl = null) {
  const targetRegions = decodeURIComponent(regionStr).split(/[,-]/).map(r => r.trim().toUpperCase()).filter(r => r);
  let needBase64 = false;
  if (requestUrl) {
    const urlObj = new URL(requestUrl);
    needBase64 = urlObj.searchParams.has('base64') && urlObj.searchParams.get('base64') !== '0';
  }

  try {
    const response = await fetch("https://zip.cm.edu.kg/all.txt");
    let text = await response.text();
    const lines = text.replace(/^\uFEFF/, '').split('\n');
    
    const regionCounters = {}; 
    const regionLimitCounters = {};
    let processed = [];

    // 判断是否为 CFnew 这种逗号分隔的格式
    const isCommaFormat = format.includes('comma');

    for (const line of lines) {
      if (!line.includes('#')) continue;
      const [ipPort, codeRaw] = line.split('#');
      const code = codeRaw ? codeRaw.trim().toUpperCase() : '';

      if (targetRegions.includes(code)) {
        if (limit > 0) {
          regionLimitCounters[code] = (regionLimitCounters[code] || 0) + 1;
          if (regionLimitCounters[code] > limit) continue;
        }

        regionCounters[code] = (regionCounters[code] || 0) + 1;
        const flag = getFlagEmoji(code);
        const name = REGION_MAP[code] || code;
        const countStr = toSuperScript(regionCounters[code]);
        
        // 核心逻辑：如果是 edgetunnel (line 格式)，添加备注；如果是 CFnew (comma 格式)，保持原样
        if (isCommaFormat) {
          processed.push(ipPort.trim());
        } else {
          processed.push(`${ipPort.trim()}#${flag} ${name}${countStr}`);
        }
      }
    }

    const separator = isCommaFormat ? ',' : '\n';
    let resultStr = processed.join(separator);
    
    if (needBase64) resultStr = btoa(unescape(encodeURIComponent(resultStr)));

    return new Response(resultStr, { 
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'Access-Control-Allow-Origin': '*' } 
    });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500 });
  }
}

/* ================== 5. 前端 HTML ================== */
function getHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Country-Specific IP Filter</title>
    <link rel="icon" href="https://www.cloudflare.com/favicon.ico" type="image/x-icon">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>tailwind.config = { darkMode: 'class' }</script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Fira+Code&display=swap');
        body { font-family: 'Inter', sans-serif; transition: background 0.3s, color 0.3s; }
        .dark { background-color: #020617; color: #f8fafc; }
        .light { background-color: #f8fafc; color: #0f172a; }
        .glass { border: 1px solid rgba(150,150,150,0.1); }
        .region-card { transition: all 0.2s; border: 2px solid transparent; }
        .region-card.active { border-color: #2563eb !important; background-color: rgba(37,99,235,0.1) !important; transform: scale(1.05); font-weight: 700; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15); }
        .fira { font-family: 'Fira Code', monospace; }
        .dropdown-menu { transform-origin: top right; transition: all 0.2s ease-out; transform: scale(0.95); opacity: 0; pointer-events: none; }
        .dropdown-menu.open { transform: scale(1); opacity: 1; pointer-events: auto; }
        .link-menu { transform-origin: top center; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); transform: translate(-50%, -10px) scale(0.95); opacity: 0; pointer-events: none; }
        .group:hover .link-menu, .link-menu.open { transform: translate(-50%, 0) scale(1); opacity: 1; pointer-events: auto; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }
        .btn-matrix { background-color: #000; color: #0f0; border: 1px solid #0f0; font-family: 'Courier New', monospace; border-radius: 0.75rem; box-shadow: 0 0 5px rgba(0, 255, 0, 0.5); text-shadow: 0 0 5px rgba(0, 255, 0, 0.8); transition: all 0.2s ease; letter-spacing: 2px; }
        .btn-matrix:hover { background-color: #001a00; box-shadow: 0 0 20px rgba(0, 255, 0, 0.8), inset 0 0 10px rgba(0, 255, 0, 0.4); transform: translateY(-2px); }
        .btn-racing { background: linear-gradient(135deg, #ff8c00, #ff4500); color: white; border: none; border-radius: 0.75rem; font-style: italic; font-weight: 800; box-shadow: 5px 5px 0px rgba(0,0,0,0.2); transition: all 0.2s; }
        .btn-racing:hover { transform: scale(1.02) translate(-2px, -2px); box-shadow: 8px 8px 0px rgba(0,0,0,0.2); }
        #toast-container { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 12px; pointer-events: none; }
        .toast { pointer-events: auto; display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-radius: 16px; font-weight: 600; font-size: 14px; box-shadow: 0 15px 30px -5px rgba(0,0,0,0.2); backdrop-filter: blur(12px); animation: slideIn 0.4s forwards; border: 1px solid rgba(255,255,255,0.1); }
        .toast-success { background-color: rgba(22, 163, 74, 0.9); color: white; }
        .toast-error { background-color: rgba(220, 38, 38, 0.9); color: white; }
        @keyframes slideIn { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-20px); opacity: 0; } }
    </style>
</head>
<body class="light min-h-screen pb-10" onclick="closeAllDropdowns(event)">
    <div id="toast-container"></div>
    <nav class="sticky top-0 z-50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center mb-6">
        <div class="flex items-center gap-3 font-bold text-xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 117" class="w-9 h-9"><path fill="#fbad41" d="M205.52 50.813c-.858 0-1.705.03-2.551.058q-.207.012-.398.094a1.42 1.42 0 0 0-.92.994l-3.628 12.672c-1.565 5.449-.983 10.48 1.646 14.174c2.41 3.416 6.42 5.421 11.289 5.655l19.679 1.194c.585.03 1.092.312 1.4.776a1.92 1.92 0 0 1 .2 1.692a2.5 2.5 0 0 1-2.134 1.662l-20.448 1.193c-11.11.515-23.062 9.58-27.255 20.633l-1.474 3.9a1.092 1.092 0 0 0 .967 1.49h70.425a1.87 1.87 0 0 0 1.81-1.365A51.2 51.2 0 0 0 256 101.828c0-28.16-22.582-50.984-50.449-50.984"/><path fill="#f6821f" d="m174.782 115.362l1.303-4.583c1.568-5.449.987-10.48-1.639-14.173c-2.418-3.417-6.424-5.422-11.296-5.656l-92.312-1.193a1.82 1.82 0 0 1-1.459-.776a1.92 1.92 0 0 1-.203-1.693a2.5 2.5 0 0 1 2.154-1.662l93.173-1.193c11.063-.511 23.015-9.58 27.208-20.633l5.313-14.04c.214-.596.27-1.238.156-1.86C191.126 20.51 166.91 0 137.96 0C111.269 0 88.626 17.403 80.5 41.596a27 27 0 0 0-19.156-5.359C48.549 37.524 38.25 47.946 36.979 60.88a27.9 27.9 0 0 0 .702 9.642C16.773 71.145 0 88.454 0 109.726c0 1.923.137 3.818.413 5.667c.115.897.879 1.57 1.783 1.568h170.48a2.22 2.22 0 0 0 2.106-1.63"/></svg>
            <span class="text-slate-700 dark:text-slate-200 tracking-tight">IP Filter</span>
        </div>
        <div class="flex items-center gap-3">
            <button onclick="window.open('https://github.com/alienwaregf/Cloudflare-Country-Specific-IP-Filter', '_blank')" class="px-4 py-2 rounded-2xl bg-gray-800 text-white font-bold text-xs flex items-center gap-2"><i data-lucide="github" class="w-4 h-4"></i> GitHub</button>
            <button onclick="toggleDropdown(event)" class="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border flex items-center justify-center"><i data-lucide="sun" class="w-5 h-5"></i></button>
            <div id="themeDropdown" class="dropdown-menu absolute right-6 top-16 w-28 bg-white dark:bg-slate-800 border rounded-xl shadow-xl p-1 z-50">
                <button onclick="setThemeMode('system')" class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">🖥️ 系统</button>
                <button onclick="setThemeMode('light')" class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">🌞 浅色</button>
                <button onclick="setThemeMode('dark')" class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">🌙 深色</button>
            </div>
        </div>
    </nav>

    <main class="max-w-5xl mx-auto px-4 flex flex-col gap-6">
        <div class="bg-white dark:bg-slate-900 p-6 rounded-[2rem] glass shadow-xl">
            <div class="flex justify-between items-end mb-6">
                <div><h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest">全球节点</h2><p class="text-sm opacity-60">选择地区提取 IP</p></div>
                <div class="flex gap-2">
                    <button onclick="randomSelect()" class="px-4 py-2 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-xs font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2"><i data-lucide="dices" class="w-4 h-4"></i> 随机</button>
                    <button onclick="selectAll()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold">全选</button>
                </div>
            </div>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3" id="regionGrid"></div>
            <div class="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onclick="autoRun('CFnew')" class="btn-matrix h-14 font-bold flex items-center justify-center gap-2"><span>CFnew</span></button>
                <button onclick="autoRun('edgetunnel')" class="btn-racing h-14 flex items-center justify-center gap-2"><span>edgetunnel</span></button>
            </div>
        </div>
        
        <div class="bg-white dark:bg-slate-900 rounded-[2rem] glass shadow-xl overflow-hidden">
            <div class="px-6 py-4 border-b flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
                <span id="stats" class="text-xs font-mono opacity-50 uppercase">WAITING...</span>
                <div class="flex gap-2">
                    <div class="flex items-center bg-white dark:bg-slate-700 border rounded-lg px-2 h-9">
                        <span class="text-[10px] font-bold opacity-40 mr-2">MAX</span>
                        <input id="limitInput" type="number" value="10" class="w-8 bg-transparent text-xs text-center outline-none">
                    </div>
                    <button onclick="copy()" class="bg-white dark:bg-slate-700 border px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1"><i data-lucide="copy" class="w-3.5 h-3.5"></i> 复制</button>
                    <div class="relative group">
                        <button onclick="toggleLinkMenu(event)" class="bg-slate-900 dark:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1"><i data-lucide="link" class="w-3.5 h-3.5"></i> 订阅</button>
                        <div id="linkMenu" class="link-menu absolute top-full left-1/2 w-40 pt-2 z-50">
                            <div class="bg-white dark:bg-slate-800 border rounded-xl p-1 shadow-2xl flex flex-col gap-1">
                                <button onclick="generateLink('CFnew')" class="w-full px-3 py-2 text-[10px] font-bold hover:bg-slate-100 rounded-lg">CFnew 链接</button>
                                <button onclick="generateLink('edgetunnel')" class="w-full px-3 py-2 text-[10px] font-bold hover:bg-slate-100 rounded-lg">edgetunnel 链接</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <textarea id="out" readonly class="w-full h-48 p-6 bg-transparent fira text-[12px] leading-relaxed outline-none resize-none" placeholder="结果显示在这里..."></textarea>
        </div>
    </main>

    <script>
        function showToast(msg, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = \`toast \${type === 'success' ? 'toast-success' : 'toast-error'}\`;
            toast.innerHTML = \`<span>\${msg}</span>\`;
            container.appendChild(toast);
            setTimeout(() => { toast.style.animation = 'fadeOut 0.3s forwards'; setTimeout(() => toast.remove(), 300); }, 3000);
        }

        const regionMap = ${JSON.stringify(REGION_MAP)};
        let selected = []; let allRegions = [];

        async function init() {
            try {
                const res = await fetch('?get_regions=1');
                allRegions = (await res.json()).filter(r => r !== 'CN');
                const grid = document.getElementById('regionGrid');
                grid.innerHTML = allRegions.map(r => \`
                    <button onclick="toggle('\${r}')" id="r-\${r}" class="region-card p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 flex flex-col items-center border">
                        <span class="text-xl">\${getFlag(r)}</span><span class="text-[10px] font-bold opacity-60">\${regionMap[r] || r}</span>
                    </button>\`).join('');
                lucide.createIcons();
            } catch(e) { console.error(e); }
        }

        function getFlag(code) {
            if(code === 'TW') return '🇹🇼';
            return code.toUpperCase().replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397));
        }

        function toggle(r) {
            const el = document.getElementById('r-' + r);
            if(selected.includes(r)) { selected = selected.filter(i => i !== r); el.classList.remove('active'); } 
            else { selected.push(r); el.classList.add('active'); }
        }

        function selectAll() {
            if(selected.length === allRegions.length) { selected = []; document.querySelectorAll('.region-card').forEach(el => el.classList.remove('active')); } 
            else { selected = [...allRegions]; document.querySelectorAll('.region-card').forEach(el => el.classList.add('active')); }
        }

        async function autoRun(type) {
            if(selected.length === 0) return showToast('请选择地区', 'error');
            const limit = document.getElementById('limitInput').value;
            try {
                const res = await fetch(\`/\${type}/\${selected.join('-')}?limit=\${limit}\`);
                const data = await res.text();
                document.getElementById('out').value = data;
                const count = data.trim().split('\\n').length;
                document.getElementById('stats').innerText = \`SUCCESS: \${count} NODES\`;
                showToast(\`成功获取 \${count} 个节点\`);
            } catch(e) { showToast('获取失败', 'error'); }
        }

        function copy() {
            const out = document.getElementById('out');
            if(!out.value) return showToast('没有内容', 'error');
            navigator.clipboard.writeText(out.value);
            showToast('已复制');
        }

        function toggleLinkMenu(e) { e.stopPropagation(); document.getElementById('linkMenu').classList.toggle('open'); }
        function closeAllDropdowns() { document.getElementById('linkMenu').classList.remove('open'); document.getElementById('themeDropdown').classList.remove('open'); }
        function toggleDropdown(e) { e.stopPropagation(); document.getElementById('themeDropdown').classList.toggle('open'); }

        function generateLink(type) {
            if(selected.length === 0) return showToast('请选择地区', 'error');
            const limit = document.getElementById('limitInput').value;
            const url = \`\${window.location.origin}/\${type}/\${selected.join('-')}?limit=\${limit}\`;
            navigator.clipboard.writeText(url);
            showToast('订阅链接已复制');
        }

        function setThemeMode(mode) {
            const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            document.documentElement.classList.toggle('dark', isDark);
            closeAllDropdowns();
        }

        init();
    </script>
</body>
</html>
  `;
}
