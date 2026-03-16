import re
from datetime import date

SHEET_ID_PATTERN = re.compile(r'/spreadsheets/d/([a-zA-Z0-9-_]+)')
RAW_SHEET_ID_PATTERN = re.compile(r'^[a-zA-Z0-9-_]{20,}$')
ROLL_ADMISSION_YEAR_PATTERN = re.compile(r'^(20\d{2})[A-Z]{2,}\d+$', re.IGNORECASE)
LEGACY_IPM_CODE_PATTERN = re.compile(r'^IPM0?([1-9])$', re.IGNORECASE)


def extract_sheet_id(url: str) -> str:
    text = str(url or '').strip()
    if not text:
        return ''

    match = SHEET_ID_PATTERN.search(text)
    if match:
        return match.group(1)

    # Allow directly pasting the sheet ID instead of full URL.
    if RAW_SHEET_ID_PATTERN.match(text):
        return text

    return ''


def infer_batch_code_from_roll_number(roll_number: str) -> str:
    normalized = str(roll_number or '').strip().upper()
    if not normalized:
        return ''

    direct_match = ROLL_ADMISSION_YEAR_PATTERN.match(normalized)
    if direct_match:
        return direct_match.group(1)

    year_match = re.search(r'20\d{2}', normalized)
    if year_match:
        return year_match.group(0)

    return ''


def format_batch_name(batch_code: str) -> str:
    normalized = str(batch_code or '').strip().upper()
    if re.fullmatch(r'20\d{2}', normalized):
        return f'IPM {normalized} Batch'
    legacy_match = LEGACY_IPM_CODE_PATTERN.match(normalized)
    if legacy_match:
        try:
            program_year = int(legacy_match.group(1))
        except (TypeError, ValueError):
            return normalized
        admission_year = max(2000, date.today().year - program_year)
        return f'IPM {admission_year} Batch'
    return normalized


def infer_ipm_year_label(batch_code: str, reference_date: date | None = None) -> str:
    text = str(batch_code or '').strip().upper()
    year_match = re.search(r'20\d{2}', text)
    today = reference_date or date.today()
    if year_match:
        try:
            admission_year = int(year_match.group(0))
        except (TypeError, ValueError):
            return ''
        program_year = max(1, today.year - admission_year)
        return f'IPM{program_year:02d}'

    legacy_match = LEGACY_IPM_CODE_PATTERN.match(text)
    if not legacy_match:
        return ''
    try:
        program_year = int(legacy_match.group(1))
    except (TypeError, ValueError):
        return ''
    return f'IPM{program_year:02d}'
