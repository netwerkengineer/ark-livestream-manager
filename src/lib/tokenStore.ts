import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "data", "tokens.json");

export function saveToken(provider: "google", token: string) {
  let tokens: any = {};
  if (fs.existsSync(TOKEN_FILE)) {
    tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  }
  tokens[provider] = token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function getTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  }
  return {};
}
