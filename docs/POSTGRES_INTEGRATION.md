# 실제 PostgreSQL 통합 검증

`server/test/postgres_real_integration.test.js`는 `LUFFI_TEST_POSTGRES_URL`이 있을 때만 실행한다. 대상 데이터베이스에 임의 이름의 전용 스키마를 만든 뒤 종료 시 삭제하므로, 스키마 생성·삭제 권한이 있는 **테스트 전용 DB**를 사용한다. 일반 `npm test`에서는 URL이 없으면 건너뛴다.

```sh
cd server
LUFFI_TEST_POSTGRES_URL='postgres://사용자:암호@호스트:포트/테스트DB' npm run test:postgres-real
```

검증 범위는 실제 서버에 001~003 마이그레이션 적용, 기존 JSON 커널 상태 이입, 그래프의 관계형 행 분리, 두 저장소 인스턴스의 동시 쓰기 직렬화, 외래키 오류가 난 트랜잭션 전체 롤백, 저장소 재생성 후 읽기다. 확인한 패션 캡처에서 코디를 만들고 색상·사이즈 변경으로 새 Variant와 항목 관계를 생성한 뒤 재시작해 현재 값을 다시 읽는 경로도 포함한다. 이는 PGlite에 더해 실제 PostgreSQL 드라이버·트랜잭션 경로를 확인한다. 대용량 부하, 운영 DB 백업 복원, 권한 분리, 배포 중 무중단 전환은 이 테스트의 범위가 아니다.
