# CruiseCode

[English](https://github.com/letta-ai/mods/tree/main/packages/cruise-code) | [한국어](https://github.com/letta-ai/mods/blob/main/packages/cruise-code/README.ko.md)

CruiseCode는 Letta Code용 evidence-first 코딩 워크플로우 mod입니다.

구현 작업과 UX handoff를 검증 가능한 계약(Evidence Contract), 증거, 판정, 보고서로 바꿉니다.

```text
No evidence → no verified
```

## 무엇을 추가하나요

| Command | Purpose | Best used when |
| --- | --- | --- |
| `/code-cruise "task"` | run과 Evidence Contract 생성 | 추적 가능한 코딩 작업을 시작할 때 |
| `/code-cruise --verify-only` | 현재 git diff를 가능한 check로 검증 | 이미 수정한 코드의 evidence/report가 필요할 때 |
| `/code-cruise --resume` | active run 표시 | 현재 run을 이어가거나 확인할 때 |
| `/code-cruise --handoff <file>` | `implementation-handoff.json`에서 run 생성 | UX/product handoff에서 이어갈 때 |
| `/code-plan [task]` | Evidence Contract 생성/갱신 | task 기준이나 check를 정리해야 할 때 |
| `/code-check` | git/check evidence 수집 | 진행 상황을 주장하기 전에 증거가 필요할 때 |
| `/code-status` | run 상태, evidence, blocker, next action 표시 | 읽기 쉬운 dashboard가 필요할 때 |
| `/code-report` | `report.md` 생성 | handoff나 검증 요약이 필요할 때 |

## 핵심 아이디어

CruiseCode는 workflow 상태와 검증 판정을 분리합니다.

```text
phase   = 작업이 workflow상 어디에 있는가
verdict = evidence 기준으로 얼마나 신뢰할 수 있는가
```

작업이 보고 가능한 상태여도 verified가 아닐 수 있습니다. 이 구분이 CruiseCode의 핵심입니다.

## 저장 구조

CruiseCode는 현재 작업 디렉토리 기준으로 project-local state를 저장합니다.

```text
.letta/cruise-code/
  config.json
  active.json
  runs/
    <run-id>/
      run.json
      plan.json
      ledger.jsonl
      evidence/
        index.json
        git-status.txt
        git-diff-stat.txt
        git-diff.patch
        typecheck.txt
        test.txt
        lint.txt
        build.txt
      report.md
      lesson-candidates.json
```

이 저장소에는 local run state나 private evidence artifact를 포함하지 않습니다.

## 설치

Letta Code에서 published package를 설치합니다.

```bash
letta install npm:@letta-ai/cruise-code
```

그 다음 Letta Code 세션에서 reload합니다.

```text
/reload
```

명령어가 보이는지 확인합니다.

```text
/code-cruise help
```

이 repository에서 local development 용도로 설치하려면:

```bash
git clone https://github.com/letta-ai/mods.git
letta install ./mods/packages/cruise-code
```

CruiseCode는 홈 디렉토리보다 실제 프로젝트 디렉토리에서 사용하는 것이 좋습니다.

```text
/code-cruise "Fix login redirect after expired session"
```

## Development

공개 package는 의도적으로 작게 유지합니다.

```text
MOD.md
README.md
README.ko.md
mods/index.ts
package.json
```

간단한 source/package check는 아래처럼 실행할 수 있습니다.

```bash
tmp=$(mktemp -d)
cp mods/index.ts "$tmp/mod.mjs"
node --check "$tmp/mod.mjs"
rm -rf "$tmp"
npm pack --dry-run
```

## CruiseUX handoff

CruiseCode는 CruiseUX와 함께 쓰이도록 설계됐습니다.

```text
CruiseUX   → UX framing, research, interview, ideation, spec, review
CruiseCode → implementation, evidence, checks, verdict, report
```

기준 handoff 파일은 아래와 같습니다.

```text
implementation-handoff.json
```

CruiseCode는 `ux-ac-001` 같은 원래 UX acceptance criteria를 `ux_ref`로 보존해서, report에서 UX 의도와 구현 evidence를 연결할 수 있게 합니다.

## muscle-memory 연동

CruiseCode는 [`muscle-memory`](https://github.com/letta-ai/mods/tree/main/packages/muscle-memory)와 협업할 수 있지만, skill 관리는 직접 맡지 않습니다.

```text
CruiseUX      → UX 의도와 implementation handoff 작성
CruiseCode    → evidence, verdict, report, reusable lesson candidate 작성
muscle-memory → 실제로 재사용 가능한 lesson만 distill/dedup/sanitize/publish
```

`/code-report`는 `report.md` 옆에 `lesson-candidates.json`을 쓰고, report 안에 `Reusable Lesson Candidates` 섹션을 추가합니다. 이것들은 **skill이 아닙니다**. `muscle-memory`나 사람이 검토할 수 있는 후보 힌트입니다. CruiseCode는 skill shelf에 쓰지 않고, Custom Skill을 publish하지 않고, 어떤 lesson을 승격할지 결정하지 않습니다.

CruiseCode와 함께 dogfood할 때 권장하는 보수적인 `muscle-memory` 기본값은 다음입니다.

```bash
MM_REFLECT=staged
MM_CAPTURE=off
MM_PUBLISH=off
```

## Safety

Mods are trusted local code. 설치 전 source를 검토하세요.

이 mod는 사용자가 명령어를 실행했을 때만 active project의 `.letta/cruise-code/` 아래에 local filesystem write를 하고, local git/check command를 실행합니다. startup side effect나 background timer는 없습니다.

private CruiseCode run state, evidence files, `.env` files, credentials, local diagnostics, private project logs는 커밋하지 마세요.

mod가 startup이나 command handling을 깨뜨리면 아래처럼 복구할 수 있습니다.

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

그 다음 mod package를 제거하거나 수정하고 `/reload`를 실행하세요.

Agent-facing behavioral contract는 MOD.md를 참고하세요.
