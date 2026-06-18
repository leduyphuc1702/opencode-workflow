import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import * as fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"

// Load the bundled compose skills from the `.bundle/` directory ON DISK.
//
// The skills MUST stay on disk (read via fs at runtime), never inlined into a
// .ts/.js module: a ~350KB data literal in the program tips the whole-program
// type-checker (tsgo) over its complexity ceiling, surfacing spurious errors in
// the llm package. So this module reads from one of two on-disk locations:
//   1. <process.resourcesPath>/compose-bundle — the packaged desktop app, where
//      electron-builder copies `.bundle` via extraResources (see
//      packages/desktop/electron-builder.config.ts).
//   2. <moduleDir>/.bundle — dev (Bun) and the source tree.
// If neither is readable the bundle is treated as absent (compose degrades to
// "no skills" rather than crashing).
//
// Deliberately uses only `fs/promises` (no sync `fs`, no gray-matter) for the
// same tsgo-complexity reason.
function moduleDir(): string | undefined {
  const meta = import.meta as unknown as { dir?: string; dirname?: string; url?: string }
  const dir = meta.dir ?? meta.dirname
  if (typeof dir === "string" && dir.length > 0) return dir
  if (typeof meta.url === "string" && meta.url.length > 0) {
    try {
      return path.dirname(fileURLToPath(meta.url))
    } catch {
      return undefined
    }
  }
  return undefined
}

function candidateBaseDirs(): string[] {
  const dirs: string[] = []
  const rp = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (typeof rp === "string" && rp.length > 0) dirs.push(path.join(rp, "compose-bundle"))
  const dir = moduleDir()
  if (dir) dirs.push(path.resolve(dir, ".bundle"))
  return dirs
}

async function readBundleDir(base: string): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {}
  const top = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
  const walk = async (dir: string, rel: string, out: Record<string, string>) => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(dir, relPath, out)
      else out[relPath] = await fs.readFile(path.join(dir, relPath), "utf8")
    }
  }
  for (const entry of top) {
    if (!entry.isDirectory()) continue
    const files: Record<string, string> = {}
    await walk(path.join(base, entry.name), "", files)
    if (Object.keys(files).length > 0) result[entry.name] = files
  }
  return result
}

async function loadComposeBundle(): Promise<Record<string, Record<string, string>>> {
  for (const base of candidateBaseDirs()) {
    const result = await readBundleDir(base)
    if (Object.keys(result).length > 0) return result
  }
  return {}
}

let cached: Record<string, Record<string, string>> | undefined
async function bundle(): Promise<Record<string, Record<string, string>>> {
  if (!cached) cached = await loadComposeBundle()
  return cached
}

export async function extractComposeBundle(): Promise<string> {
  const root = path.join(Global.Path.data, "compose", InstallationVersion)
  const skillsDir = path.join(root, "skills")

  const all = await bundle()
  // Bundle not shipped in this runtime (no readable .bundle / resources dir) ->
  // nothing to extract; compose degrades to "no skills".
  if (Object.keys(all).length === 0) return root

  if (!InstallationLocal) {
    // Idempotent: skip if this version's skills already exist on disk. Keyed on
    // the skills dir (not a marker file) so a prior build that shipped an EMPTY
    // bundle self-heals once the real bundle is present, instead of being locked
    // out by a stale success marker.
    const existing = await fs.readdir(skillsDir).catch(() => [])
    if (existing.length > 0) return root
  }

  for (const [skillName, files] of Object.entries(all)) {
    const skillDir = path.join(skillsDir, skillName)
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(skillDir, relPath)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content)
    }
  }
  return root
}

// Lightweight YAML-frontmatter name/description extractor (no gray-matter).
function parseSkillMeta(content: string): { name?: string; description?: string } {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return {}
  const block = fm[1]
  const read = (key: string): string | undefined => {
    const m = block.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"))
    return m ? m[1].replace(/^["']|["']$/g, "") : undefined
  }
  return { name: read("name"), description: read("description") }
}

export async function composeSkillsBlock(): Promise<string> {
  const root = path.join(Global.Path.data, "compose", InstallationVersion)
  const all = await bundle()
  const entries: string[] = []

  for (const [skillName, files] of Object.entries(all)) {
    const skillMd = files["SKILL.md"]
    if (!skillMd) continue
    const data = parseSkillMeta(skillMd)
    if (!data.name || !data.description) continue

    const location = pathToFileURL(path.join(root, "skills", skillName, "SKILL.md")).href
    entries.push(
      `  <skill>`,
      `    <name>${data.name}</name>`,
      `    <description>${data.description}</description>`,
      `    <location>${location}</location>`,
      `  </skill>`,
    )
  }

  if (entries.length === 0) return ""
  return ["<compose_skills>", ...entries, "</compose_skills>"].join("\n")
}
