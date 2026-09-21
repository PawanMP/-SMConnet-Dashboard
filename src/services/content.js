// Resolves the text each platform receives: the post's shared fields,
// overridden by any platform-specific edits.
const db = require("../db");
const { joinText, normalizeHashtags, tagList, firstLine } = require("./platforms/common");

function resolve(post, platform) {
  const overrides = db.json(post.platform_content, {})[platform] || {};
  const pick = (key) => {
    const v = overrides[key];
    return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : String(post[key] || "").trim();
  };
  const caption = pick("caption");
  const hashtags = normalizeHashtags(pick("hashtags"));
  const title = pick("title");
  const description = pick("description");
  const link = String(overrides.link || "").trim();

  const base = { platform, caption, hashtags, title, description, link, tags: tagList(hashtags), text: "" };
  switch (platform) {
    case "facebook":
    case "instagram":
      return { ...base, text: joinText(caption, hashtags) };
    case "tiktok":
      return { ...base, text: joinText(caption, hashtags, " ") };
    case "youtube":
      return {
        ...base,
        title: title || firstLine(caption) || "New video",
        description: joinText(description || caption, hashtags),
        text: joinText(description || caption, hashtags),
      };
    case "pinterest":
      return {
        ...base,
        title: title || firstLine(caption),
        description: joinText(description || caption, hashtags),
        text: joinText(description || caption, hashtags),
      };
    default:
      return { ...base, text: joinText(caption, hashtags) };
  }
}

module.exports = { resolve };
