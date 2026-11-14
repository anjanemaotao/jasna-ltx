export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const targetUrl = new URL(url.pathname + url.search, 'https://ltx.libray.workers.dev');

    // 2. 构造干净的转发头
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', 'ltx.libray.workers.dev');
    newHeaders.set('Referer', 'https://ltx.libray.workers.dev/');
    newHeaders.set('Origin', 'https://ltx.libray.workers.dev');
    newHeaders.delete('cf-connecting-ip');
    newHeaders.delete('cf-ray');
    newHeaders.delete('cf-visitor');

    try {
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
        redirect: 'follow'
      });

      const resHeaders = new Headers(response.headers);
      resHeaders.set('Access-Control-Allow-Origin', '*');
      resHeaders.delete('content-security-policy');
      resHeaders.delete('content-security-policy-report-only');
      resHeaders.delete('x-frame-options');

      const ct = (resHeaders.get('content-type') || '').toLowerCase();
      if (ct.includes('html') || ct.includes('javascript') || ct.includes('json')) {
        let text = await response.text();
        
        // 动态将原站域名替换为当前自定义镜像域名
        text = text.replaceAll('https://ltx.libray.workers.dev', url.origin);
        text = text.replaceAll('ltx.libray.workers.dev', url.host);

        // 如果是 HTML，注入 no-referrer 确保 JavDB / DMM 封面直接加载
        if (ct.includes('html') && !text.includes('name="referrer"')) {
          text = text.replace('<head>', '<head><meta name="referrer" content="no-referrer">');
        }

        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: resHeaders
        });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders
      });
    } catch (err) {
      return new Response('Proxy Gateway Error: ' + (err.stack || err.message), { status: 502 });
    }
  }
};
