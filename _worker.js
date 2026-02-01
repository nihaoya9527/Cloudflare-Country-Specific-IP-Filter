/**
 * =================================================
 * 访问密码配置
 * =================================================
 */
const WORKER_PASSWORD = '';     /*Workers部署时在这设置密码*/
const PASSWORD_ENV_KEY = 'ACCESS_PASSWORD';
const COOKIE_NAME = 'Cloudflare_Country_Specific_IP_Filter_AUTH';

/**
 * =================================================
 * 国家映射 & 工具
 * =================================================
 */
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

function getFlagEmoji(code) {
    if (!code || code.length !== 2) return '🇺🇳';
    return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt()));
}

function toSuperScript(num) {
    const map = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
    return num.toString().split('').map(n => map[n]).join('');
}

/**
 * =================================================
 * 登录相关
 * =================================================
 */
function getPassword(env) {
    return env?.[PASSWORD_ENV_KEY] || WORKER_PASSWORD;
}

function passwordConfigured(env) {
    return !!getPassword(env);
}

function isLoggedIn(request, env) {
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    return m && m[1] === btoa(getPassword(env));
}

function redirect(loc) {
    return new Response(null, { status: 302, headers: { Location: loc } });
}

/**
 * =================================================
 * 页面
 * =================================================
 */
function loginPage(error=false) {
return new Response(`<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录</title>
<style>
body{margin:0;background:#020617;color:#e5e7eb;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh}
.box{width:360px;padding:32px;border:1px solid #334155;border-radius:16px}
input,button{width:100%;padding:12px;border-radius:8px;font-size:16px}
input{background:#020617;border:1px solid #334155;color:#fff}
button{margin-top:16px;border:none;background:#2563eb;color:#fff}
.err{color:#f87171;margin-top:12px}
</style></head>
<body>
<div class="box">
<h2>🔐 访问验证 🔐</h2>
<form method="POST">
<input type="password" name="password" placeholder="请输入访问密码" required autofocus>
<button type="submit">进入</button>
${error ? '<div class="err">密码错误</div>' : ''}
</form>
</div>
</body></html>`, {headers:{'content-type':'text/html;charset=UTF-8'}});
}

/**
 * =================================================
 * 主入口
 * =================================================
 */
export default {
async fetch(request, env) {

    if (!passwordConfigured(env)) {
        return new Response('ACCESS_PASSWORD 未设置', { status: 500 });
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

    if (!isLoggedIn(request, env)) {
        return redirect('/login');
    }

    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
    const m = path.match(/^\/(CFnew|edgetunnel)\/(.+)$/);
    if (m) {
        return handleSubscribe(m[2], url.searchParams.get('limit'));
    }

    return new Response('OK', { headers:{'content-type':'text/plain'} });
}
};

/**
 * =================================================
 * 订阅生成（统一格式）
 * =================================================
 */
async function handleSubscribe(regionStr, limit) {
    const regions = regionStr.split(/[,-]/).map(r => r.toUpperCase());
    const res = await fetch('https://zip.cm.edu.kg/all.txt');
    const text = await res.text();

    const lines = text.split('\n');
    const counters = {};
    const limits = {};
    const out = [];

    for (const line of lines) {
        if (!line.includes('#')) continue;
        const [ip, code] = line.trim().split('#');
        if (!regions.includes(code)) continue;

        if (limit) {
            limits[code] = (limits[code] || 0) + 1;
            if (limits[code] > limit) continue;
        }

        counters[code] = (counters[code] || 0) + 1;
        const name = REGION_MAP[code] || code;
        const node = `${ip}#${getFlagEmoji(code)} ${name}${toSuperScript(counters[code])}`;
        out.push(node);
    }

    return new Response(out.join('\n'), {
        headers:{'content-type':'text/plain; charset=UTF-8'}
    });
}
