// Config key usage scanner (#243).
//
// Parses src/**, scripts/** and prisma/**/*.ts with the TypeScript compiler API
// and reports:
//   undeclared    config.KEY / config['KEY'] / destructured KEY that is not a
//                 schema key
//   unused-active a schema key that is `active` (not reserved/deprecated in
//                 src/config/meta.ts) and is never read outside src/config
//   untyped       `config as any` / `config as unknown as ...`, or element
//                 access with a non-literal key (allow with a
//                 `// config-scan: dynamic <reason>` comment on that line)
//
// A key counts as read when it appears as a property/element access or a
// destructured name on a `config` import from src/config, as a literal
// argument to secret()/secretEntry()/previousSecret()/onSecretChange(), as
// process.env.KEY / process.env['KEY'], or as a string literal equal to the
// key (lookup tables such as SECRET_NAMES). Reads inside src/config/index.ts
// (the schema and its superRefine cross-checks) do not count.
//
// Usage: tsx scripts/check-config-usage.ts [--json]
// Exit code 1 when any problem is reported.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const CONFIG_INDEX = path.join(ROOT, 'src', 'config', 'index.ts');
const META = path.join(ROOT, 'src', 'config', 'meta.ts');
const SECRET_FNS = new Set(['secret', 'secretEntry', 'previousSecret', 'onSecretChange']);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2020, true);
}

/** Top-level keys of the `z.object({...})` assigned to envObjectSchema. */
function schemaKeys(): Set<string> {
  const sf = parse(CONFIG_INDEX);
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'envObjectSchema' &&
      node.initializer
    ) {
      const findObject = (n: ts.Node): ts.ObjectLiteralExpression | undefined => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'object') {
          const arg = n.arguments[0];
          if (arg && ts.isObjectLiteralExpression(arg)) return arg;
        }
        return ts.forEachChild(n, findObject);
      };
      const obj = findObject(node.initializer);
      for (const prop of obj?.properties ?? []) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) keys.add(prop.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

/** Keys listed in KEY_LIFECYCLE (reserved/deprecated). */
function lifecycleKeys(): Set<string> {
  const sf = parse(META);
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'KEY_LIFECYCLE' && node.initializer) {
      let init: ts.Expression = node.initializer;
      while (ts.isSatisfiesExpression(init) || ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) keys.add(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

/** Local names bound to the `config` export of src/config in this file. */
function configBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const dir = path.dirname(sf.fileName);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(dir, spec);
    const target = path.join(ROOT, 'src', 'config');
    if (resolved !== target && resolved !== path.join(target, 'index')) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if ((el.propertyName?.text ?? el.name.text) === 'config') names.add(el.name.text);
      }
    }
  }
  return names;
}

function hasAllowComment(sf: ts.SourceFile, node: ts.Node): boolean {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const text = sf.text.split(/\r?\n/)[line] ?? '';
  return /config-scan: dynamic \S/.test(text);
}

interface Problem {
  kind: 'undeclared' | 'unused-active' | 'untyped';
  key?: string;
  where?: string;
}

export function scan(): Problem[] {
  const declared = schemaKeys();
  const lifecycle = lifecycleKeys();
  const used = new Set<string>();
  const problems: Problem[] = [];

  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'prisma'))].filter(
    (f) => f !== CONFIG_INDEX && f !== META,
  );

  for (const file of files) {
    const sf = parse(file);
    const bindings = configBindings(sf);
    const rel = path.relative(ROOT, file);
    const where = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const read = (key: string, node: ts.Node) => {
      used.add(key);
      if (!declared.has(key)) problems.push({ kind: 'undeclared', key, where: where(node) });
    };

    const visit = (node: ts.Node): void => {
      // config.KEY
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        if (/^[A-Z][A-Z0-9_]+$/.test(node.name.text)) read(node.name.text, node);
      }
      // config['KEY'] / config[expr]
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        const arg = node.argumentExpression;
        if (ts.isStringLiteralLike(arg)) read(arg.text, node);
        else if (!hasAllowComment(sf, node)) problems.push({ kind: 'untyped', where: where(node) });
      }
      // const { A, B } = config
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        bindings.has(node.initializer.text)
      ) {
        for (const el of node.name.elements) {
          const name = el.propertyName ?? el.name;
          if (ts.isIdentifier(name)) read(name.text, el);
        }
      }
      // config as any / config as unknown as X
      if (ts.isAsExpression(node)) {
        let inner: ts.Expression = node.expression;
        while (ts.isAsExpression(inner) || ts.isParenthesizedExpression(inner)) inner = inner.expression;
        const t = node.type.kind;
        if (
          ts.isIdentifier(inner) &&
          bindings.has(inner.text) &&
          (t === ts.SyntaxKind.AnyKeyword || ts.isAsExpression(node.expression)) &&
          !hasAllowComment(sf, node)
        ) {
          problems.push({ kind: 'untyped', where: where(node) });
        }
      }
      // secret('KEY') and friends
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SECRET_FNS.has(node.expression.text)) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) used.add(arg.text);
      }
      // process.env.KEY / process.env['KEY']
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'process' &&
        node.expression.name.text === 'env'
      ) {
        if (ts.isPropertyAccessExpression(node)) used.add(node.name.text);
        else if (ts.isStringLiteralLike(node.argumentExpression)) used.add(node.argumentExpression.text);
      }
      // Lookup tables: a string literal equal to a schema key.
      if (ts.isStringLiteralLike(node) && declared.has(node.text)) used.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  for (const key of [...declared].sort()) {
    if (!used.has(key) && !lifecycle.has(key)) problems.push({ kind: 'unused-active', key });
  }
  return problems;
}

if (process.argv[1]?.endsWith('check-config-usage.ts') || process.argv[1]?.endsWith('check-config-usage.js')) {
  const problems = scan();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(problems, null, 2));
  } else {
    for (const p of problems) {
      console.log(`${p.kind.padEnd(14)} ${p.key ?? ''}${p.where ? `  (${p.where})` : ''}`);
    }
    console.log(problems.length === 0 ? 'check:config OK' : `check:config: ${problems.length} problem(s)`);
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
