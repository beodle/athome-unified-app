"""
콘텐츠 캘린더 구글 시트 → Firestore(calendarEvents) 단방향 읽기 동기화.

캘린더의 실제 쓰기(편집) 원본은 여전히 구글 시트다 — 이 스크립트는 그 시트를
"읽기만" 해서 Firestore에 복사해두는 역할만 한다. calendar.html은 이제 공개
CSV export URL을 직접 열지 않고 이 Firestore 컬렉션을 읽는다(로그인한
@athomecorp.com 계정만 읽을 수 있도록 Security Rules로 제한).

시트 자체를 CI(이 스크립트)가 공개 CSV URL로 읽는 것은 노출 문제가 아니다 —
노출 문제는 "브라우저에서 아무나" 이 URL에 접근할 수 있었다는 것이었고,
그 접근 경로(calendar.html의 client-side fetch)를 없애는 것이 이번 변경의 목적.

사용: python3 calendar_sync.py [--dry]
  --dry : Firestore 수정 없이 파싱 결과만 출력
"""
import os
import sys
import csv
import io

import requests
from google.cloud import firestore
from google.oauth2 import service_account

SHEET_CSV_URL = (
    'https://docs.google.com/spreadsheets/d/'
    '1bnLQypIuMb0gw0RxzwYVkqGBdN8KSA4_TXSuogaOWak/export?format=csv&gid=658998951'
)
DEFAULT_COLUMNS = ['시기', '주요 주제', '채널', '비고', 'URL']


def _client():
    key_path = os.environ.get('FIRESTORE_SA_KEY_PATH')
    if not key_path:
        raise SystemExit('❌ 환경변수 FIRESTORE_SA_KEY_PATH 없음 (Firestore 서비스 계정 키 경로)')
    creds = service_account.Credentials.from_service_account_file(key_path)
    return firestore.Client(project=creds.project_id, credentials=creds)


def fetch_rows():
    r = requests.get(SHEET_CSV_URL, timeout=30)
    if r.status_code >= 400:
        raise SystemExit(f'❌ 시트 CSV 조회 실패: HTTP {r.status_code}')
    r.encoding = 'utf-8'  # 응답에 charset이 명시돼 있지 않아 requests가 잘못 추측하는 걸 막음
    reader = csv.DictReader(io.StringIO(r.text))
    header_fields = [f.strip() for f in (reader.fieldnames or [])] or DEFAULT_COLUMNS

    events = {}
    for i, row in enumerate(reader):
        row_index = i + 2  # 1=헤더, 2=첫 데이터 (calendar.html의 _rowIndex와 동일 규칙)
        events[str(row_index)] = {
            'date':    (row.get('시기') or '').strip(),
            'title':   (row.get('주요 주제') or '').strip(),
            'channel': (row.get('채널') or '').strip(),
            'note':    (row.get('비고') or '').strip(),
            'url':     (row.get('URL') or row.get('url') or row.get('링크') or '').strip(),
        }
    return header_fields, events


def main():
    dry = '--dry' in sys.argv
    header_fields, events = fetch_rows()
    print(f'📅 시트에서 {len(events)}개 행 파싱 (헤더: {header_fields})')

    if dry:
        print('🔸 --dry: Firestore 미수정')
        return

    db = _client()
    col = db.collection('calendarEvents')

    # 삭제된 행은 문서도 지워야 하므로, 매번 현재 컬렉션 상태를 전부 시트 기준으로 맞춘다
    # (행 수가 적어 전체 덮어쓰기 부담 없음).
    existing_ids = {doc.id for doc in col.stream()}
    target_ids = set(events.keys())

    batch = db.batch()
    for row_id in existing_ids - target_ids:
        batch.delete(col.document(row_id))
    for row_id, fields in events.items():
        batch.set(col.document(row_id), fields, merge=True)
    batch.commit()

    db.collection('calendarMeta').document('summary').set(
        {'headerFields': header_fields}, merge=True
    )

    print(f'✅ Firestore calendarEvents 동기화 완료 ({len(target_ids - existing_ids)}건 추가, '
          f'{len(existing_ids - target_ids)}건 삭제, {len(target_ids)}건 유지/갱신)')


if __name__ == '__main__':
    main()
