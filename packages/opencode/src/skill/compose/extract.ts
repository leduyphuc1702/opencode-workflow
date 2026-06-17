import path from "path"
import { pathToFileURL } from "url"
import * as fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"

// Load the bundled compose skills from the colocated `.bundle/` directory.
//
// Deliberately uses only `fs/promises` (no sync `fs`, no separate macro module,
// no gray-matter): each of those pulls a large/extra type surface into the
// reachable graph and tips the whole-program type-checker (tsgo) over its
// complexity ceiling (it then mis-resolves deeply-generic Effect code in the
// llm package). The `.bundle/` directory ships in source alongside this file.
async function loadComposeBundle(): Promise<Record<string, Record<string, string>>> {
  const base = path.resolve(import.meta.dir, ".bundle")
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

let cached: Record<string, Record<string, string>> | undefined
async function bundle(): Promise<Record<string, Record<string, string>>> {
  if (!cached) cached = await loadComposeBundle()
  return cached
}

export async function extractComposeBundle(): Promise<string> {
  const root = path.join(Global.Path.data, "compose", InstallationVersion)
  const marker = path.join(root, ".extracted")

  if (!InstallationLocal) {
    const exists = await fs
      .stat(marker)
      .then(() => true)
      .catch(() => false)
    if (exists) return root
  }

  const all = await bundle()
  for (const [skillName, files] of Object.entries(all)) {
    const skillDir = path.join(root, "skills", skillName)
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(skillDir, relPath)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content)
    }
  }
  await fs.mkdir(path.dirname(marker), { recursive: true })
  await fs.writeFile(marker, InstallationVersion)
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
