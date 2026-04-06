# pnpm 전환 검토

## 1. 프로젝트 개요

- **패키지명**: ait-devtools (단일 패키지, monorepo 아님)
- **빌드**: tsup (ESM + CJS)
- **테스트**: vitest
- **의존성**: unplugin (dependency), @apps-in-toss/web-framework (peer + dev)
- **CI**: GitHub Actions (check-sdk-update workflow)

## 2. pnpm 전환 장단점

### 장점

| 항목 | 설명 |
|------|------|
| **엄격한 의존성 격리** | pnpm은 phantom dependency를 차단함. 이 프로젝트는 라이브러리이므로, 실제 사용자 환경에서 발생할 수 있는 의존성 문제를 개발 시점에 발견 가능 |
| **디스크/설치 속도** | content-addressable store로 중복 제거. 이 프로젝트 규모에서는 체감 차이 작지만, 개발 머신에 다수 프로젝트가 있을 때 누적 효과 |
| **peerDependencies 자동 설치** | pnpm v8+에서 `auto-install-peers=true` 설정 시 peer를 자동 설치. 이 프로젝트에서 @apps-in-toss/web-framework 처리가 명확해짐 |
| **lockfile 크기** | pnpm-lock.yaml은 일반적으로 package-lock.json보다 작음 |

### 단점 / 주의사항

| 항목 | 설명 |
|------|------|
| **팀 도구 통일** | 팀원/컨트리뷰터가 pnpm을 별도 설치해야 함 |
| **CI 설정 변경** | GitHub Actions에서 pnpm setup step 추가 필요 |
| **엄격한 호이스팅** | phantom dependency에 의존하는 코드가 있으면 깨질 수 있음 (이 프로젝트는 의존성이 단순해서 위험 낮음) |

### 결론

**전환 적절함.** 의존성이 단순하고 (runtime: unplugin 1개, peer: 1개), 라이브러리 특성상 엄격한 의존성 격리가 오히려 이점. 전환 비용이 매우 낮음.

## 3. pnpm workspace 필요 여부

**불필요.** 단일 패키지 프로젝트이므로 `pnpm-workspace.yaml` 없이 일반 pnpm 프로젝트로 운영하면 됨.

## 4. peerDependencies 처리 차이

| 패키지 매니저 | 동작 |
|---|---|
| **npm** | v7+에서 peer를 자동 설치, 충돌 시 `--legacy-peer-deps` 필요 |
| **pnpm** | 기본적으로 peer를 자동 설치하지 않음. `.npmrc`에 `auto-install-peers=true` 설정 권장 |

이 프로젝트에서 `@apps-in-toss/web-framework`는 `peerDependenciesMeta`에서 `optional: true`로 설정되어 있고, devDependencies에도 포함되어 있으므로 개발 시에는 문제 없음.

## 5. package-lock.json → pnpm-lock.yaml 전환

- `package-lock.json` 삭제
- `pnpm install` 실행 시 `pnpm-lock.yaml` 자동 생성
- `.gitignore`에 변경 불필요 (package-lock.json 제거, pnpm-lock.yaml은 커밋 대상)

## 6. CI (GitHub Actions) 변경 사항

`pnpm/action-setup`을 사용하여 pnpm 설치 step 추가:

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 10
```

`actions/setup-node@v4`에 pnpm 캐시 설정 가능:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'pnpm'
```

모든 `npm` 명령어를 `pnpm`으로 교체:
- `npm ci` → `pnpm install --frozen-lockfile`
- `npm install <pkg>` → `pnpm add <pkg>`
- `npm run <script>` → `pnpm run <script>` (또는 `pnpm <script>`)

## 7. .npmrc 설정

```ini
auto-install-peers=true
```

- `auto-install-peers=true`: peerDependencies 자동 설치 활성화
- 그 외 특별한 설정 불필요 (private registry 사용 시 추가)

## 8. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `package-lock.json` | 삭제 |
| `pnpm-lock.yaml` | 신규 생성 (pnpm install) |
| `.npmrc` | 신규 생성 |
| `package.json` | `packageManager` 필드 추가 |
| `.github/workflows/check-sdk-update.yml` | npm → pnpm 전환 |
