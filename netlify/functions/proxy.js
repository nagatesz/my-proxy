const https = require('https');
const http = require('http');
const { URL } = require('url');

exports.handler = async (event) => {
  const targetUrl = event.queryStringParameters && event.queryStringParameters.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: 'Missing ?url= parameter',
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid URL' };
  }

  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: event.httpMethod || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    };

    const req = protocol.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || 'text/html';

        // Rewrite links in HTML so they go through the proxy
        if (contentType.includes('text/html')) {
          const base = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
          body = body
            // rewrite absolute hrefs and srcs
            .replace(/(href|src|action)="(https?:\/\/[^"]+)"/gi, (_, attr, url) =>
              `${attr}="/.netlify/functions/proxy?url=${encodeURIComponent(url)}"`)
            // rewrite root-relative hrefs and srcs
            .replace(/(href|src|action)="(\/[^"]+)"/gi, (_, attr, path) =>
              `${attr}="/.netlify/functions/proxy?url=${encodeURIComponent(base + path)}"`)
            // remove CSP and X-Frame-Options meta tags
            .replace(/<meta[^>]*http-equiv=["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi, '');
        }

        resolve({
          statusCode: res.statusCode || 200,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'X-Frame-Options': 'ALLOWALL',
          },
          body,
        });
      });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 500, body: `Proxy error: ${err.message}` });
    });

    req.end();
  });
};
