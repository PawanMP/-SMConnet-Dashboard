// Single HTTP client for every outbound call to social platforms and AI
// providers. Tests replace `client.request` to simulate those services.
const axios = require("axios");

const instance = axios.create({ timeout: 60000, maxRedirects: 5 });

const client = {
  request: (options) => instance.request(options),
  get: (url, options = {}) => client.request({ ...options, method: "get", url }),
  delete: (url, options = {}) => client.request({ ...options, method: "delete", url }),
  post: (url, data, options = {}) => client.request({ ...options, method: "post", url, data }),
  put: (url, data, options = {}) => client.request({ ...options, method: "put", url, data }),
};

// application/x-www-form-urlencoded body helper.
client.form = (fields) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  return params.toString();
};

module.exports = client;
