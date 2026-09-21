// Fetch wrapper for the backend API. Sessions live in an httpOnly cookie, so no
// token is ever stored in JavaScript.

export class ApiError extends Error {
  constructor(status, body) {
    const err = (body && body.error) || {};
    super(err.message || (status === 0 ? "Cannot reach the server. Check your connection." : `Request failed (${status}).`));
    this.name = "ApiError";
    this.status = status;
    this.code = err.code || "ERROR";
    this.details = err.details || [];
    this.body = body;
  }
}

function redirectToLogin() {
  const next = location.pathname + location.search + location.hash;
  if (!location.pathname.startsWith("/login")) location.href = `/login.html?next=${encodeURIComponent(next)}`;
}

export async function request(method, url, body, { quiet401 = false } = {}) {
  const init = { method, credentials: "same-origin", headers: { "X-Requested-With": "fetch", Accept: "application/json" } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, null);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && !quiet401 && !url.startsWith("/api/auth/")) {
    redirectToLogin();
  }
  if (!res.ok || (data && data.success === false && res.status >= 400)) throw new ApiError(res.status, data);
  return data || {};
}

export const api = {
  get: (url, opts) => request("GET", url, undefined, opts),
  post: (url, body, opts) => request("POST", url, body === undefined ? {} : body, opts),
  put: (url, body, opts) => request("PUT", url, body, opts),
  patch: (url, body, opts) => request("PATCH", url, body, opts),
  del: (url, body, opts) => request("DELETE", url, body, opts),
};

// Upload with progress (fetch has no upload progress events).
export function uploadWithProgress(url, formData, { onProgress, headers = {}, withCredentials = true } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = withCredentials;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else if (data && data.error && typeof data.error.message === "string" && !data.error.code) reject(new ApiError(xhr.status, { error: { message: data.error.message } }));
      else reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, null));
    xhr.send(formData);
  });
}
