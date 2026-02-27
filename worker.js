export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    const proxyOrigin = reqUrl.origin;

    // HOME UI
    if (!target) {
      return new Response(
        "<!DOCTYPE html><html><head><meta charset='UTF-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/><title>Proxy</title>" +
        "<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}body{font-family:Arial,sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column}" +
        ".bar{display:flex;gap:8px;padding:10px 14px;background:#16213e;align-items:center;flex-shrink:0}" +
        ".bar input{flex:1;padding:9px 16px;border-radius:24px;border:none;background:#0f3460;color:#fff;font-size:15px;outline:none}" +
        ".bar button{padding:9px 22px;border-radius:24px;border:none;background:#e94560;color:#fff;font-size:15px;cursor:pointer}" +
        "#msg{flex:1;display:flex;align-items:center;justify-content:center;font-size:18px;color:#555}" +
        "#frame{flex:1;border:none;width:100%;display:none}</style></head><body>" +
        "<div class='bar'><input id='u' type='text' placeholder='e.g. google.com or wikipedia.org' autocomplete='off'/><button id='btn'>Go</button></div>" +
        "<div id='msg'>Enter a URL above and press Go</div><iframe id='frame'></iframe>" +
        "<script>(function(){" +
        "function go(){var v=document.getElementById('u').value.trim();if(!v)return;" +
        "if(v.indexOf('http')!==0)v='https://'+v;" +
        "document.getElementById('u').value=v;" +
        "document.getElementById('msg').style.display='none';" +
        "document.getElementById('frame').style.display='block';" +
        "document.getElementById('frame').src='/?url='+encodeURIComponent(v);}" +
        "document.getElementById('btn').addEventListener('click',go);" +
        "document.getElementById('u').addEventListener('keydown',function(e){if(e.key==='Enter')go();});" +
        "})();<" + "/script></body></html>",
        { headers: { "Content-Type": "text/html;charset=utf-8" } }
      );
    }

    // Parse and validate target URL
    let parsedTarget;
    try { parsedTarget = new URL(target); }
    catch(e) { return new Response("Invalid URL", { status: 400 }); }

    const targetOrigin = parsedTarget.origin;

    function proxify(u) {
      if (!u || !u.trim()) return u;
      u = u.trim();
      if (u.startsWith("#") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("mailto:") || u.startsWith("javascript:")) return u;
      if (u.startsWith("http://") || u.startsWith("https://")) {
        if (u.startsWith(proxyOrigin)) return u;
        return proxyOrigin + "/?url=" + encodeURIComponent(u);
      }
      if (u.startsWith("//")) return proxyOrigin + "/?url=" + encodeURIComponent("https:" + u);
      if (u.startsWith("/")) return proxyOrigin + "/?url=" + encodeURIComponent(targetOrigin + u);
      // relative path
      const base = target.endsWith("/") ? target : target.substring(0, target.lastIndexOf("/") + 1);
      return proxyOrigin + "/?url=" + encodeURIComponent(base + u);
    }

    // Fetch the target
    let res;
    try {
      res = await fetch(target, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Referer": targetOrigin + "/",
        },
      });
    } catch(e) {
      return new Response("<html><body style='background:#1a1a2e;color:#e94560;font-family:Arial;padding:40px;text-align:center'><h2>Failed to fetch</h2><p>" + e.message + "</p><a href='/' style='color:#aaa'>Back</a></body></html>",
        { status: 502, headers: { "Content-Type": "text/html" } });
    }

    const ct = res.headers.get("content-type") || "";

    // CSS - rewrite url() references
    if (ct.includes("text/css") || /\.css(\?|$)/i.test(target)) {
      let css = await res.text();
      css = css
        .replace(/url\((['"]?)(https?:\/\/[^\'")]+)(['"]?)\)/gi, (_, q1, u, q2) => "url(" + q1 + proxify(u) + q2 + ")")
        .replace(/url\((['"]?)(\/[^\'")]+)(['"]?)\)/gi, (_, q1, u, q2) => "url(" + q1 + proxify(u) + q2 + ")")
        .replace(/@import\s+['"]([^'"]+)['"]/gi, (_, u) => "@import \"" + proxify(u) + "\"");
      return new Response(css, { status: res.status, headers: { "Content-Type": "text/css", "Access-Control-Allow-Origin": "*" } });
    }

    // JavaScript - rewrite string URLs
    if (ct.includes("javascript") || /\.m?js(\?|$)/i.test(target)) {
      let js = await res.text();
      js = js.replace(/(['"\`])(https?:\/\/[^\'"\`\s\\]{4,})(['"\`])/g, (_, q1, u, q2) => {
        if (u.startsWith(proxyOrigin)) return q1 + u + q2;
        return q1 + proxyOrigin + "/?url=" + encodeURIComponent(u) + q2;
      });
      return new Response(js, { status: res.status, headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" } });
    }

    // Non-HTML assets - pass through
    if (!ct.includes("text/html")) {
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*", "Cache-Control": "public,max-age=3600" }
      });
    }

    // HTML - use HTMLRewriter for accurate rewriting
    const injectScript =
      "<script>(function(){" +
      "var PX='" + proxyOrigin + "/?url=';" +
      "var TO='" + targetOrigin + "';" +
      "function w(u){" +
        "if(!u||typeof u!=='string')return u;" +
        "if(u.startsWith('#')||u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('mailto:')||u.startsWith('javascript:'))return u;" +
        "if(u.startsWith('http')&&!u.startsWith('" + proxyOrigin + "'))return PX+encodeURIComponent(u);" +
        "if(u.startsWith('//'))return PX+encodeURIComponent('https:'+u);" +
        "if(u.startsWith('/')&&!u.startsWith('/?'))return PX+encodeURIComponent(TO+u);" +
        "return u;" +
      "}" +
      "if(window.fetch){var oF=window.fetch;window.fetch=function(i,x){return oF(typeof i==='string'?w(i):i,x);};}" +
      "if(window.XMLHttpRequest){var oX=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oX.apply(this,[m,w(u)].concat([].slice.call(arguments,2)));};}" +
      "})();<" + "/script>";

    const rewriter = new HTMLRewriter()
      // Rewrite all src/href/action attributes
      .on("a[href]", { element(el) { el.setAttribute("href", proxify(el.getAttribute("href"))); } })
      .on("link[href]", { element(el) { el.setAttribute("href", proxify(el.getAttribute("href"))); } })
      .on("script[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); el.removeAttribute("integrity"); el.removeAttribute("crossorigin"); } })
      .on("img[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("img[srcset]", { element(el) {
        el.setAttribute("srcset", el.getAttribute("srcset").replace(/(https?:\/\/[^\s,]+)/g, u => proxify(u)));
      }})
      .on("source[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("source[srcset]", { element(el) {
        el.setAttribute("srcset", el.getAttribute("srcset").replace(/(https?:\/\/[^\s,]+)/g, u => proxify(u)));
      }})
      .on("form[action]", { element(el) { el.setAttribute("action", proxify(el.getAttribute("action"))); } })
      .on("iframe[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("video[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("audio[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      // Remove all integrity and CSP attributes/tags
      .on("link[integrity]", { element(el) { el.removeAttribute("integrity"); el.removeAttribute("crossorigin"); } })
      .on("meta[http-equiv='content-security-policy']", { element(el) { el.remove(); } })
      .on("meta[http-equiv='Content-Security-Policy']", { element(el) { el.remove(); } })
      .on("meta[http-equiv='x-frame-options']", { element(el) { el.remove(); } })
      .on("meta[http-equiv='X-Frame-Options']", { element(el) { el.remove(); } })
      // Inject our interception script right after <head>
      .on("head", { element(el) { el.prepend(injectScript, { html: true }); } });

    const transformed = rewriter.transform(res);

    return new Response(transformed.body, {
      status: res.status,
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "X-Frame-Options": "ALLOWALL",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
};
