/**
 * SDK 업데이트 감지 스크립트
 *
 * @apps-in-toss/web-framework의 새 버전이 나왔는지 확인하고,
 * 현재 설치된 버전과 다르면 경고를 출력한다.
 * CI에서 주간으로 실행한다.
 */

import { execSync } from 'child_process';

const PACKAGE = '@apps-in-toss/web-framework';

function getInstalledVersion(): string {
  try {
    const result = execSync(`npm list ${PACKAGE} --json 2>/dev/null`, { encoding: 'utf-8' });
    const json = JSON.parse(result);
    return json.dependencies?.[PACKAGE]?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function getLatestVersion(): string {
  try {
    const result = execSync(`npm view ${PACKAGE} version`, { encoding: 'utf-8' });
    return result.trim();
  } catch {
    return 'unknown';
  }
}

const installed = getInstalledVersion();
const latest = getLatestVersion();

console.log(`Installed: ${PACKAGE}@${installed}`);
console.log(`Latest:    ${PACKAGE}@${latest}`);

if (installed === latest) {
  console.log('Up to date.');
  process.exit(0);
} else {
  console.log(`\nNew version available! ${installed} → ${latest}`);
  console.log('Run: npm install @apps-in-toss/web-framework@latest');
  console.log('Then run: npm run typecheck');
  // exit 1 to fail CI — triggers issue creation
  process.exit(1);
}
