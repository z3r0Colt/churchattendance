import { readFileSync, writeFileSync } from "node:fs";
const files = ["firestore.rules", "firestore.indexes.json", "storage.rules", "firebase.json"];
const release = process.env.CHURCH_RELEASE || "unreleased-local-build";
writeFileSync("functions/recovery-config.json", JSON.stringify({ version: 1, release, files: Object.fromEntries(files.map((file) => [file, readFileSync(file, "utf8")])) }));
