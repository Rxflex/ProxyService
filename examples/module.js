const PROXY_URL = "http://localhost:8888";

async function request({
    method = "GET",
    route,
    params,
    body = null
}) {
    const u = new URL(route, PROXY_URL);
    if(params) {
        params.forEach(param => {
            u.searchParams.set(param.name, param.value);
        })
    }

    const headers = {};
    if (body) {
        headers["Content-Type"] = "application/json";
    }

    console.debug(`[ProxyService] ${method} ${u.toString()} | Body -> ${JSON.stringify(body)} | Headers -> ${JSON.stringify(headers)}`)
    const r = await fetch(u, {
        method,
        body: body ? JSON.stringify(body) : null,
        headers
    });

    try {
        return await r.json();
    } catch(e) {
        throw(e);
    }
}

export async function getProxy(email) {
    const r = await request({
        route: `api/proxy/${email}`
    })

    if(r.error==="No proxy found for this email") {
        console.debug(`[ProxyService] Rotating proxy due no proxy for ${email}`, r)
        return await rotateProxy(email, "Getting the first proxy for the model");
    } else {
        return r;
    }
}

export async function rotateProxy(email, reason) {
    console.debug(`[ProxyService] Rotating proxy for ${email}`)
    const r = await request({
        route: `api/proxy/${email}/rotate`,
        method: 'POST',
        body: {
            reason
        }
    });

    return r.proxy;
}