export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    // ── Home UI ──
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
  .bar input {
    flex:1; padding:9px 16px; border-radius:24px; border:none;
    background:#0f3460; color:#fff; font-size:15px; outline:none;
  }
  .bar button {
    padding:9px 22px; border-radius:24px; border:none;
    background:#e94560; color:#fff; font-size:15px; cursor:pointer; white-space:nowrap;
  }
  .bar button:hover { background:#c73652; }
  #msg { flex:1; display:flex; align-items:center; justify-content:center; font-size:18px; color:#555; }
  #frame { flex:1; border:none; width:100%; display:none; }
</style>
</head>
<body>
  <div class="bar">
    <input id="urlInput" type="text" placeholder="e.g. google.com or https://wikipedia.org" autocomplete="off" spellcheck="false"/>
    <button id="goBtn">Go</button>
  </div>
  <div id="msg">Enter a URL above and press Go</div>
  <iframe id="frame" id="frame"></iframe>
  <script>
    var input = document.getElementById('urlInput');
    var frame = document.getElementById('frame');
    var msg   = document.getElementById('msg');

    function go() {
      var raw = input.value.trim();
      if (!raw) return;
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
      input.value = raw;
      msg.style.display = 'none';
      frame.style.display = 'block';
      frame.src = '/?url=' + encodeURIComponent(raw);
    }

    document.getElementById('goBtn').addEventListener('click', go);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') go(); });
  </script>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ── Proxy request ──
    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch(e) {
      return new Response('Invalid URL: ' + target, { status: 400 });
    }

    const targetOrigin = parsedTarget.origin;
    const proxyOrigin  = new URL(request.url).origin;

    let res;
    try {
      res = await fetch(target, {
        redirect: 'follow',
        headers: {
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer':         targetOrigin + '/',
        },
      });
    } catch(e) {
      return new Response(`<html><body style="background:#1a1a2e;color:#e94560;font-family:Arial;padding:40px;text-align:center;">
        <h2>Failed to fetch</h2><p>${e.message}</p>
        <a href="/" style="color:#aaa">← Back</a>
      </body></html>`, { status: 502, headers: { 'Content-Type': 'text/html' } });
    }

    const ct = res.headers.get('content-type') || '';

    // Pass JS through but rewrite absolute URLs inside it
    if (ct.includes('javascript') || /\.m?js(\?|$)/i.test(target)) {
      let js = await res.text();
      js = js.replace(/(["'`])(https?:\/\/[^"'`\s\\]{4,})(["'`])/g, function(_, q1, u, q2) {
        return q1 + proxyOrigin + '/?url=' + encodeURIComponent(u) + q2;
      });
      return new Response(js, {
        status: res.status,
        headers: {
          'Content-Type': 'application/javascript',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Pass CSS + all other non-HTML assets straight through
    if (!ct.includes('text/html')) {
      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': ct || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        }
      });
    }

    // ── HTML rewriting ──
    let html = await res.text();

    // Helper to rewrite a URL to go through proxy
    function p(u) {
      return proxyOrigin + '/?url=' + encodeURIComponent(u);
    }
    function pAbs(u) {
      if (!u) return u;
      if (/^https?:\/\//i.test(u)) return p(u);
      if (/^\/\//.test(u))          return p('https:' + u);
      if (/^\//.test(u))            return p(targetOrigin + u);
      return u; // relative — leave for <base> to handle
    }

    html = html
      // Kill SRI so scripts/styles aren't blocked after URL rewrite
      .replace(/\s+integrity="[^"]*"/gi, '')
      .replace(/\s+integrity='[^']*'/gi, '')
      // Kill crossorigin
      .replace(/\s+crossorigin(="[^"]*"|='[^']*')?/gi, '')
      // Kill CSP / X-Frame meta tags
      .replace(/<meta[^>]+(content-security-policy|x-frame-options)[^>]*\/?>/gi, '')
      // Rewrite src="..." href="..." action="..."
      .replace(/(\bsrc|\bhref|\baction|\bdata-src|\bdata-href)(\s*=\s*)(["'])(.*?)\3/gi, function(_, attr, eq, q, val) {
        return attr + eq + q + pAbs(val.trim()) + q;
      })
      // Rewrite srcset
      .replace(/\bsrcset(\s*=\s*)(["'])(.*?)\2/gi, function(_, eq, q, val) {
        var rewritten = val.replace(/(https?:\/\/[^\s,]+)/g, function(u) { return p(u); });
        return 'srcset' + eq + q + rewritten + q;
      })
      // Add <base> so any remaining relative URLs resolve correctly
      .replace(/(<head[^>]*>)/i, '$1\n  <base href="' + targetOrigin + '/">');

    // Interception script injected before </head>
    var injected = `<script>
(function(){
  var PX = ${JSON.stringify(proxyOrigin + '/?url=')};
  var TO = ${JSON.stringify(targetOrigin)};
  function w(u){
    if(!u||typeof u!=='string') return u;
    if(/^https?:\\/\\//i.test(u) && u.indexOf(${JSON.stringify(proxyOrigin)})<0) return PX+encodeURIComponent(u);
    if(/^\\/\\//.test(u)) return PX+encodeURIComponent('https:'+u);
    if(/^\\//.test(u)) return PX+encodeURIComponent(TO+u);
    return u;
  }
  var oFetch=window.fetch;
  window.fetch=function(input,init){return oFetch(typeof input==='string'?w(input):input,init);};
  var oOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){return oOpen.apply(this,[m,w(u)].concat(Array.prototype.slice.call(arguments,2)));};
  var oWinOpen=window.open;
  window.open=function(u){return oWinOpen(w(u));};
})();
<\/script>`;

    html = html.includes('</head>') ? html.replace('</head>', injected + '</head>') : injected + html;

    return new Response(html, {
      status: res.status,
      headers: {
        'Content-Type':            'text/html; charset=utf-8',
        'X-Frame-Options':         'ALLOWALL',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
};
