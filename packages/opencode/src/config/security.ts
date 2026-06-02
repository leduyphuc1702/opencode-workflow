export * as ConfigSecurity from "./security"

import { Schema } from "effect"

export const Mode = Schema.Literals(["advisory", "strict"]).annotate({ identifier: "SecurityModeConfig" })
export type Mode = Schema.Schema.Type<typeof Mode>

export const PermissionMode = Schema.Literals(["default", "acceptEdits", "plan", "bypassPermissions"]).annotate({
  identifier: "SecurityPermissionModeConfig",
})
export type PermissionMode = Schema.Schema.Type<typeof PermissionMode>

export const SandboxMode = Schema.Literals(["workspace-write", "read-only"]).annotate({ identifier: "SecuritySandboxModeConfig" })
export type SandboxMode = Schema.Schema.Type<typeof SandboxMode>

const defaultProtectedPaths = ["~/.ssh", ".env", ".git/config", "/etc"] as const

export const Permissions = Schema.Struct({
  allow: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  ask: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  deny: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
}).annotate({ identifier: "SecurityPermissionsConfig" })
export type Permissions = Schema.Schema.Type<typeof Permissions>

export const Sandbox = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  mode: Schema.optional(SandboxMode),
  allowNetwork: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SecuritySandboxConfig" })
export type Sandbox = Schema.Schema.Type<typeof Sandbox>

export const Network = Schema.Struct({
  allowedDomains: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  deniedDomains: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
}).annotate({ identifier: "SecurityNetworkConfig" })
export type Network = Schema.Schema.Type<typeof Network>

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable security guidance checks (default: false)" }),
  mode: Schema.optional(Mode).annotate({ description: "Security guidance mode (default: advisory)" }),
  modelReview: Schema.optional(Schema.Boolean).annotate({ description: "Enable advisory model-backed diff review prompts (default: false)" }),
  permissionMode: Schema.optional(PermissionMode).annotate({ description: "Security permission mode (default: default)" }),
  protectedPaths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Paths that security permission modes never auto-approve",
  }),
  additionalDirectories: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Extra directories that security permission modes can treat as workspace boundaries",
  }),
  permissions: Schema.optional(Permissions).annotate({ description: "Optional command permission overrides" }),
  sandbox: Schema.optional(Sandbox).annotate({ description: "Optional shell command sandbox wrapper configuration" }),
  network: Schema.optional(Network).annotate({ description: "Optional network egress domain policy" }),
  allowlist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Substrings that suppress security guidance findings",
  }),
}).annotate({ identifier: "SecurityConfig" })
export type Info = Schema.Schema.Type<typeof Info>

export function enabled(info: Info | undefined) {
  return info?.enabled === true
}

export function mode(info: Info | undefined): Mode {
  return info?.mode ?? "advisory"
}

export function modelReview(info: Info | undefined) {
  return info?.modelReview === true
}

export function permissionMode(info: Info | undefined): PermissionMode {
  return info?.permissionMode ?? "default"
}

export function protectedPaths(info: Info | undefined): string[] {
  return [...(info?.protectedPaths ?? defaultProtectedPaths)]
}

export function additionalDirectories(info: Info | undefined): string[] {
  return [...(info?.additionalDirectories ?? [])]
}

export function sandbox(info: Info | undefined): Sandbox | undefined {
  return info?.sandbox
}

export function network(info: Info | undefined): Network | undefined {
  return info?.network
}
