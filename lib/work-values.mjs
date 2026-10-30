export function fields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) {
    throw Error(`Invalid ${label}`);
  }
}
export function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) || Object.hasOwn(Object.prototype, value) || value === "prototype") {
    throw Error(`Invalid identifier: ${value}`);
  }
  return value;
}
export function relativePath(value) {
  if (typeof value !== "string" || !value || /[\\\x00-\x1f\x7f]/.test(value) ||
      value.split("/").some((p) => !p || p === "." || p === "..")) {
    throw Error("Expected a safe repository-relative path");
  }
  return value;
}
