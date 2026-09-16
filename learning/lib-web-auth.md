# lib-web-auth
path: src/auth/webAuth.ts
files: src/auth/webAuth.ts
lines: 66
deps: db-web-sessions
exports: getSessionCookie, setSessionCookie, clearSessionCookie, attachUser, requireWebAuthPage, requireWebAuthApi
does: Cookie-based browser session auth middleware; resolves req.userId from session cookie
roles: all (browser users)
db: web_sessions
links: db-web-sessions, app-auth-routes, app-token-routes, app-routes
