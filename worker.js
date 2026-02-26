export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    // Serve the UI if no target URL
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
    <input id="url" type="text" placeholder="Enter a URL e.g. https://example.com" />
    <button onclick="load()">Go</button>
  </div>
  <div class="msg" id="msg">Enter a URL above and press Go</div>
  <iframe id="frame" style="display:none"></iframe>
  <script>
    document.getElementById('url').addEventListener('keydown', e => { if(e.key==='Enter') load(); });
    function load() {
      let u = document.getElementById('url').value.trim();
      if (!u) return;
      if (!u.startsWith('http')) u = 'https://' + u;
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
      const res = await fetch(target, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': new URL(target).origin,
        },
        redirect: 'follow',
      });

      const contentType = res.headers.get('content-type') || 'text/html';
      const isHTML = contentType.includes('text/html');

      // For non-HTML assets (JS, CSS, images, fonts etc), pass straight through
      if (!isHTML) {
        return new Response(res.body, {
          status: res.status,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      // For HTML, rewrite URLs and strip security headers
      let body = await res.text();
      const base = new URL(target);
      const origin = base.origin;

      body = body
        // Remove integrity (SRI) attributes so scripts/styles aren't blocked
        .replace(/\s+integrity="[^"]*"/gi, '')
        .replace(/\s+integrity='[^']*'/gi, '')
        // Remove crossorigin attributes
        .replace(/\s+crossorigin(="[^"]*")?/gi, '')
        // Remove CSP and X-Frame-Options meta tags
        .replace(/<meta[^>]*(content-security-policy|x-frame-options)[^>]*>/gi, '')
        // Rewrite absolute URLs in href/src/action/data-src
        .replace(/(href|src|action|data-src)="(https?:\/\/[^"]+)"/gi, (_, a, u) =>
          `${a}="/?url=${encodeURIComponent(u)}"`)
        // Rewrite root-relative URLs
        .replace(/(href|src|action|data-src)="(\/[^"\/][^"]*)"/gi, (_, a, p) =>
          `${a}="/?url=${encodeURIComponent(origin + p)}"`)
        // Rewrite srcset attributes
        .replace(/srcset="([^"]+)"/gi, (_, srcset) => {
          const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, u =>
            `/?url=${encodeURIComponent(u)}`);
          return `srcset="${rewritten}"`;
        });

      // Inject fetch override to catch dynamic API calls
      const script = `<script>
        const _fetch = window.fetch;
        window.fetch = function(input, init) {
          if (typeof input === 'string' && input.startsWith('http') && !input.includes(location.hostname)) {
            input = '/?url=' + encodeURIComponent(input);
          }
          return _fetch(input, init);
        };
        const _XHR = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          if (typeof url === 'string' && url.startsWith('http') && !url.includes(location.hostname)) {
            url = '/?url=' + encodeURIComponent(url);
          }
          return _XHR.call(this, method, url, ...rest);
        };
      <\/script>`;

      // Insert script right before </head>
      body = body.includes('</head>') ? body.replace('</head>', script + '</head>') : script + body;

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
        <h2>Error loading page</h2><p>${e.message}</p>
        <a href="/" style="color:#eee;">Go back</a>
      </body></html>`, { status: 500, headers: { 'Content-Type': 'text/html' } });
    }
  }
};
