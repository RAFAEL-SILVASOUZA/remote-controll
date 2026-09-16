# lib-password
path: src/auth/password.ts
files: src/auth/password.ts, src/auth/password.test.ts
lines: 31
deps: node:crypto
exports: hashPassword, verifyPassword
does: scrypt password hashing with 16-byte salt and timingSafeEqual comparison
roles: n/a
db: users
links: app-auth-routes
