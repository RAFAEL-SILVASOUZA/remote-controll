# db-users
path: src/db/users.ts
files: src/db/users.ts, src/db/users.test.ts
lines: 71
deps: node:sqlite
exports: User, EmailAlreadyRegisteredError, createUser, findUserByEmail, findUserById
does: CRUD for users table; email uniqueness enforced via UNIQUE constraint
roles: none
db: users
links: db-index, app-auth-routes
