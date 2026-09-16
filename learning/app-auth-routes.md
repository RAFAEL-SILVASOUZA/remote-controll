# app-auth-routes
path: src/web/authRoutes.ts
files: src/web/authRoutes.ts
lines: 89
deps: db-users, db-web-sessions, lib-password, lib-web-auth
exports: createAuthRouter
does: Login/signup/logout routes; serves HTML pages and handles POST /api/auth/* with zod validation
roles: all (browser users)
db: users, web_sessions
links: db-users, db-web-sessions, lib-password, lib-web-auth, comp-login, comp-signup
