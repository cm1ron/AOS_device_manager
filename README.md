# Android Device Manager

ADB/scrcpy 기반 Android 디바이스 관리 및 QA 도구

## 주요 기능

| 기능 | 설명 |
|------|------|
| **디바이스 관리** | USB/WiFi 연결 디바이스 자동 감지, 무선 페어링, 디바이스 정보 조회 |
| **화면 미러링** | scrcpy 기반 실시간 화면 미러링 + 터치/키 입력 |
| **스크린샷/녹화** | 스크린샷 캡처, 화면 녹화 (최대 3분), 자동 저장 |
| **앱 정보 조회** | OVERDARE 앱의 서버환경, 언리얼 버전, 앱 버전(해시 포함) 자동 감지 |
| **크래시 감지** | 실시간 크래시 자동 감지 (Java/Native/ANR/비정상 종료) + AI 요약 |
| **로그캣** | 실시간 logcat 뷰어 + 필터링 |
| **파일 관리** | 디바이스 파일 탐색, 업로드/다운로드 |
| **앱 관리** | APK 설치, 클린 설치, 앱 삭제, 강제 종료, 데이터 초기화 |
| **로그 추출** | OVERDARE 앱 로그 일괄 추출 |
| **PRD/피그마 분석** | Gemini AI 기반 PRD 분석, 피그마 UI 점검, 테스트케이스 생성 |
| **AI 챗봇** | Android QA 전문 AI 어시스턴트 |

## 설치 및 실행

### 사전 요구사항

- **Node.js** 18 이상
- **npm**
- **adb** (Android Debug Bridge)
- **scrcpy** (화면 미러링용)
- 디바이스에서 **개발자 옵션 → USB 디버깅** 활성화

### Windows

```bash
# 의존성 설치
npm install

# 실행
npm start

# 개발 모드 (DevTools 포함)
npm run dev
```

> Windows는 `vendor/scrcpy/` 폴더에 adb.exe, scrcpy.exe가 포함되어 있어 별도 설치 불필요

### Windows (Portable EXE)

```bash
# 빌드
npx electron-builder --win portable

# dist/AndroidDeviceManager-Portable.exe 실행
```

### Linux (Ubuntu/Debian)

```bash
# 1. 시스템 패키지 설치
sudo apt update
sudo apt install adb scrcpy nodejs npm

# 2. 소스 코드 클론
git clone https://github.com/cm1ron/Sprint.git
cd Sprint/android-device-manager

# 3. 의존성 설치
npm install

# 4. 실행
npm start
```

## 디바이스 연결

### USB 연결

1. 디바이스에서 **설정 → 개발자 옵션 → USB 디버깅** 활성화
2. USB 케이블로 PC에 연결
3. 디바이스에서 "USB 디버깅을 허용하시겠습니까?" → 허용
4. 프로그램이 자동으로 디바이스 감지

### WiFi 무선 연결

#### 방법 1: USB 연결 상태에서 전환
1. USB로 먼저 연결
2. 프로그램에서 **무선 연결** 버튼 클릭
3. USB 케이블 제거 → WiFi로 유지

#### 방법 2: 무선 디버깅 페어링
1. 디바이스에서 **설정 → 개발자 옵션 → 무선 디버깅** 활성화
2. **페어링 코드로 디바이스 페어링** 선택
3. 프로그램에서 IP:포트와 페어링 코드 입력

> **참고**: 디바이스 재부팅 후에는 무선 연결이 초기화됩니다. USB로 다시 연결 후 전환하거나 재페어링이 필요합니다.

## 기능 사용법

### 앱 정보 조회

1. 디바이스 목록에서 디바이스 선택
2. OVERDARE 앱을 포그라운드에 띄운 상태에서 **앱 정보 조회** 클릭
3. 서버환경, 언리얼 버전, 앱 버전(해시 포함)이 표시됨

### 크래시 감지

- 프로그램 실행 시 자동으로 모든 연결된 디바이스를 모니터링
- 크래시 감지 시 알림 표시 + 크래시 목록에 추가
- **감지 방식**: logcat 스트리밍 + crash buffer 5초 폴링 + 프로세스 watchdog
- **감지 유형**: Java 크래시, 네이티브 크래시(Unreal), ANR, 비정상 종료
- **AI 요약** (Gemini API 키 필요): 크래시 직전 logcat + UI 계층 분석으로 4단계 요약
  - [화면] 어디에 있었는지
  - [행동] 무엇을 했는지 (resource-id, 버튼명 포함)
  - [원인] 기술적 에러 원인
  - [재현] 재현 방법 추정

### 화면 미러링 / 녹화

1. 디바이스 선택 후 **미러링** 버튼으로 scrcpy 시작
2. **스크린샷** 버튼으로 현재 화면 캡처
3. **녹화** 버튼으로 화면 녹화 시작/중지 (최대 3분)
4. **스샷/녹화 폴더** 버튼으로 저장 폴더 열기

### 로그 추출

1. OVERDARE 앱 실행 상태에서 **전체 로그 추출** 클릭
2. 디바이스의 앱 로그가 로컬 `logs/` 폴더에 저장됨
3. **로그 폴더** 버튼으로 저장 폴더 열기

### PRD/피그마 분석

1. **설정**에서 Gemini API 키 입력
2. PRD 문서(PDF/TXT/MD) 또는 피그마 스크린샷(PNG/JPG) 선택
3. **분석 시작**으로 기능 목록, UI 점검, 테스트케이스 자동 생성

## Gemini API 설정

AI 요약, PRD 분석, 챗봇 기능을 사용하려면 Gemini API 키가 필요합니다.

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키 발급
2. 프로그램 **설정** → API 키 입력
3. 무료 티어: 250 요청/일, 10 요청/분 (gemini-2.5-flash 기준)

## 폴더 구조

```
android-device-manager/
├── main.js              # Electron 메인 프로세스
├── preload.js           # IPC 브릿지
├── package.json
├── src/
│   ├── index.html       # 메인 UI
│   ├── styles/main.css  # 스타일
│   └── panels/          # UI 패널 모듈
│       ├── device.js        # 디바이스/앱 정보
│       ├── mirror-inspector.js  # 미러링/녹화/스크린샷
│       ├── logcat.js        # 로그캣/크래시 감지
│       ├── apps.js          # 앱 관리
│       ├── files.js         # 파일 관리
│       ├── ai-chat.js       # AI 챗봇
│       └── analysis.js      # PRD/피그마 분석
├── lib/
│   ├── adb-manager.js       # ADB 명령 래퍼
│   ├── scrcpy-manager.js    # scrcpy 프로세스 관리
│   ├── device-monitor.js    # 디바이스 연결 감시
│   ├── crash-monitor.js     # 크래시 자동 감지
│   └── pdf-parser.js        # PDF/이미지 파서
└── vendor/scrcpy/       # Windows용 adb/scrcpy 바이너리
```

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| 디바이스가 안 잡힘 | USB 디버깅 활성화 확인, 케이블 재연결, `adb devices`로 확인 |
| 재부팅 후 WiFi 연결 안 됨 | USB로 연결 후 무선 전환, 또는 무선 디버깅 재페어링 |
| 미러링 안 됨 | scrcpy 설치 확인 (Linux: `sudo apt install scrcpy`) |
| 크래시 감지 안 됨 | 디바이스 연결 상태 확인, 프로그램 재시작 |
| AI 요약 실패 | Gemini API 키 확인, 무료 할당량 확인 (250건/일, 자정 PST 리셋) |
| 앱 정보 안 나옴 | OVERDARE 앱을 포그라운드에 띄운 후 조회 |
