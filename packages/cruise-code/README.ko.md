# CruiseCode

[English](https://github.com/letta-ai/mods/tree/main/packages/cruise-code) | [한국어](https://github.com/letta-ai/mods/blob/main/packages/cruise-code/README.ko.md)

CruiseCode는 Letta Code용 evidence-first 코딩 워크플로우 mod입니다.

구현 작업과 UX handoff를 실제 코드 변경으로 실행하고, 검증 가능한 계약(Evidence Contract), 실시간 진행상태, 증거, 판정, 보고서로 연결합니다.

```text
No evidence → no verified
```

## 무엇을 추가하나요

| Command | Purpose | Best used when |
| --- | --- | --- |
| `/code-cruise "task"` | 코딩 에이전트 실행, 진행 추적, 결과 검증, 보고서 생성 | CruiseCode가 작업을 처음부터 끝까지 구현해야 할 때 |
| `/code-cruise --prototype "task"`<br>`/code-cruise --mode prototype "task"` | direct task로 범위가 정해진 prototype을 만들고 portable review packet 생성 | UX handoff 없이 technical prototype evidence가 필요할 때 |
| `/code-cruise --prototype --handoff <file>` | read-only implementation handoff에서 prototype 생성 | 이미 UX criterion을 갖고 있고 구현 evidence로 추적해야 할 때 |
| `/code-cruise --verify-only` | 현재 git diff를 가능한 check로 검증 | 이미 수정한 코드의 evidence/report가 필요할 때 |
| `/code-cruise --resume` | active run 표시 | 현재 run을 이어가거나 확인할 때 |
| `/code-cruise --handoff <file>` | `implementation-handoff.json`에서 run 생성 | UX/product handoff에서 이어갈 때 |
| `/code-plan [task]` | Evidence Contract 생성/갱신 | task 기준이나 check를 정리해야 할 때 |
| `/code-check` | git/check evidence 수집 | 진행 상황을 주장하기 전에 증거가 필요할 때 |
| `/code-status` | run 상태, evidence, blocker, next action 표시 | 읽기 쉬운 dashboard가 필요할 때 |
| `/code-report` | `report.md` 생성 | handoff나 검증 요약이 필요할 때 |
| `/code-panel hide\|show\|status` | 진행 패널 제어 | 패널을 숨기거나 복원하거나 현재 설정을 확인할 때 |

## 핵심 아이디어

CruiseCode는 workflow 상태와 검증 판정을 분리합니다.

```text
phase   = 작업이 workflow상 어디에 있는가
verdict = evidence 기준으로 얼마나 신뢰할 수 있는가
```

작업이 보고 가능한 상태여도 verified가 아닐 수 있습니다. 이 구분이 CruiseCode의 핵심입니다.

## 자동 실행

`/code-cruise "task"`는 이제 plan만 만든 뒤 멈추지 않고 실제 agent turn을 시작합니다.

```text
task prompt
→ Evidence Contract
→ project 확인
→ file 수정
→ 관련 check 실행
→ git/check evidence 수집
→ verdict 계산
→ report.md 생성
→ 최종 요약 표시
```

진행 패널은 실제 도구 이벤트에 따라 갱신됩니다. 코딩 에이전트가 사용하는 tool을 기반으로 현재 작업과 단계 수가 바뀝니다. Run은 시작한 conversation과 agent에 연결되므로 다른 conversation의 tool event가 이 run을 진행시키거나 종료할 수 없습니다.

Run이 `Closed`, `Blocked`, `Cancelled`에 도달하면 패널은 10초 뒤 자동으로 닫힙니다. 현재 프로젝트에서 계속 숨기려면 `/code-panel hide`, 다시 표시하려면 `/code-panel show`를 사용합니다.

자동 finalization은 구현 turn 종료 시 한 번만 실행됩니다. staged/unstaged 변경을 수집하고, untracked file은 내용 복사 없이 이름만 기록하며, 감지된 check를 실행하고, report를 만든 뒤 최종 요약 turn을 한 번 보냅니다. 사용자가 명시적으로 요청하지 않는 한 CruiseCode는 commit이나 push를 지시하지 않습니다.

## Prototype evidence mode

Prototype mode는 CruiseCode를 또 하나의 prompt-to-app generator로 넓히지 않고, 구현 evidence를 정리하는 데 집중하게 합니다.

```text
/code-cruise --prototype "Build a project dashboard prototype"
/code-cruise --mode prototype "Build a project dashboard prototype"  # alias
/code-cruise --prototype --handoff implementation-handoff.json
```

- **Direct task:** CruiseCode는 `ux_intent_status: unverified`를 기록하고 요청한 prototype을 구현한 뒤 technical evidence만 보고합니다. UX가 검증됐다고 주장하지 않습니다.
- **Handoff:** 유효한 external 또는 CruiseUX `implementation-handoff.json`은 read-only로 다룹니다. 전달받은 criterion reference를 보존하고 coverage를 기록한 뒤 review packet을 만듭니다.
- **Boundary:** CruiseCode는 UX criterion을 새로 만들거나 user scenario를 발명하거나 UX/product decision을 내리지 않습니다. 사람 또는 별도 UX workflow가 결과 evidence를 해석합니다.

Prototype mode는 `prototype-contract.json`을 남기고, 일반 report 옆에 portable `prototype-review-packet.md`와 `prototype-review-packet.json`을 생성합니다. `--verify-only`는 standard run용 명령이므로 `--prototype`과 함께 쓸 수 없습니다.

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
      prototype-contract.json       # prototype run에서만 생성
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
      prototype-review-packet.md    # prototype run에서만 생성
      prototype-review-packet.json  # prototype run에서만 생성
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

그 다음 `/reload`를 실행하세요.

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
tests/cruise-code.test.mjs
```

간단한 source/package check는 아래처럼 실행할 수 있습니다.

```bash
npm test
tmp=$(mktemp -d)
cp mods/index.ts "$tmp/mod.mjs"
node --check "$tmp/mod.mjs"
rm -rf "$tmp"
npm pack --dry-run
```

## CruiseUX와 external handoff

CruiseUX는 유용한 upstream producer이지만 runtime dependency는 아닙니다. CruiseCode는 유효한 external `implementation-handoff.json`도 읽을 수 있습니다.

```text
CruiseUX   → UX framing, research, interview, ideation, spec, review
CruiseCode → implementation, evidence, checks, verdict, report
```

기준 handoff 파일은 아래와 같습니다.

```text
implementation-handoff.json
```

Prototype handoff에서는 CruiseCode가 `ux-ac-001` 같은 원래 UX acceptance criteria를 read-only `ux_ref`로 보존합니다. 그래서 UX verdict를 주장하지 않으면서 review packet에서 UX 의도와 구현 evidence를 연결할 수 있습니다.

## muscle-memory 연동

CruiseCode는 `muscle-memory`와 협업할 수 있지만, skill 관리는 직접 맡지 않습니다.

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

이 mod는 active project의 `.letta/cruise-code/` 아래에 local filesystem write를 합니다. 사용자가 `/code-cruise`를 실행한 뒤 해당 run의 tool/turn event를 관찰하고, 자동 finalization 중 local git/check command를 실행합니다. startup side effect나 background timer는 없습니다.

private CruiseCode run state, evidence files, `.env` files, credentials, local diagnostics, private project logs는 커밋하지 마세요.

mod가 startup이나 command handling을 깨뜨리면 아래처럼 복구할 수 있습니다.

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

그 다음 mod package를 제거하거나 수정하고 `/reload`를 실행하세요.

Agent-facing behavioral contract는 MOD.md를 참고하세요.
