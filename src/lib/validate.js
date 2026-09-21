// Request validation built on zod. Failures become a 422 with per-field details.
const { z } = require("zod");
const { validationError } = require("./errors");

const PLATFORMS = ["facebook", "instagram", "youtube", "tiktok", "pinterest"];

function formatIssues(issues) {
  return issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message }));
}

function validate(schema, data) {
  const result = schema.safeParse(data === undefined ? {} : data);
  if (!result.success) {
    const details = formatIssues(result.error.issues);
    const first = details[0];
    const summary = first.field === "(root)" ? first.message : `${first.field}: ${first.message}`;
    throw validationError(details.length > 1 ? `${summary} (and ${details.length - 1} more)` : summary, details);
  }
  return result.data;
}

const body = (schema) => (req, _res, next) => {
  try {
    req.body = validate(schema, req.body);
    next();
  } catch (err) {
    next(err);
  }
};

const query = (schema) => (req, _res, next) => {
  try {
    req.validQuery = validate(schema, req.query);
    next();
  } catch (err) {
    next(err);
  }
};

// ── Reusable field schemas ────────────────────────────────────────────────────

const email = z
  .string({ required_error: "Email is required." })
  .trim()
  .toLowerCase()
  .max(255, "Email is too long.")
  .email("Enter a valid email address.");

const password = z
  .string({ required_error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

const name = z.string().trim().min(1, "Name is required.").max(100, "Name must be at most 100 characters.");

const platform = z.enum(PLATFORMS, { errorMap: () => ({ message: `Platform must be one of: ${PLATFORMS.join(", ")}.` }) });

const id = z.coerce.number().int().positive();

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Must be a valid date and time." });

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

// Schedules must be at least a minute ahead and at most a year out.
function checkScheduleDate(value, ctx, path = []) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return;
  if (t < Date.now() + 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: "Schedule time must be at least 1 minute in the future." });
  } else if (t > Date.now() + 366 * 24 * 3600 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: "Schedule time must be within the next 12 months." });
  }
}

module.exports = {
  z,
  validate,
  body,
  query,
  PLATFORMS,
  schemas: { email, password, name, platform, id, isoDate, pagination },
  checkScheduleDate,
};
