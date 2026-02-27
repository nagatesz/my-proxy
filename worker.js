export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Proxy</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { height:100%; }
body { font-family:Arial,sans-serif; background:#1a1a2e; color:#eee; display:flex; flex-direction:column; }
.bar { display:flex; gap:8px; padding:10px 14px; background:#16213e; align-items:center; flex-shrink:0; }
.bar input { flex:1; padding:9px 16px; border-radius:24px; border:none; background:#0f3460; color:#fff; font-size:15px; outline:none; }
.bar button { padding:9px 22px; border-radius:24px; border:none; background:#e94560; color:#fff; font-size:15px; cursor:pointer; }
.bar button:hover { background:#c73652; }
#msg { flex:1; display:flex; align-items:center; justify-content:center; font-size:18px; color:#555; }
#frame { flex:1; border:none; width:100%; display:none; }
</style>
</head>
<body>
  <div class="bar">
    <input id="u" type="text" placeholder="e.g. google.com or https://wikipedia.org" autocomplete="off" spellcheck="false"/>
    <button id="btn">Go</button>
  </div>
  <div id="msg">Enter a URL above and press Go</div>
  <iframe id="frame"></iframe>
  <script>
    function navigate() {
      var val = document.getElementById('u').value.trim();
      if (!val) return;
      if (!/^https?:\/\//i.test(val)) val = 'https://' + val;
      document.getElementById('u').value = val;
      document.getElementById('msg').style.display = 'none';
      document.getElementById('frame').style.display = 'block';
      document.getElementById('frame').src = '/?url=' + encodeURIComponent(val);
    }
    document.getElementById('btn').addEventListener('click', navigate);
    document.getElementById('u').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') navigate();
    });
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    let parsedTarget;
    try { parsedTarget = new URL(target); }
    catch(e) { return new Response('Invalid URL', { status: 400 }); }

    const targetOrigin = parsedTarget.origin;
    const proxyOrigin = new URL(request.url).origin;

    let res;
    try {
      res = await fetch(target, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': targetOrigin + '/',
        },
      });
    } catch(e) {
      return new Response('<html><body style="background:#1a1a2e;color:#e94560;font-family:Arial;padding:40px;text-align:center;"><h2>Failed to fetch</h2><p>' + e.message + '</p><a href="/" style="color:#aaa">Back</a></body></html>', {
        status: 502, headers: { 'Content-Type': 'text/html' }
      });
    }

    const ct = res.headers.get('content-type') || '';

    if (ct.includes('javascript') || /\.m?js(\?|$)/i.test(target)) {
      let js = await res.text();
      js = js.replace(/(["'`])(https?:\/\/[^"'`\s\\]{4,})(["'`])/g, function(_, q1, u, q2) {
        return q1 + proxyOrigin + '/?url=' + encodeURIComponent(u) + q2;
      });
      return new Response(js, {
        status: res.status,
        headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (!ct.includes('text/html')) {
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': ct || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    let html = await res.text();

    function rewriteUrl(u) {
      if (!u) return u;
      u = u.trim();
      if (/^https?:\/\//i.test(u)) return proxyOrigin + '/?url=' + encodeURIComponent(u);
      if (/^\/\//.test(u)) return proxyOrigin + '/?url=' + encodeURIComponent('https:' + u);
      if (/^\//.test(u)) return proxyOrigin + '/?url=' + encodeURIComponent(targetOrigin + u);
      return u;
    }

    html = html
      .replace(/\s+integrity="[^"]*"/gi, '')
      .replace(/\s+integrity='[^']*'/gi, '')
      .replace(/\s+crossorigin(="[^"]*"|='[^']*')?/gi, '')
      .replace(/<meta[^>]+(content-security-policy|x-frame-options)[^>]*\/?>/gi, '')
      .replace(/\b(src|href|action|data-src|data-href)\s*=\s*"([^"]*)"/gi, function(_, attr, val) {
        return attr + '="' + rewriteUrl(val) + '"';
      })
      .replace(/\b(src|href|action|data-src|data-href)\s*=\s*'([^']*)'/gi, function(_, attr, val) {
        return attr + "='" + rewriteUrl(val) + "'";
      })
      .replace(/srcset\s*=\s*"([^"]*)"/gi, function(_, val) {
        return 'srcset="' + val.replace(/(https?:\/\/[^\s,]+)/g, function(u) {
          return proxyOrigin + '/?url=' + encodeURIComponent(u);
        }) + '"';
      })
      .replace(/(<head[^>]*>)/i, '$1\n<base href="' + targetOrigin + '/">');

    var script = '<script>(function(){' +
      'var PX="' + proxyOrigin + '/?url=";' +
      'var TO="' + targetOrigin + '";' +
      'function w(u){' +
        'if(!u||typeof u!=="string")return u;' +
        'if(/^https?:\\/\\//i.test(u)&&u.indexOf("' + proxyOrigin + '")<0)return PX+encodeURIComponent(u);' +
        'if(/^\\/\\//.test(u))return PX+encodeURIComponent("https:"+u);' +
        'if(/^\\/[^/]/.test(u))return PX+encodeURIComponent(TO+u);' +
        'return u;' +
      '}' +
      'var oF=window.fetch;window.fetch=function(i,x){return oF(typeof i==="string"?w(i):i,x);};' +
      'var oX=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oX.apply(this,[m,w(u)].concat([].slice.call(arguments,2)));};' +
    '})();<\/script>';

    html = html.includes('</head>') ? html.replace('</head>', script + '</head>') : script + html;

    return new Response(html, {
      status: res.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
};
