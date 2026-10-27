import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

describe('React Rules of Hooks Audit in App.tsx', () => {
  it('ensures no hooks are called after conditional returns (such as auth checks)', () => {
    const appPath = path.resolve(__dirname, 'App.tsx');
    const sourceCode = fs.readFileSync(appPath, 'utf8');
    const sourceFile = ts.createSourceFile(appPath, sourceCode, ts.ScriptTarget.Latest, true);

    let earlyReturnLine: number | null = null;
    const hookCallLines: { name: string; line: number }[] = [];

    function findStatements(statements: ts.NodeArray<ts.Statement>) {
      for (const stmt of statements) {
        if (ts.isIfStatement(stmt)) {
          const text = stmt.getText(sourceFile);
          if (
            (text.includes('!authChecked') || text.includes('!authenticated')) &&
            (text.includes('return') || ts.isReturnStatement(stmt.thenStatement))
          ) {
            const pos = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile));
            if (earlyReturnLine === null || pos.line + 1 < earlyReturnLine) {
              earlyReturnLine = pos.line + 1;
            }
          }
        }
      }
    }

    function checkHookCalls(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const exprText = node.expression.getText(sourceFile);
        if (
          /^use[A-Z]/.test(exprText) ||
          exprText.endsWith('.useMemo') ||
          exprText.endsWith('.useCallback') ||
          exprText.endsWith('.useState') ||
          exprText.endsWith('.useEffect') ||
          exprText.endsWith('.useRef')
        ) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          hookCallLines.push({ name: exprText, line: pos.line + 1 });
        }
      }
      ts.forEachChild(node, checkHookCalls);
    }

    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(sourceFile) === 'App' &&
        node.initializer &&
        ts.isArrowFunction(node.initializer)
      ) {
        if (ts.isBlock(node.initializer.body)) {
          findStatements(node.initializer.body.statements);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    checkHookCalls(sourceFile);

    expect(earlyReturnLine).not.toBeNull();
    expect(earlyReturnLine).toBeGreaterThan(0);

    const violatingHooks = hookCallLines.filter((h) => earlyReturnLine !== null && h.line > earlyReturnLine);
    expect(
      violatingHooks,
      `Found hooks called after early authentication return: ${JSON.stringify(violatingHooks)}`
    ).toHaveLength(0);
  });

  it('ensures no hooks are placed inside if-statements, loops or switch cases', () => {
    const appPath = path.resolve(__dirname, 'App.tsx');
    const sourceCode = fs.readFileSync(appPath, 'utf8');
    const sourceFile = ts.createSourceFile(appPath, sourceCode, ts.ScriptTarget.Latest, true);

    const violatingHooks: { name: string; line: number; reason: string }[] = [];

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const exprText = node.expression.getText(sourceFile);
        if (/^use[A-Z]/.test(exprText)) {
          let p = node.parent;
          while (p) {
            if (ts.isIfStatement(p) || ts.isConditionalExpression(p)) {
              const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              violatingHooks.push({ name: exprText, line: pos.line + 1, reason: 'inside condition' });
              break;
            }
            if (ts.isForStatement(p) || ts.isWhileStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) {
              const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              violatingHooks.push({ name: exprText, line: pos.line + 1, reason: 'inside loop' });
              break;
            }
            p = p.parent;
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    expect(violatingHooks).toHaveLength(0);
  });
});
