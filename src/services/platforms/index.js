// Registry of platform adapters. Tests may swap an adapter with `override`.
const { PLATFORMS } = require("../../lib/validate");
const { badRequest } = require("../../lib/errors");

const adapters = {
  facebook: require("./facebook"),
  instagram: require("./instagram"),
  youtube: require("./youtube"),
  tiktok: require("./tiktok"),
  pinterest: require("./pinterest"),
};
const originals = { ...adapters };

function get(platform) {
  const adapter = adapters[platform];
  if (!adapter) throw badRequest(`Unsupported platform "${platform}".`);
  return adapter;
}

function override(platform, partial) {
  adapters[platform] = { ...originals[platform], ...partial };
}

function reset() {
  Object.assign(adapters, originals);
}

module.exports = { get, list: () => PLATFORMS.map((p) => adapters[p]), override, reset, PLATFORMS };
