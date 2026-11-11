"""
콘텐츠 캘린더 구글 시트 → Firestore(calendarEvents) 단방향 읽기 동기화.

캘린더의 실제 쓰기(편집) 원본은 여전히 구글 시트다 — 이 스크립트는 그 시트를
"읽기만" 해서 Firestore에 복사해두는 역할만 한다. calendar.html은 이제 공개
CSV export URL을 직접 열지 않고 이 Firestore 컬렉션을 읽는다(로그인한
@athomecorp.com 계정만 읽을 수 있도록 Security Rules로 제한).

시트는 "제한됨"(링크 공개 아님)이라, CI는 시트 전용 서비스 계정(SHEET_SA_KEY)으로
Sheets API를 읽는다. 브라우저 직접 접근 경로는 없다.

사용: python3 calendar_sync.py [--dry]
  --dry : Firestore 수정 없이 파싱 결과만 출력
환경변수: SHEET_SA_KEY_PATH(시트 읽기), FIRESTORE_SA_KEY_PATH(쓰기, --dry에선 불필요)
"""
import os
import sys
import time

import requests
from google.cloud import firestore
from google.oauth2 import service_account

SPREADSHEET_ID = '1bnLQypIuMb0gw0RxzwYVkqGBdN8KSA4_TXSuogaOWak'
SHEET_GID = '658998951'
SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
DEFAULT_COLUMNS = ['시기', '주요 주제', '채널', '비고', 'URL']


def _client():
    key_path = os.environ.get('FIRESTORE_SA_KEY_PATH')
    if not key_path:
        raise SystemExit('❌ 환경변수 FIRESTORE_SA_KEY_PATH 없음 (Firestore 서비스 계정 키 경로)')
    creds = service_account.Credentials.from_service_account_file(key_path)
    return firestore.Client(project=creds.project_id, credentials=creds)


def _sheets_session():
    from google.auth.transport.requests import AuthorizedSession
    key_path = os.environ.get('SHEET_SA_KEY_PATH')
    if not key_path:
        raise SystemExit('❌ 환경변수 SHEET_SA_KEY_PATH 없음 (시트 읽기용 서비스 계정 키 경로)')
    creds = service_account.Credentials.from_service_account_file(key_path, scopes=[SHEETS_SCOPE])
    return AuthorizedSession(creds)


def fetch_rows():
    # 시트는 "제한됨"(링크 공개 아님)이라 공개 CSV 대신 시트 전용 서비스 계정으로
    # Sheets API를 읽는다. 일시적 오류(5xx/429)만 짧게 재시도.
    sess = _sheets_session()
    base = f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}'

    def get(url, **params):
        last_err = None
        for attempt in range(3):
            try:
                r = sess.get(url, params=params, timeout=30)
                if r.status_code < 400:
                    return r.json()
                last_err = f'HTTP {r.status_code} {r.text[:200]}'
                if r.status_code not in (429, 500, 502, 503, 504):
                    break
            except requests.RequestException as e:
                last_err = str(e)
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
        raise SystemExit(f'❌ 시트 조회 실패: {last_err}')

    meta = get(base, fields='sheets.properties')
    title = next((s['properties']['title'] for s in meta['sheets']
                  if str(s['properties']['sheetId']) == SHEET_GID), None)
    if not title:
        raise SystemExit(f'❌ gid={SHEET_GID} 시트를 찾지 못함')
    quoted = "'" + title.replace("'", "''") + "'"
    values = get(f'{base}/values/{quoted}', valueRenderOption='FORMATTED_VALUE').get('values', [])
    if not values:
        raise SystemExit('❌ 시트가 비어 있음 — 동기화 중단(Firestore 보호)')

    header_fields = [f.strip() for f in values[0]] or DEFAULT_COLUMNS

    def cell(row, name):
        for i, h in enumerate(header_fields):
            if h == name and i < len(row):
                return str(row[i]).strip()
        return ''

    events = {}
    for i, row in enumerate(values[1:]):
        row_index = i + 2  # 1=헤더, 2=첫 데이터 (calendar.html의 _rowIndex와 동일 규칙)
        events[str(row_index)] = {
            'date':    cell(row, '시기'),
            'title':   cell(row, '주요 주제'),
            'channel': cell(row, '채널'),
            'note':    cell(row, '비고'),
            'url':     cell(row, 'URL') or cell(row, 'url') or cell(row, '링크'),
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
