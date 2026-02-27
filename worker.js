export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      return new Response(`<!DOCTYPE html>
<html>
<head><title>Proxy</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#1a1a2e; color:#eee; font-family:Arial,sans-serif; display:flex; flex-direction:column; height:100vh; }
  .bar { display:flex; gap:8px; padding:10px; background:#16213e; align-items:center; }
  input { flex:1; padding:8px 14px; border-radius:20px; border:none; background:#0f3460; color:#fff; font-size:15px; outline:none; }
  button { padding:8px 20px; border-radius:20px; border:none; background:#e94560; color:#fff; font-size:15px; cursor:pointer; }
  button:hover { background:#c73652; }
  iframe { flex:1; border:none; background:#fff; }
  .msg { display:flex; align-items:center; justify-content:center; flex:1; font-size:18px; color:#888; }
</style>
</head>
<body>
  <div class="bar">
    <input id="url" type="text" placeholder="e.g. youtube.com or google.com" />
    <button onclick="load()">Go</button>
  </div>
  <div class="msg" id="msg">Enter any URL above and press Go</div>
  <iframe id="frame" style="display:none" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  <script>
    document.getElementById('url').addEventListener('keydown', e => { if(e.key==='Enter') load(); });
    function load() {
      let u = document.getElementById('url').value.trim();
      if (!u) return;
      // Auto add https:// if missing
      if (!u.match(/^https?:\/\//i)) u = 'https://' + u;
      document.getElementById('url').value = u;
      document.getElementById('msg').style.display = 'none';
      document.getElementById('frame').style.display = 'block';
      document.getElementById('frame').src = '/?url=' + encodeURIComponent(u);
    }
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
    }

    try {
      const parsedTarget = new URL(target);
      const origin = parsedTarget.origin;
      const proxyBase = new URL(request.url).origin;

      const res = await fetch(target, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'identity',
          'Referer': origin,
          'Origin': origin,
        },
        redirect: 'follow',
      });

      const contentType = res.headers.get('content-type') || '';

      // ── JavaScript: rewrite URLs inside JS files ──
      if (contentType.includes('javascript') || target.match(/\.m?js(\?|$)/i)) {
        let js = await res.text();
        // Rewrite fetch/XHR calls to absolute URLs inside JS
        js = js.replace(/(["'`])(https?:\/\/[^"'`\s]+)(["'`])/g, (_, q1, u, q2) =>
          `${q1}${proxyBase}/?url=${encodeURIComponent(u)}${q2}`);
        return new Response(js, {
          status: res.status,
          headers: {
            'Content-Type': contentType || 'application/javascript',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── Non-HTML assets: pass through directly ──
      if (!contentType.includes('text/html')) {
        return new Response(res.body, {
          status: res.status,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      // ── HTML: rewrite and inject interception script ──
      let body = await res.text();

      body = body
        // Strip SRI integrity checks
        .replace(/\s+integrity="[^"]*"/gi, '')
        .replace(/\s+integrity='[^']*'/gi, '')
        // Strip crossorigin
        .replace(/\s+crossorigin(="[^"]*")?/gi, '')
        // Strip CSP and X-Frame meta tags
        .replace(/<meta[^>]*(content-security-policy|x-frame-options)[^>]*>/gi, '')
        // Rewrite absolute URLs
        .replace(/(href|src|action|data-src|data-href)="(https?:\/\/[^"]+)"/gi, (_, a, u) =>
          `${a}="/?url=${encodeURIComponent(u)}"`)
        // Rewrite protocol-relative URLs
        .replace(/(href|src|action|data-src)="(\/\/[^"]+)"/gi, (_, a, u) =>
          `${a}="/?url=${encodeURIComponent('https:' + u)}"`)
        // Rewrite root-relative URLs
        .replace(/(href|src|action|data-src)="(\/[^"]*?)"/gi, (_, a, p) =>
          `${a}="/?url=${encodeURIComponent(origin + p)}"`)
        // Rewrite srcset
        .replace(/srcset="([^"]+)"/gi, (_, srcset) =>
          `srcset="${srcset.replace(/(https?:\/\/[^\s,]+)/g, u => `/?url=${encodeURIComponent(u)}`)}"`)
        // Add <base> tag so relative URLs resolve to proxy
        .replace(/<head([^>]*)>/i, `<head$1><base href="/?url=${encodeURIComponent(origin)}/">`);

      // Inject fetch + XHR + pushState interceptor
      const injected = `<script>
(function() {
  const PROXY = '${proxyBase}/?url=';
  const ORIGIN = '${proxyBase}';
  function wrap(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.startsWith('/') && !u.startsWith('//')) return PROXY + encodeURIComponent('${origin}' + u);
    if (u.startsWith('//')) return PROXY + encodeURIComponent('https:' + u);
    if (u.startsWith('http') && !u.startsWith(ORIGIN)) return PROXY + encodeURIComponent(u);
    return u;
  }
  // Intercept fetch
  const _fetch = window.fetch;
  window.fetch = (input, init) => _fetch(typeof input === 'string' ? wrap(input) : input, init);
  // Intercept XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { return _open.call(this, m, wrap(u), ...r); };
  // Intercept window.open
  const _open2 = window.open;
  window.open = (u, ...r) => _open2(wrap(u), ...r);
})();
<\/script>`;

      body = body.includes('</head>') ? body.replace('</head>', injected + '</head>') : injected + body;

      return new Response(body, {
        status: res.status,
        headers: {
          'Content-Type': 'text/html',
          'X-Frame-Options': 'ALLOWALL',
          'Access-Control-Allow-Origin': '*',
        },
      });

    } catch (e) {
      return new Response(`<html><body style="background:#1a1a2e;color:#e94560;font-family:Arial;padding:40px;text-align:center;">
        <h2>Could not load page</h2><p>${e.message}</p>
        <a href="/" style="color:#eee;display:block;margin-top:20px;">← Go back</a>
      </body></html>`, { status: 500, headers: { 'Content-Type': 'text/html' } });
    }
  }
};
