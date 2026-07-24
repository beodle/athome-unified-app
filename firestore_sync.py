"""
Firestore ↔ 대시보드 baked-data 동기화 헬퍼.

dashboard.html 파일 자체에 실적 데이터를 정규식으로 굽던 방식(__BAKED_DATA__)은
로그인 안 한 사람이 raw HTML만 열어도 그대로 노출되는 문제가 있어, Firestore
저장으로 옮긴다. update.sh/linkedin_fetch.py/youtube_fetch.py는 "dashboard.html을
읽고/쓰던" 부분만 이 모듈의 load_baked()/save_baked()로 교체하면 되고, 그 앞뒤의
GA4/LinkedIn/YouTube 수집 로직은 그대로 둔다.

인증: FIRESTORE_SA_KEY_PATH 환경변수(서비스 계정 JSON 파일 경로)를 사용한다.
GA4 클라이언트가 쓰는 GOOGLE_APPLICATION_CREDENTIALS와 겹치면 서로 다른
서비스 계정이 충돌하므로 별도 env var로 분리했다.

컬렉션 구조 (기존 __BAKED_DATA__ dict와 1:1 대응, 스키마 변경 없음):
  dashboardWeekly/{weekId}  — 예: "2026-W29" 문서 하나당 그 주차의 필드 전부
  dashboardMeta/summary     — 주차 키가 아닌 나머지(__li_posts__/__yt_subscribers__/
                              __yt_videos__/__LAST_UPDATED__)를 모아둔 문서
"""
import os
import re

from google.cloud import firestore
from google.oauth2 import service_account

_WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")

_META_KEYS = {
    '__li_posts__': 'li_posts',
    '__yt_subscribers__': 'yt_subscribers',
    '__yt_videos__': 'yt_videos',
    '__LAST_UPDATED__': 'last_updated',
}


def _client():
    key_path = os.environ.get('FIRESTORE_SA_KEY_PATH')
    if not key_path:
        raise SystemExit('❌ 환경변수 FIRESTORE_SA_KEY_PATH 없음 (Firestore 서비스 계정 키 경로)')
    creds = service_account.Credentials.from_service_account_file(key_path)
    return firestore.Client(project=creds.project_id, credentials=creds)


def load_baked():
    """Firestore에서 기존 __BAKED_DATA__와 동일한 모양의 dict를 복원한다."""
    db = _client()
    baked = {}
    for doc in db.collection('dashboardWeekly').stream():
        baked[doc.id] = doc.to_dict()

    summary = db.collection('dashboardMeta').document('summary').get()
    if summary.exists:
        data = summary.to_dict()
        for baked_key, field in _META_KEYS.items():
            if field in data:
                baked[baked_key] = data[field]
    return baked


def save_baked(baked):
    """load_baked()가 만든 것과 같은 모양의 dict를 Firestore에 반영한다."""
    db = _client()
    summary_fields = {}
    for key, value in baked.items():
        if key in _META_KEYS:
            summary_fields[_META_KEYS[key]] = value
        elif _WEEK_RE.match(key):
            db.collection('dashboardWeekly').document(key).set(value, merge=True)
        # 그 외 알 수 없는 키는 과거 폴백/디버그용 흔적일 수 있어 조용히 무시한다.

    if summary_fields:
        db.collection('dashboardMeta').document('summary').set(summary_fields, merge=True)
