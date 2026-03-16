import datetime
import io
import os
import re
from collections.abc import Iterable

import pandas as pd
import requests

DEFAULT_BUS_SCHEDULE_SHEET_URL = (
    'https://docs.google.com/spreadsheets/d/15MBGpB5UQ3ib0u8VDlwWETmuEqKVrh6VIQB0DmzVsZ8/edit?usp=sharing'
)


def _safe_text(value: object) -> str:
    if value is None:
        return ''
    if isinstance(value, float) and pd.isna(value):
        return ''
    return str(value).strip()


def _format_time(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ''
    if isinstance(value, pd.Timestamp):
        return value.strftime('%I:%M %p').lstrip('0')
    if isinstance(value, datetime.datetime):
        return value.strftime('%I:%M %p').lstrip('0')
    if isinstance(value, datetime.time):
        return value.strftime('%I:%M %p').lstrip('0')

    parsed = pd.to_datetime(_safe_text(value), errors='coerce')
    if pd.isna(parsed):
        return _safe_text(value)
    return parsed.strftime('%I:%M %p').lstrip('0')


def _nonempty_row_values(values: Iterable[object]) -> list[str]:
    return [text for text in (_safe_text(value) for value in values) if text]


def _extract_spreadsheet_id(sheet_url: str) -> str:
    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', sheet_url)
    if not match:
        raise ValueError('Invalid Google Sheets URL for bus schedule.')
    return match.group(1)


def _export_url(sheet_url: str) -> str:
    spreadsheet_id = _extract_spreadsheet_id(sheet_url)
    return f'https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx'


def _load_bus_schedule_sheet(sheet_url: str) -> pd.DataFrame:
    response = requests.get(_export_url(sheet_url), timeout=60)
    response.raise_for_status()
    workbook = pd.ExcelFile(io.BytesIO(response.content))
    return workbook.parse('Shuttle Timings', header=None)


def _row_text(df: pd.DataFrame, row_index: int) -> list[str]:
    if row_index < 0 or row_index >= len(df.index):
        return []
    return _nonempty_row_values(df.iloc[row_index].tolist())


def _format_effective_date(values: list[str]) -> str:
    for value in values:
        parsed = pd.to_datetime(value, errors='coerce')
        if pd.isna(parsed):
            continue
        return parsed.date().isoformat()
    return ''


def _slugify(text: str) -> str:
    normalized = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return normalized or 'route'


def _parse_route_section(df: pd.DataFrame, title_row: int, end_row: int) -> dict[str, object]:
    title = ' '.join(_row_text(df, title_row))
    status_values = _row_text(df, title_row + 2)
    contact_values = _row_text(df, title_row + 3)
    header_values = _row_text(df, title_row + 4)

    if len(header_values) < 2:
        raise ValueError(f'Bus schedule section "{title}" is missing bus headers.')

    bus_codes = header_values[1:]
    status_by_column = status_values[1:1 + len(bus_codes)]
    contact_by_column = contact_values[1:1 + len(bus_codes)]

    buses = [
        {
            'code': bus_code,
            'status': status_by_column[index] if index < len(status_by_column) else '',
            'contact': contact_by_column[index] if index < len(contact_by_column) else '',
            'outbound_stops': [],
            'return_stops': [],
        }
        for index, bus_code in enumerate(bus_codes)
    ]

    current_direction = 'outbound_stops'
    for row_index in range(title_row + 5, end_row):
        values = df.iloc[row_index].tolist()
        if not _nonempty_row_values(values):
            continue

        stop_name = _safe_text(values[0])
        if not stop_name:
            continue

        if stop_name.lower().startswith('return to campus'):
            current_direction = 'return_stops'
            continue

        for column_index, bus in enumerate(buses, start=1):
            time_label = _format_time(values[column_index] if column_index < len(values) else '')
            if not time_label:
                continue
            bus[current_direction].append(
                {
                    'stop': stop_name,
                    'time': time_label,
                }
            )

    return {
        'key': _slugify(title),
        'title': title,
        'buses': buses,
    }


def build_bus_schedule_payload() -> dict[str, object]:
    sheet_url = os.getenv('BUS_SCHEDULE_SHEET_URL', DEFAULT_BUS_SCHEDULE_SHEET_URL).strip()
    df = _load_bus_schedule_sheet(sheet_url)

    instructions = []
    for row_index in range(1, 8):
        row_values = _row_text(df, row_index)
        if row_values:
            instructions.append(' '.join(row_values))

    effective_date = _format_effective_date(_row_text(df, 8))

    route_title_rows: list[int] = []
    for row_index in range(len(df.index)):
        row_values = _row_text(df, row_index)
        if not row_values:
            continue
        first_text = row_values[0].lower()
        if first_text.startswith('shuttle bus schedule'):
            route_title_rows.append(row_index)

    routes = []
    for index, title_row in enumerate(route_title_rows):
        end_row = route_title_rows[index + 1] if index + 1 < len(route_title_rows) else len(df.index)
        routes.append(_parse_route_section(df, title_row, end_row))

    return {
        'source_url': sheet_url,
        'effective_date': effective_date,
        'instructions': instructions,
        'routes': routes,
    }
