import argon2 from 'argon2'

// OWASP-recommended minimum Argon2id parameters (2023 cheat sheet).
// Parameters are embedded in the resulting hash string, so verify() does not
// need them passed separately and old hashes stay verifiable if these change.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainPassword)
  } catch {
    // Malformed/foreign hash format, etc. Treat as "does not match" rather than throwing.
    return false
  }
}
