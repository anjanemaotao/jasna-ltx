export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const targetUrl = new URL(url.pathname + url.search, 'https://ltx.libray.workers.dev');

    const reqHeaders = new Headers(request.headers);
    reqHeaders.delete('host');
    reqHeaders.delete('cf-connecting-ip');
    reqHeaders.delete('cf-ray');
    reqHeaders.delete('cf-ipcountry');
    reqHeaders.delete('cf-visitor');
    reqHeaders.set('Referer', 'https://ltx.libray.workers.dev/');

    try {
      const resp = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: reqHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow'
      });

      const respHeaders = new Headers(resp.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');

      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('html') || ct.includes('javascript')) {
        let text = await resp.text();
        text = text.replaceAll('https://ltx.libray.workers.dev', url.origin);
        return new Response(text, {
          status: resp.status,
          statusText: resp.statusText,
          headers: respHeaders
        });
      }

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders
      });
    } catch (e) {
      return new Response('Proxy Error: ' + e.message, { status: 502 });
    }
  }
};
