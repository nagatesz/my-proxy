export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const proxyOrigin = reqUrl.origin;

    // Get the FULL target including any extra query params after &
    // e.g. /?url=https://foo.com/path&otherParam=1 should fetch https://foo.com/path&otherParam=1
    const rawSearch = reqUrl.search; // e.g. ?url=https%3A%2F%2F...&hasCsp=true&href=...
    let target = null;
    if (rawSearch.startsWith('?url=')) {
      // Everything after ?url= is the target (including any & params that belong to the target)
      target = decodeURIComponent(rawSearch.slice(5));
    }

    // HOME UI
    if (!target) {
      const html = [
        "<!DOCTYPE html><html><head>",
        "<meta charset='UTF-8'/>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'/>",
        "<title>Proxy</title>",
        "<style>",
        "*{margin:0;padding:0;box-sizing:border-box}",
        "html,body{height:100%}",
        "body{font-family:Arial,sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column}",
        ".bar{display:flex;gap:8px;padding:10px 14px;background:#16213e;align-items:center;flex-shrink:0}",
        ".bar input{flex:1;padding:9px 16px;border-radius:24px;border:none;background:#0f3460;color:#fff;font-size:15px;outline:none}",
        ".bar button{padding:9px 22px;border-radius:24px;border:none;background:#e94560;color:#fff;font-size:15px;cursor:pointer}",
        ".bar button:hover{background:#c73652}",
        "#msg{flex:1;display:flex;align-items:center;justify-content:center;font-size:18px;color:#555}",
        "#frame{flex:1;border:none;width:100%;display:none}",
        "</style></head><body>",
        "<div class='bar'>",
        "<input id='u' type='text' placeholder='e.g. google.com or crazygames.com' autocomplete='off'/>",
        "<button id='btn'>Go</button>",
        "</div>",
        "<div id='msg'>Enter a URL above and press Go</div>",
        "<iframe id='frame'></iframe>",
        "<script>",
        "(function(){",
        "function go(){",
        "var v=document.getElementById('u').value.trim();",
        "if(!v)return;",
        "if(v.indexOf('http')!==0)v='https://'+v;",
        "document.getElementById('u').value=v;",
        "document.getElementById('msg').style.display='none';",
        "document.getElementById('frame').style.display='block';",
        "document.getElementById('frame').src='/?url='+encodeURIComponent(v);",
        "}",
        "document.getElementById('btn').addEventListener('click',go);",
        "document.getElementById('u').addEventListener('keydown',function(e){if(e.key==='Enter')go();});",
        "})();",
        "<" + "/script>",
        "</body></html>"
      ].join("");
      return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // Validate URL
    let parsedTarget;
    try { parsedTarget = new URL(target); }
    catch(e) { return new Response("Invalid URL: " + target, { status: 400 }); }

    const targetOrigin = parsedTarget.origin;

    // Convert any URL to a proxied URL - always use encodeURIComponent so & in URLs stay intact
    function proxify(u) {
      if (!u) return u;
      u = u.trim();
      if (!u) return u;
      if (u.startsWith("#") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("mailto:") || u.startsWith("javascript:")) return u;
      if (u.startsWith(proxyOrigin)) return u;
      if (u.startsWith("http://") || u.startsWith("https://")) {
        return proxyOrigin + "/?url=" + encodeURIComponent(u);
      }
      if (u.startsWith("//")) {
        return proxyOrigin + "/?url=" + encodeURIComponent("https:" + u);
      }
      if (u.startsWith("/")) {
        return proxyOrigin + "/?url=" + encodeURIComponent(targetOrigin + u);
      }
      // relative path
      const base = target.includes("?")
        ? target.substring(0, target.lastIndexOf("/") + 1)
        : (target.endsWith("/") ? target : target.substring(0, target.lastIndexOf("/") + 1));
      return proxyOrigin + "/?url=" + encodeURIComponent(base + u);
    }

    // Fetch target
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
      return new Response(
        "<html><body style='background:#1a1a2e;color:#e94560;font-family:Arial;padding:40px;text-align:center'>" +
        "<h2>Failed to fetch</h2><p>" + e.message + "</p><a href='/' style='color:#aaa'>Back</a></body></html>",
        { status: 502, headers: { "Content-Type": "text/html" } }
      );
    }

    const ct = res.headers.get("content-type") || "";

    // CSS
    if (ct.includes("text/css") || /\.css(\?|$)/i.test(target)) {
      let css = await res.text();
      css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function(match, quote, u) {
        if (!u || u.startsWith("data:")) return match;
        return "url(" + quote + proxify(u) + quote + ")";
      });
      css = css.replace(/@import\s+['"]([^'"]+)['"]/gi, function(_, u) {
        return "@import \"" + proxify(u) + "\"";
      });
      return new Response(css, {
        status: res.status,
        headers: { "Content-Type": "text/css", "Access-Control-Allow-Origin": "*" }
      });
    }

    // JavaScript
    if (ct.includes("javascript") || /\.m?js(\?|$)/i.test(target)) {
      let js = await res.text();
      js = js.replace(/(['"])(https?:\/\/[^\'",\s\\]{5,})(['"])/g, function(_, q1, u, q2) {
        if (u.startsWith(proxyOrigin)) return q1 + u + q2;
        return q1 + proxyOrigin + "/?url=" + encodeURIComponent(u) + q2;
      });
      return new Response(js, {
        status: res.status,
        headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Non-HTML assets
    if (!ct.includes("text/html")) {
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": ct,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public,max-age=3600",
        }
      });
    }

    // HTML - HTMLRewriter + runtime script
    const runtimeScript =
      "<script>" +
      "(function(){" +
      "var PX='" + proxyOrigin + "/?url=';" +
      "var TO='" + targetOrigin + "';" +
      // Spoof location so sites don't crash on hostname checks
      "try{" +
        "Object.defineProperty(window,'location',{" +
          "get:function(){" +
            "var loc=Object.create(location);" +
            "Object.defineProperty(loc,'hostname',{get:function(){return '" + parsedTarget.hostname + "';}});" +
            "Object.defineProperty(loc,'host',{get:function(){return '" + parsedTarget.host + "';}});" +
            "Object.defineProperty(loc,'origin',{get:function(){return '" + targetOrigin + "';}});" +
            "Object.defineProperty(loc,'href',{get:function(){return '" + target.replace("'","\'") + "';}});" +
            "return loc;" +
          "}" +
        "});" +
      "}catch(e){}" +
      "function w(u){" +
        "if(!u||typeof u!=='string')return u;" +
        "u=u.trim();" +
        "if(u.startsWith('#')||u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('mailto:')||u.startsWith('javascript:'))return u;" +
        "if(u.startsWith('" + proxyOrigin + "'))return u;" +
        "if(u.startsWith('http://') || u.startsWith('https://'))return PX+encodeURIComponent(u);" +
        "if(u.startsWith('//'))return PX+encodeURIComponent('https:'+u);" +
        "if(u.startsWith('/'))return PX+encodeURIComponent(TO+u);" +
        "return u;" +
      "}" +
      "if(window.fetch){" +
        "var oF=window.fetch;" +
        "window.fetch=function(input,init){return oF(typeof input==='string'?w(input):input,init);};" +
      "}" +
      "if(window.XMLHttpRequest){" +
        "var oX=XMLHttpRequest.prototype.open;" +
        "XMLHttpRequest.prototype.open=function(method,url){return oX.apply(this,[method,w(url)].concat([].slice.call(arguments,2)));};" +
      "}" +
      "})();" +
      "<" + "/script>";

    const rewriter = new HTMLRewriter()
      .on("head", { element(el) { el.prepend(runtimeScript, { html: true }); } })
      .on("meta[http-equiv]", {
        element(el) {
          const v = (el.getAttribute("http-equiv") || "").toLowerCase();
          if (v === "content-security-policy" || v === "x-frame-options") el.remove();
        }
      })
      .on("a[href]", { element(el) { el.setAttribute("href", proxify(el.getAttribute("href"))); } })
      .on("link[href]", {
        element(el) {
          el.setAttribute("href", proxify(el.getAttribute("href")));
          el.removeAttribute("integrity");
          el.removeAttribute("crossorigin");
        }
      })
      .on("script[src]", {
        element(el) {
          el.setAttribute("src", proxify(el.getAttribute("src")));
          el.removeAttribute("integrity");
          el.removeAttribute("crossorigin");
        }
      })
      .on("img", {
        element(el) {
          if (el.getAttribute("src")) el.setAttribute("src", proxify(el.getAttribute("src")));
          if (el.getAttribute("srcset")) {
            el.setAttribute("srcset",
              el.getAttribute("srcset").replace(/(https?:\/\/[^\s,]+|\/\/[^\s,]+)/g, function(u) { return proxify(u); })
            );
          }
        }
      })
      .on("source", {
        element(el) {
          if (el.getAttribute("src")) el.setAttribute("src", proxify(el.getAttribute("src")));
          if (el.getAttribute("srcset")) {
            el.setAttribute("srcset",
              el.getAttribute("srcset").replace(/(https?:\/\/[^\s,]+)/g, function(u) { return proxify(u); })
            );
          }
        }
      })
      .on("iframe[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("form[action]", { element(el) { if(el.getAttribute("action")) el.setAttribute("action", proxify(el.getAttribute("action"))); } })
      .on("video[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("audio[src]", { element(el) { el.setAttribute("src", proxify(el.getAttribute("src"))); } })
      .on("[style]", {
        element(el) {
          const style = el.getAttribute("style");
          if (style && style.includes("url(")) {
            el.setAttribute("style", style.replace(/url\((['"]?)(.*?)\1\)/gi, function(match, q, u) {
              if (!u || u.startsWith("data:")) return match;
              return "url(" + q + proxify(u) + q + ")";
            }));
          }
        }
      });

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
