export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      return new Response(`
        <!DOCTYPE html>
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
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    try {
      const res = await fetch(target, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      });

      let body = await res.text();
      const contentType = res.headers.get('content-type') || 'text/html';

      if (contentType.includes('text/html')) {
        const base = new URL(target);
        const origin = base.origin;

        body = body
          // rewrite absolute URLs
          .replace(/(href|src|action)="(https?:\/\/[^"]+)"/gi, (_, a, u) =>
            `${a}="/?url=${encodeURIComponent(u)}"`)
          // rewrite root-relative URLs
          .replace(/(href|src|action)="(\/[^"\/][^"]+)"/gi, (_, a, p) =>
            `${a}="/?url=${encodeURIComponent(origin + p)}"`)
          // remove CSP and X-Frame-Options meta tags
          .replace(/<meta[^>]*(content-security-policy|x-frame-options)[^>]*>/gi, '');
      }

      return new Response(body, {
        status: res.status,
        headers: {
          'Content-Type': contentType,
          'X-Frame-Options': 'ALLOWALL',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (e) {
      return new Response(`
        <html><body style="background:#1a1a2e;color:#e94560;font-family:Arial;padding:40px;text-align:center;">
          <h2>Error loading page</h2>
          <p>${e.message}</p>
          <a href="/" style="color:#eee;">Go back</a>
        </body></html>
      `, { status: 500, headers: { 'Content-Type': 'text/html' } });
    }
  }
};
