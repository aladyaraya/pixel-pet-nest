// Generated from IDE proto/api/v1/pwa.proto and pkg/pwa. Do not edit.
export const PWA_CONTEXT_FIELDS = ["protocolVersion","projectId","publicAppId","environment","buildId","releaseId","releaseVersion","sourceCommit","configRevision","origin","appBasePath","assetBasePath","name","shortName","iconSource","themeColor","backgroundColor","publicBackend","authMode","requiredCapabilities","expectedLiveRevision"]
export const PWA_BACKEND_FIELDS = ["url","anonKey","projectCode","appEnvironment"]
export const PWA_REPORT_FIELDS = ["protocolVersion","buildId","contextSha256","files","supportedCapabilities"]
export const PWA_FILE_FIELDS = ["path","sha256","size","contentType"]
export const PWA_PROJECT_FIELDS = ["requiredCapabilities"]
export const PWA_CONTEXT_FILENAME = "pwa-build-context.json"
export const PWA_CONTEXT_ENV = "VIBE_PWA_CONTEXT_PATH"
export const PWA_PROTOCOL_VERSION = "1"
export const PWA_ENVIRONMENTS = ["dev","test","staging","prod"]
export const PWA_MIME_TYPES = {".avif":"image/avif",".css":"text/css",".gif":"image/gif",".html":"text/html",".ico":"image/x-icon",".jpeg":"image/jpeg",".jpg":"image/jpeg",".js":"text/javascript",".json":"application/json",".mjs":"text/javascript",".mp3":"audio/mpeg",".mp4":"video/mp4",".otf":"font/otf",".png":"image/png",".svg":"image/svg+xml",".ttf":"font/ttf",".txt":"text/plain",".wasm":"application/wasm",".webmanifest":"application/manifest+json",".webp":"image/webp",".woff":"font/woff",".woff2":"font/woff2"}
export const PWA_CONTEXT_DEFAULTS = {"appBasePath":"","assetBasePath":"","authMode":"auth_mode_unspecified","backgroundColor":"","buildId":"","configRevision":"","environment":"environment_unspecified","expectedLiveRevision":"","iconSource":"","name":"","origin":"","projectId":"","protocolVersion":"","publicAppId":"","publicBackend":null,"releaseId":"","releaseVersion":"","requiredCapabilities":[],"shortName":"","sourceCommit":"","themeColor":""}
export const PWA_BACKEND_DEFAULTS = {"anonKey":"","appEnvironment":"","projectCode":"","url":""}
