export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      const ui = `<!DOCTYPE html>
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
    <input id="u" type="text" placeholder="e.g. google.com or youtube.com" autocomplete="off" spellcheck="false"/>
    <button id="btn">Go</button>
  </div>
  <div id="msg">Enter a URL above and press Go</div>
  <iframe id="frame"></iframe>
  <script>
(function() {
  function navigate() {
    var val = document.getElementById('u').value.trim();
    if (!val) return;
    if (val.indexOf('http') !== 0) val = 'https://' + val;
    document.getElementById('u').value = val;
    document.getElementById('msg').style.display = 'none';
    document.getElementById('frame').style.display = 'block';
    document.getElementById('frame').src = '/?url=' + encodeURIComponent(val);
  }
  document.getElementById('btn').addEventListener('click', navigate);
  document.getElementById('u').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') navigate();
  });
})();
` + '<' + `/script>
</body>
</html>`;
      return new Response(ui, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    let parsedTarget;
    try { parsedTarget = new URL(target); }
    catch(e) { return new Response('Invalid URL: ' + target, { status: 400 }); }

    const targetOrigin = parsedTarget.origin;
    const proxyOrigin = new URL(request.url).origin;

    function rewriteUrl(u) {
      if (!u) return u;
      u = u.trim();
      // Skip empty, anchors, data URIs, mailto, javascript
      if (!u || u.indexOf('#') === 0 || u.indexOf('data:') === 0 || u.indexOf('mailto:') === 0 || u.indexOf('javascript:') === 0) return u;
      if (u.indexOf('http') === 0 && u.indexOf(proxyOrigin) < 0) return proxyOrigin + '/?url=' + encodeURIComponent(u);
      if (u.indexOf('//') === 0) return proxyOrigin + '/?url=' + encodeURIComponent('https:' + u);
      if (u.indexOf('/') === 0) return proxyOrigin + '/?url=' + encodeURIComponent(targetOrigin + u);
      // relative URL - make it absolute through proxy
      if (u.indexOf('http') !== 0 && u.indexOf('/') !== 0 && u.indexOf('.') === 0) {
        var base = target.substring(0, target.lastIndexOf('/') + 1);
        return proxyOrigin + '/?url=' + encodeURIComponent(base + u);
      }
      return u;
    }

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

    // CSS: pass through but rewrite any url() references inside it
    if (ct.includes('text/css') || target.match(/\.css(\?|$)/i)) {
      let css = await res.text();
      css = css.replace(/url\((['"]?)(https?:\/\/[^'")]+)(['"]?)\)/gi, function(_, q1, u, q2) {
        return 'url(' + q1 + proxyOrigin + '/?url=' + encodeURIComponent(u) + q2 + ')';
      });
      css = css.replace(/url\((['"]?)(\/[^'")]+)(['"]?)\)/gi, function(_, q1, u, q2) {
        return 'url(' + q1 + proxyOrigin + '/?url=' + encodeURIComponent(targetOrigin + u) + q2 + ')';
      });
      return new Response(css, {
        status: res.status,
        headers: { 'Content-Type': 'text/css', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // JS files: rewrite absolute URLs inside them
    if (ct.includes('javascript') || target.match(/\.m?js(\?|$)/i)) {
      let js = await res.text();
      js = js.replace(/(["'`])(https?:\/\/[^"'`\s\\]{4,})(["'`])/g, function(_, q1, u, q2) {
        if (u.indexOf(proxyOrigin) >= 0) return q1 + u + q2;
        return q1 + proxyOrigin + '/?url=' + encodeURIComponent(u) + q2;
      });
      return new Response(js, {
        status: res.status,
        headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // All other non-HTML: pass through
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

    // HTML: rewrite
    let html = await res.text();

    html = html
      .replace(/\s+integrity="[^"]*"/gi, '')
      .replace(/\s+integrity='[^']*'/gi, '')
      .replace(/\s+crossorigin(="[^"]*"|='[^']*')?/gi, '')
      .replace(/<meta[^>]+(content-security-policy|x-frame-options)[^>]*\/?>/gi, '')
      // Rewrite src/href/action with double quotes
      .replace(/\b(src|href|action|data-src|data-href)\s*=\s*"([^"]*)"/gi, function(_, attr, val) {
        return attr + '="' + rewriteUrl(val) + '"';
      })
      // Rewrite src/href/action with single quotes
      .replace(/\b(src|href|action|data-src|data-href)\s*=\s*'([^']*)'/gi, function(_, attr, val) {
        return attr + "='" + rewriteUrl(val) + "'";
      })
      // Rewrite srcset
      .replace(/srcset\s*=\s*"([^"]*)"/gi, function(_, val) {
        return 'srcset="' + val.replace(/(https?:\/\/[^\s,]+)/g, function(u) {
          return proxyOrigin + '/?url=' + encodeURIComponent(u);
        }) + '"';
      })
      // Rewrite CSS url() inside style tags and style attributes
      .replace(/url\((['"]?)(\/[^'")]+)(['"]?)\)/gi, function(_, q1, u, q2) {
        return 'url(' + q1 + proxyOrigin + '/?url=' + encodeURIComponent(targetOrigin + u) + q2 + ')';
      })
      .replace(/url\((['"]?)(https?:\/\/[^'")]+)(['"]?)\)/gi, function(_, q1, u, q2) {
        return 'url(' + q1 + proxyOrigin + '/?url=' + encodeURIComponent(u) + q2 + ')';
      });

    // Build injected script
    var injectJs = '(function(){' +
      'var PX="' + proxyOrigin + '/?url=";' +
      'var TO="' + targetOrigin + '";' +
      'function w(u){' +
        'if(!u||typeof u!=="string")return u;' +
        'if(u.indexOf("#")===0||u.indexOf("data:")===0||u.indexOf("blob:")===0)return u;' +
        'if(u.indexOf("http")===0&&u.indexOf("' + proxyOrigin + '")<0)return PX+encodeURIComponent(u);' +
        'if(u.indexOf("//")===0)return PX+encodeURIComponent("https:"+u);' +
        'if(u.indexOf("/")===0&&u.indexOf("/?")<0)return PX+encodeURIComponent(TO+u);' +
        'return u;' +
      '}' +
      'if(window.fetch){var oF=window.fetch;window.fetch=function(i,x){return oF(typeof i==="string"?w(i):i,x);};}' +
      'if(window.XMLHttpRequest){var oX=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oX.apply(this,[m,w(u)].concat([].slice.call(arguments,2)));};}'  +
    '})();';

    var injectedTag = '<' + 'script>' + injectJs + '<' + '/script>';

    if (html.includes('</head>')) {
      html = html.replace('</head>', injectedTag + '</head>');
    } else {
      html = injectedTag + html;
    }

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
