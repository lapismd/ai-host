import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** Keep emitted ESM declarations resolvable by both Bundler and NodeNext. */
export async function normalizeDeclarationImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeDeclarationImports(file);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const content = await readFile(file, "utf8");
    const source = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const edits = [];
    function visit(node) {
      const literal =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : undefined;
      if (
        literal &&
        ts.isStringLiteral(literal) &&
        /^\.{1,2}\//.test(literal.text) &&
        !path.extname(literal.text)
      ) {
        edits.push({ at: literal.getEnd() - 1, text: ".js" });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    let result = content;
    for (const edit of edits.sort((a, b) => b.at - a.at))
      result = result.slice(0, edit.at) + edit.text + result.slice(edit.at);
    if (result !== content) await writeFile(file, result);
  }
}
