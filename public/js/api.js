async function api(method, path, body) {
    var opts = { method: method, credentials: 'include' };
    if (body instanceof FormData) {
        opts.body = body;
    } else if (body != null) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    var r = await fetch('/api' + path, opts);
    var text = await r.text();
    var data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (e) {
        data = { _raw: text };
    }
    if (!r.ok) {
        var msg = (data && data.error) ? data.error : (r.statusText || 'Erro na requisição');
        var err = new Error(msg);
        err.status = r.status;
        err.data = data;
        throw err;
    }
    return data;
}
