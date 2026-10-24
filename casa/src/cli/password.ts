// Genera l'hash da mettere in CASA_PASSWORD_<PERSONA>.
//   node src/cli/password.ts            chiede la password
//   echo 'password' | node src/cli/password.ts

import { createInterface } from "node:readline/promises";
import { hashPassword } from "../accesso.ts";

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
const password = (await rl.question(process.stdin.isTTY ? "Password: " : "")).trim();
rl.close();
if (password.length < 8) {
  console.error("Serve una password di almeno 8 caratteri.");
  process.exit(1);
}
console.log(hashPassword(password));
