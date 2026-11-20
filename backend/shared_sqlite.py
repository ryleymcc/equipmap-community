"""SQLite compatibility for the opt-in shared-folder edition's LOCAL cache."""
import hashlib
from pathlib import Path
import re

from sqlalchemy import event


def trigrams(value):
    result = set()
    for word in re.findall(r'\w+', (value or '').lower()):
        padded = '  ' + word + ' '
        result.update(padded[i:i + 3] for i in range(len(padded) - 2))
    return result


def similarity(left, right):
    left, right = trigrams(left), trigrams(right)
    return len(left & right) / len(left | right) if left or right else 0.0


def install(engine):
    database = Path(engine.url.database)
    @event.listens_for(engine.sync_engine, 'connect')
    def configure(connection, _):
        connection.create_function('regexp_replace', 4, lambda value, pattern, replacement, _: re.sub(pattern, replacement, value) if value is not None else None)
        connection.create_function('regex_match', 2, lambda value, pattern: bool(re.search(pattern, value or '')))
        connection.create_function('similarity', 2, similarity)
        def content_hash():
            with database.open('rb') as source:
                return hashlib.file_digest(source, 'md5').hexdigest()
        connection.create_function('shared_content_hash', 0, content_hash)
        cursor = connection.cursor()
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.execute('PRAGMA busy_timeout=30000')
        cursor.execute('PRAGMA synchronous=FULL')
        cursor.close()

    @event.listens_for(engine.sync_engine, 'before_cursor_execute', retval=True)
    def adapt(_, __, statement, parameters, ___, ____):
        # xmin-based cache tags are PostgreSQL-specific. In this edition the
        # local committed snapshot hash invalidates all entity caches together.
        if 'xmin' in statement:
            return 'SELECT shared_content_hash()', ()
        if statement.lstrip().startswith('DO $$'):
            return 'SELECT 1', ()  # PostgreSQL-only sequence repair after undo.
        statement = re.sub(r'\bILIKE\b', 'LIKE', statement, flags=re.IGNORECASE)
        statement = re.sub(r'(LOWER\(name\)) ~ (\?)', r'regex_match(\1, \2)', statement)
        statement = re.sub(r'(\b\w+\.\w+) % (\?)', r'similarity(\1, \2) >= 0.3', statement)
        return statement, parameters
