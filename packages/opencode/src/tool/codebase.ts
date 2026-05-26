import { CodeGraph } from "@/codegraph"
import { InstanceState } from "@/effect/instance-state"
import { WorkflowEvidence } from "@/workflow/evidence"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

type Metadata = {
  graph: CodeGraph.Info
  evidenceID?: string
}

type Services = CodeGraph.Service | WorkflowEvidence.Service

const Empty = Schema.Struct({})
const Limit = Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
  description: "Maximum number of results to return.",
})

const FilesParameters = Schema.Struct({
  filter: Schema.optional(Schema.String).annotate({ description: "Only include files under this directory." }),
  pattern: Schema.optional(Schema.String).annotate({ description: "Only include files matching this glob pattern." }),
  format: Schema.optional(Schema.Literals(["tree", "flat", "grouped"])).annotate({
    description: "Output format. Defaults to tree.",
  }),
  maxDepth: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Maximum directory depth for tree output.",
  }),
  metadata: Schema.optional(Schema.Boolean).annotate({
    description: "Include file metadata such as language and symbol count. Defaults to true.",
  }),
})

const ContextParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Feature, bug, task, or code area to build context for." }),
  maxNodes: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Maximum symbols to include. Defaults to CodeGraph's CLI default.",
  }),
  maxCode: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Maximum source code blocks to include.",
  }),
  includeCode: Schema.optional(Schema.Boolean).annotate({ description: "Include source code blocks. Defaults to true." }),
  format: Schema.optional(Schema.Literals(["markdown", "json"])).annotate({
    description: "Output format. Defaults to markdown.",
  }),
})

const SearchParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Symbol name or partial name to search for." }),
  limit: Limit,
  kind: Schema.optional(Schema.String).annotate({
    description: "Optional node kind filter such as function, method, class, interface, or type_alias.",
  }),
})

const SymbolParameters = Schema.Struct({
  symbol: Schema.String.annotate({ description: "Function, method, class, or symbol name." }),
  limit: Limit,
})

const NodeParameters = Schema.Struct({
  symbol: Schema.String.annotate({ description: "Function, method, class, or symbol name." }),
  includeCode: Schema.optional(Schema.Boolean).annotate({ description: "Include source code or outline." }),
})

const ExploreParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Symbol names, file names, or short code terms to explore." }),
  maxFiles: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Maximum number of files to include.",
  }),
})

const TraceParameters = Schema.Struct({
  from: Schema.String.annotate({ description: "Symbol where the call path starts." }),
  to: Schema.String.annotate({ description: "Symbol where the call path should end." }),
})

const ImpactParameters = Schema.Struct({
  symbol: Schema.String.annotate({ description: "Function, method, class, or symbol name." }),
  depth: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Dependency traversal depth. Defaults to 2.",
  }),
})

const AffectedTestsParameters = Schema.Struct({
  files: Schema.Array(Schema.String).annotate({ description: "Changed source file paths." }),
  depth: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Max dependency traversal depth. Defaults to 5.",
  }),
  filter: Schema.optional(Schema.String).annotate({ description: "Custom glob filter for test files." }),
  quiet: Schema.optional(Schema.Boolean).annotate({ description: "Only return affected test file paths." }),
})

export const CodebaseStatusTool = Tool.define<typeof Empty, Metadata, Services>(
  "codebase_status",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description: "Return the bundled CodeGraph status for this project, including sync readiness and graph metadata.",
      parameters: Empty,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const graph = yield* codegraph.status()
          const event = yield* recordEvidence(evidence, ctx, "graph_query", "CodeGraph status", { graph })
          return {
            title: `CodeGraph ${graph.status}`,
            metadata: { graph, evidenceID: event?.id },
            output: evidencePrefix(event?.id) + JSON.stringify(graph, null, 2),
          }
        }),
    }
  }),
)

export const CodebaseFilesTool = Tool.define<typeof FilesParameters, Metadata, Services>(
  "codebase_files",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description: "List indexed files from bundled CodeGraph. Use this before glob/read for codebase structure.",
      parameters: FilesParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.run([
            "files",
            "-p",
            yield* InstanceState.directory,
            "-j",
            ...(params.filter ? ["--filter", params.filter] : []),
            ...(params.pattern ? ["--pattern", params.pattern] : []),
            ...(params.format ? ["--format", params.format] : []),
            ...(params.maxDepth !== undefined ? ["--max-depth", String(params.maxDepth)] : []),
            ...(params.metadata === false ? ["--no-metadata"] : []),
          ])
          return yield* output(evidence, ctx, "CodeGraph files", result, "graph_query", params)
        }),
    }
  }),
)

export const CodebaseContextTool = Tool.define<typeof ContextParameters, Metadata, Services>(
  "codebase_context",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description:
        "Build focused code context using bundled CodeGraph. Prefer this for architecture, feature, and bug exploration.",
      parameters: ContextParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.run([
            "context",
            params.task,
            "-p",
            yield* InstanceState.directory,
            ...(params.maxNodes ? ["-n", String(params.maxNodes)] : []),
            ...(params.maxCode !== undefined ? ["-c", String(params.maxCode)] : []),
            ...(params.includeCode === false ? ["--no-code"] : []),
            ...(params.format ? ["-f", params.format] : []),
          ])
          return yield* output(evidence, ctx, "CodeGraph context", result, "graph_query", params)
        }),
    }
  }),
)

export const CodebaseSearchSymbolTool = Tool.define<typeof SearchParameters, Metadata, Services>(
  "codebase_search_symbol",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description: "Search indexed code symbols by name using bundled CodeGraph.",
      parameters: SearchParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.run([
            "query",
            params.query,
            "-p",
            yield* InstanceState.directory,
            "-j",
            ...(params.limit ? ["-l", String(params.limit)] : []),
            ...(params.kind ? ["-k", params.kind] : []),
          ])
          return yield* output(evidence, ctx, "CodeGraph symbol search", result, "graph_query", params)
        }),
    }
  }),
)

export const CodebaseCallersTool = graphSymbolTool("codebase_callers", "callers", "Find callers of a symbol.")
export const CodebaseCalleesTool = graphSymbolTool("codebase_callees", "callees", "Find callees called by a symbol.")

export const CodebaseImpactTool = Tool.define<typeof ImpactParameters, Metadata, Services>(
  "codebase_impact",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description: "Analyze what symbols and files are affected by changing a symbol using bundled CodeGraph.",
      parameters: ImpactParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.run([
            "impact",
            params.symbol,
            "-p",
            yield* InstanceState.directory,
            "-j",
            ...(params.depth ? ["-d", String(params.depth)] : []),
          ])
          return yield* output(evidence, ctx, "CodeGraph impact", result, "impact", params)
        }),
    }
  }),
)

export const CodebaseAffectedTestsTool = Tool.define<typeof AffectedTestsParameters, Metadata, Services>(
  "codebase_affected_tests",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description: "Find test files affected by changed source files using CodeGraph dependency edges.",
      parameters: AffectedTestsParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.run([
            "affected",
            ...params.files,
            "-p",
            yield* InstanceState.directory,
            "-j",
            ...(params.depth ? ["-d", String(params.depth)] : []),
            ...(params.filter ? ["-f", params.filter] : []),
            ...(params.quiet ? ["-q"] : []),
          ])
          return yield* output(evidence, ctx, "CodeGraph affected tests", result, "test", params)
        }),
    }
  }),
)

export const CodebaseNodeTool = Tool.define<typeof NodeParameters, Metadata, Services>(
  "codebase_node",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description:
        "Get one symbol's details plus its caller/callee trail using bundled CodeGraph. Use this to follow a specific graph hop without raw read/grep.",
      parameters: NodeParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.runMcpTool("codegraph_node", params)
          return yield* output(evidence, ctx, "CodeGraph node", result, "graph_query", params)
        }),
    }
  }),
)

export const CodebaseExploreTool = Tool.define<typeof ExploreParameters, Metadata, Services>(
  "codebase_explore",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description:
        "Return source for several related symbols grouped by file using bundled CodeGraph. Prefer this over multiple read calls after codebase_context.",
      parameters: ExploreParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.runMcpTool("codegraph_explore", params)
          return yield* output(evidence, ctx, "CodeGraph explore", result, "graph_query", params)
        }),
    }
  }),
)

export const CodebaseTraceTool = Tool.define<typeof TraceParameters, Metadata, Services>(
  "codebase_trace",
  Effect.gen(function* () {
    const codegraph = yield* CodeGraph.Service
    const evidence = yield* WorkflowEvidence.Service
    return {
      description:
        "Trace the call path between two symbols using bundled CodeGraph. Use for flow questions where grep cannot prove the path.",
      parameters: TraceParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* codegraph.runMcpTool("codegraph_trace", params)
          return yield* output(evidence, ctx, "CodeGraph trace", result, "graph_query", params)
        }),
    }
  }),
)

function graphSymbolTool(id: string, command: string, description: string) {
  return Tool.define<typeof SymbolParameters, Metadata, Services>(
    id,
    Effect.gen(function* () {
      const codegraph = yield* CodeGraph.Service
      const evidence = yield* WorkflowEvidence.Service
      return {
        description: `${description} Uses bundled CodeGraph and returns graph evidence.`,
        parameters: SymbolParameters,
        execute: (params, ctx) =>
          Effect.gen(function* () {
            const result = yield* codegraph.run([
              command,
              params.symbol,
              "-p",
              yield* InstanceState.directory,
              "-j",
              ...(params.limit ? ["-l", String(params.limit)] : []),
            ])
            return yield* output(evidence, ctx, `CodeGraph ${command}`, result, "graph_query", params)
          }),
      }
    }),
  )
}

function output(
  evidence: WorkflowEvidence.Interface,
  ctx: Tool.Context<Metadata>,
  title: string,
  result: CodeGraph.CommandResult,
  type: WorkflowEvidence.CreateInput["type"],
  params: unknown,
) {
  return Effect.gen(function* () {
    const event = yield* recordEvidence(evidence, ctx, type, title, {
      params,
      graph: result.status,
      outputBytes: result.stdout.length + result.stderr.length,
    })
    return outputSync(title, result, event?.id)
  })
}

function outputSync(title: string, result: CodeGraph.CommandResult, evidenceID?: string) {
  const evidence = [
    `CodeGraph status: ${result.status.status}`,
    result.status.version ? `version: ${result.status.version}` : undefined,
    result.status.lastSyncAt ? `last sync: ${result.status.lastSyncAt}` : undefined,
    result.status.lastStatusAt ? `last status: ${result.status.lastStatusAt}` : undefined,
    evidenceID ? `evidence: ${evidenceID}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ")
  return {
    title,
    metadata: { graph: result.status, evidenceID },
    output: [`[${evidence}]`, result.stdout.trim() || result.stderr.trim() || "No CodeGraph output."].join("\n\n"),
  }
}

function recordEvidence(
  evidence: WorkflowEvidence.Interface,
  ctx: Tool.Context<Metadata>,
  type: WorkflowEvidence.CreateInput["type"],
  summary: string,
  data: unknown,
) {
  return evidence
    .append({
      sessionID: ctx.sessionID,
      type,
      summary,
      data,
    })
    .pipe(Effect.orElseSucceed(() => undefined))
}

function evidencePrefix(evidenceID?: string) {
  return evidenceID ? `[Evidence: ${evidenceID}]\n\n` : ""
}
