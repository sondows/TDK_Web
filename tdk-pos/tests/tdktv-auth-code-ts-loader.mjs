import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function resolveSpecifier(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  let target = resolve(process.cwd(), "src", specifier.slice(2));
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = resolve(target, "index.ts");
  } catch {
    if (!/\.[cm]?tsx?$/.test(target)) target += ".ts";
  }
  return { url: pathToFileURL(target).href, shortCircuit: true };
}

export { resolveSpecifier as resolve };
