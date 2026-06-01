/**
 * SDK export diff 스크립트
 *
 * 현재 설치된 @apps-in-toss/web-framework와 대상 버전(기본: latest)의
 * 런타임 export 키 집합을 비교해 NEW/REMOVED export를 출력한다.
 *
 * `check-sdk-update.ts`는 "버전이 바뀌었는가"만 본다. 이 스크립트는
 * "무엇이 바뀌었는가" — 특히 **새 export** 를 본다. 새 export는 type error를
 * 만들지 않아서(`__typecheck.ts`가 import하지 않은 export는 tsc가 플래그하지
 * 않음) typecheck만으론 놓친다. 그래서 별도로 키 집합을 diff한다.
 *
 * 사용:
 *   pnpm diff-sdk-exports            # installed vs latest
 *   pnpm diff-sdk-exports 2.6.0      # installed vs 2.6.0
 *
 * 출력은 사람이 읽는 텍스트 + (CI용) GITHUB_OUTPUT 에 new_exports/removed_exports.
 * 새 export가 있으면 exit 1 (CI가 "mock 추가 필요"로 분기할 수 있게).
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const PACKAGE = '@apps-in-toss/web-framework';

function getInstalledVersion(): string {
  // pnpm workspace에서 `npm list`는 신뢰할 수 없다 — node resolver로 실제 resolve된
  // package.json의 version을 읽는다.
  // 3.0+ 패키지는 exports map에 ./package.json을 노출하지 않으므로,
  // node_modules 내 package.json 경로를 직접 구성한다.
  try {
    const pkgPath = require.resolve(`${PACKAGE}/package.json`);
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version ?? 'unknown';
  } catch {
    // fallback: resolve main entry, then derive the package directory from the
    // known node_modules layout (works for pnpm and npm both).
    try {
      const main = require.resolve(PACKAGE);
      // Find the package root by locating the last occurrence of the package
      // name segments in the resolved path (handles scoped packages like @a/b).
      const pkgSegment = `node_modules${join('/', ...PACKAGE.split('/'))}`;
      const idx = main.lastIndexOf(pkgSegment);
      if (idx === -1) return 'unknown';
      const pkgDir = main.slice(0, idx + pkgSegment.length);
      return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')).version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

function resolveLatestVersion(): string {
  // TODO: revert to `version` (latest dist-tag) at GA when web-framework 3.0.0 stable ships.
  // During the prerelease window we track the `beta` dist-tag instead.
  try {
    const betaResult = execSync(`npm view ${PACKAGE} dist-tags.beta`, {
      encoding: 'utf-8',
    }).trim();
    if (betaResult && betaResult !== 'undefined') return betaResult;
  } catch {
    // fall through to latest
  }
  return execSync(`npm view ${PACKAGE} version`, { encoding: 'utf-8' }).trim();
}

/**
 * 주어진 버전의 export 키 집합을 가져온다.
 *
 * web entry(`dist-web/index.js`)는 `@apps-in-toss/web-bridge` 등 sibling 패키지를
 * re-export하므로 bare tarball만으론 import가 안 된다(transitive dep 미해결). 그래서
 * 격리된 임시 프로젝트에 `npm install`로 deps까지 받은 뒤 import한다.
 */
async function exportsOf(version: string): Promise<Set<string>> {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-exports-'));
  try {
    execSync('npm init -y', { cwd: dir, stdio: 'ignore' });
    execSync(`npm install --no-audit --no-fund "${PACKAGE}@${version}"`, {
      cwd: dir,
      stdio: 'ignore',
    });

    const installed = join(dir, 'node_modules', ...PACKAGE.split('/'));
    const pkgJson = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf-8'));
    const exp = pkgJson.exports?.['.'];
    // Resolve potentially nested conditions: { import: { types, default }, require: ... }
    function resolveEntry(v: unknown): string | undefined {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        // Prefer ESM: import > default > require
        return resolveEntry(obj.import) ?? resolveEntry(obj.default) ?? resolveEntry(obj.require);
      }
      return undefined;
    }
    const entryRel: string | undefined = resolveEntry(exp) ?? pkgJson.module ?? pkgJson.main;
    if (!entryRel) throw new Error(`web entry를 찾지 못했어요: ${PACKAGE}@${version}`);

    const entry = pathToFileURL(join(installed, entryRel)).href;
    const mod = await import(entry);
    return new Set(Object.keys(mod).filter((k) => k !== 'default'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeGithubOutput(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  // 멀티라인 값은 heredoc 구문으로.
  const delim = `__EOF_${key}__`;
  execSync(`printf '%s' ${JSON.stringify(`${key}<<${delim}\n${value}\n${delim}\n`)} >> "${out}"`);
}

async function main(): Promise<void> {
  const installed = getInstalledVersion();
  const target = process.argv[2] ?? resolveLatestVersion();

  console.log(`Installed: ${PACKAGE}@${installed}`);
  console.log(`Target:    ${PACKAGE}@${target}`);

  if (installed === 'unknown') {
    console.error('설치된 버전을 찾지 못했어요. `pnpm install` 후 다시 실행하세요.');
    process.exit(2);
  }

  const [installedExports, targetExports] = await Promise.all([
    exportsOf(installed),
    exportsOf(target),
  ]);

  const added = [...targetExports].filter((k) => !installedExports.has(k)).sort();
  const removed = [...installedExports].filter((k) => !targetExports.has(k)).sort();

  console.log('');
  if (added.length === 0 && removed.length === 0) {
    console.log(`export 변화 없음 (${installed} → ${target}).`);
  } else {
    if (added.length > 0) {
      console.log(`NEW exports (${added.length}) — mock·데모 추가 필요:`);
      for (const n of added) console.log(`  + ${n}`);
    }
    if (removed.length > 0) {
      console.log(`REMOVED exports (${removed.length}) — mock 정리 필요:`);
      for (const n of removed) console.log(`  - ${n}`);
    }
  }

  writeGithubOutput('new_exports', added.join('\n'));
  writeGithubOutput('removed_exports', removed.join('\n'));

  // 새 export가 있으면 exit 1 — CI가 "mock 추가 필요" 분기를 탈 수 있게.
  // (removed만 있는 경우도 주의 대상이지만, "새 API 누락"이 우리가 막으려는 주된 사고라 그걸 exit code로 신호한다.)
  process.exit(added.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
